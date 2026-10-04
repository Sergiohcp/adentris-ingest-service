import { MongoClient } from 'mongodb';
import { AppConfig } from '../../src/config/configuration';
import { LeaseLostError } from '../../src/processing/domain/errors';
import { ControllableProcessor } from '../helpers/controllable-processor';
import { FakeClock } from '../helpers/fake-clock';
import { startReplSet, stopReplSet } from '../helpers/replset';
import { testConfig } from '../helpers/test-config';
import { createWorker, Db, waitFor, Worker } from '../helpers/worker-harness';

const at = (hhmmss: string) => new Date(`2024-01-01T${hhmmss}.000Z`);

describe('processing (real MongoDB replica set)', () => {
  let client: MongoClient;
  let config: AppConfig;
  let db: Db;
  let clock: FakeClock;
  let processor: ControllableProcessor;
  let workers: Worker[];

  const newWorker = async (): Promise<Worker> => {
    const worker = await createWorker(config, clock, processor);
    workers.push(worker);
    return worker;
  };
  const statusOf = async (id: unknown) => (await db.events.findOne({ _id: id as never }))!;
  const allDone = async () => (await db.events.countDocuments({ status: { $ne: 'done' } })) === 0;

  beforeAll(async () => {
    const uri = await startReplSet();
    config = testConfig(uri, { maxAttempts: 3, leaseMs: 30_000, processTimeoutMs: 15_000 });
    client = await new MongoClient(uri).connect();
    db = new Db(client, config);
  });

  afterAll(async () => {
    await client.close();
    await stopReplSet();
  });

  beforeEach(async () => {
    clock = new FakeClock(at('10:00:00'));
    processor = new ControllableProcessor();
    workers = [];
    await db.clear();
  });

  afterEach(async () => {
    await Promise.all(workers.map(async (w) => { await w.runner.stop(); await w.close(); }));
  });

  describe('lane acquisition', () => {
    it('lets exactly one of many concurrent acquirers win', async () => {
      const w = await newWorker();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => w.lanes.tryAcquire('p1', `w${i}`, clock.now())),
      );
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('refuses a held lane, grants it after release and after lease expiry', async () => {
      const w = await newWorker();
      const lease = (await w.lanes.tryAcquire('p1', 'a', clock.now()))!;
      expect(await w.lanes.tryAcquire('p1', 'b', clock.now())).toBeNull();

      await w.lanes.release(lease);
      const second = (await w.lanes.tryAcquire('p1', 'b', clock.now()))!;
      expect(second.token).not.toBe(lease.token);

      expect(await w.lanes.tryAcquire('p1', 'c', clock.now())).toBeNull();
      clock.advance(config.leaseMs + 1);
      expect(await w.lanes.tryAcquire('p1', 'c', clock.now())).not.toBeNull();
    });

    it('does not let a stale holder release or renew a lane it lost', async () => {
      const w = await newWorker();
      const stale = (await w.lanes.tryAcquire('p1', 'a', clock.now()))!;
      clock.advance(config.leaseMs + 1);
      const fresh = (await w.lanes.tryAcquire('p1', 'b', clock.now()))!;

      expect(await w.lanes.renew(stale, clock.now())).toBe(false);
      await w.lanes.release(stale);
      expect((await db.lanes.findOne({ _id: 'p1' }))!.token).toBe(fresh.token);
    });
  });

  describe('ordering and serialisation', () => {
    it('processes events inserted in shuffled order by ts, with appliedSeq 1..n', async () => {
      for (const t of ['09:30:00', '09:10:00', '09:50:00', '09:00:00', '09:20:00']) {
        await db.seed({ patientId: 'p1', ts: at(t) }, clock);
      }
      const w = await newWorker();
      w.runner.start();
      await waitFor(allDone);

      const docs = await db.events.find({}).sort({ appliedSeq: 1 }).toArray();
      expect(docs.map((d) => d.appliedSeq)).toEqual([1, 2, 3, 4, 5]);
      const times = docs.map((d) => d.ts.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(docs.every((d) => !d.outOfOrder)).toBe(true);
      expect(processor.started.map((e) => e.ts.getTime())).toEqual(times);
    });

    it('breaks ts ties by receivedAt', async () => {
      const later = await db.seed({ patientId: 'p1', ts: at('09:00:00'), receivedAt: at('09:59:59') }, clock);
      const earlier = await db.seed({ patientId: 'p1', ts: at('09:00:00'), receivedAt: at('09:30:00') }, clock);
      const w = await newWorker();
      w.runner.start();
      await waitFor(allDone);
      expect((await statusOf(earlier)).appliedSeq).toBe(1);
      expect((await statusOf(later)).appliedSeq).toBe(2);
    });

    it('never runs two events of the same patient at once, even with two workers', async () => {
      for (let p = 0; p < 6; p++) {
        for (let i = 0; i < 5; i++) await db.seed({ patientId: `p${p}`, ts: at(`09:0${i}:00`) }, clock);
      }
      const [a, b] = [await newWorker(), await newWorker()];
      a.runner.start();
      b.runner.start();
      await waitFor(allDone);

      expect(processor.maxConcurrentForAnyPatient).toBe(1);
      expect(processor.started).toHaveLength(30);
      for (let p = 0; p < 6; p++) {
        const docs = await db.events.find({ patientId: `p${p}` }).sort({ appliedSeq: 1 }).toArray();
        expect(docs.map((d) => d.appliedSeq)).toEqual([1, 2, 3, 4, 5]);
        for (let i = 1; i < docs.length; i++) {
          expect(docs[i].startedAt!.getTime()).toBeGreaterThanOrEqual(docs[i - 1].processedAt!.getTime());
        }
      }
    });

    it('processes different patients concurrently', async () => {
      processor.mode = 'manual';
      for (const p of ['a', 'b', 'c']) await db.seed({ patientId: p, ts: at('09:00:00') }, clock);
      const w = await newWorker();
      w.runner.start();
      await processor.waitForWaiting(3);
      expect(processor.maxConcurrentOverall).toBe(3);
      while (processor.waiting.length) processor.resolveNext();
      await waitFor(allDone);
    });
  });

  describe('crashes and fencing', () => {
    it('lets another worker finish an event abandoned by a dead one, exactly once', async () => {
      const id = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      const dead = await newWorker();
      const lease = (await dead.lanes.tryAcquire('p1', 'dead', clock.now()))!;
      await dead.events.markProcessing(id.toHexString(), lease.token, clock.now()); // ...and the process dies

      const survivor = await newWorker();
      survivor.runner.start();
      await new Promise((r) => setTimeout(r, 200));
      expect((await statusOf(id)).status).toBe('processing'); // lease still valid: hands off

      clock.advance(config.leaseMs + 1);
      await waitFor(allDone);
      const doc = await statusOf(id);
      expect(doc).toMatchObject({ status: 'done', attempts: 2, appliedSeq: 1 });
      expect(processor.started).toHaveLength(1);
      expect((await db.lanes.findOne({ _id: 'p1' }))!.appliedCount).toBe(1);
    });

    it('rejects completion from a zombie whose lease was taken over', async () => {
      const id = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      const a = await newWorker();
      const b = await newWorker();

      const leaseA = (await a.lanes.tryAcquire('p1', 'A', clock.now()))!;
      const claimedA = (await a.events.markProcessing(id.toHexString(), leaseA.token, clock.now()))!;

      clock.advance(config.leaseMs + 1); // A stalls; its lease expires
      const leaseB = (await b.lanes.tryAcquire('p1', 'B', clock.now()))!;
      const claimedB = (await b.events.markProcessing(id.toHexString(), leaseB.token, clock.now()))!;

      await expect(a.completion.complete(claimedA, leaseA.token, { by: 'zombie' })).rejects.toBeInstanceOf(LeaseLostError);
      expect((await db.lanes.findOne({ _id: 'p1' }))!.appliedCount).toBe(0);
      expect(await statusOf(id)).toMatchObject({ status: 'processing', laneToken: leaseB.token });

      await b.completion.complete(claimedB, leaseB.token, { by: 'B' });
      expect(await statusOf(id)).toMatchObject({ status: 'done', result: { by: 'B' }, appliedSeq: 1 });
      expect((await db.lanes.findOne({ _id: 'p1' }))!.appliedCount).toBe(1);

      await expect(a.completion.complete(claimedA, leaseA.token, { by: 'zombie' })).rejects.toBeInstanceOf(LeaseLostError);
      expect((await db.lanes.findOne({ _id: 'p1' }))!.appliedCount).toBe(1);
    });

    it('a drain that lost its lease discards its work and does not touch the event', async () => {
      processor.mode = 'manual';
      const id = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      const a = await newWorker();
      const b = await newWorker();
      const leaseA = (await a.lanes.tryAcquire('p1', 'A', clock.now()))!;
      const drainA = a.processLane.execute(leaseA);
      await processor.waitForWaiting(1);

      clock.advance(config.leaseMs + 1);
      const leaseB = (await b.lanes.tryAcquire('p1', 'B', clock.now()))!;
      await b.events.markProcessing(id.toHexString(), leaseB.token, clock.now());

      processor.resolveNext(); // zombie A finishes its external call
      await drainA;
      expect(await statusOf(id)).toMatchObject({ status: 'processing', laneToken: leaseB.token });
      expect((await db.lanes.findOne({ _id: 'p1' }))!.token).toBe(leaseB.token); // A's release was a no-op
      expect((await db.lanes.findOne({ _id: 'p1' }))!.appliedCount).toBe(0);
    });
  });

  describe('retries, blocked lanes, ordering anomalies', () => {
    it('retries with backoff, then fails after MAX_ATTEMPTS and blocks the lane', async () => {
      processor.failWhen = () => true;
      const first = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      const second = await db.seed({ patientId: 'p1', ts: at('09:05:00') }, clock);
      const w = await newWorker();
      const drain = async () => w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);

      await drain();
      let doc = await statusOf(first);
      expect(doc).toMatchObject({ status: 'pending', attempts: 1, lastError: 'boom' });
      expect(doc.availableAt.getTime()).toBeGreaterThanOrEqual(clock.now().getTime());

      await drain(); // still in backoff (unless jitter drew 0): never skips the head
      expect(processor.started.every((e) => e.id === first.toHexString())).toBe(true);

      for (let i = 0; i < 5; i++) {
        clock.advance(config.backoffMaxMs + 1);
        await drain();
      }
      doc = await statusOf(first);
      expect(doc).toMatchObject({ status: 'failed', attempts: 3 });
      expect(doc.failedAt).toBeDefined();

      clock.advance(config.backoffMaxMs + 1);
      await drain(); // blocked lane
      expect((await statusOf(second)).status).toBe('pending');
      expect(processor.started.some((e) => e.id === second.toHexString())).toBe(false);
    });

    it('recovers when a retry succeeds', async () => {
      let calls = 0;
      processor.failWhen = () => ++calls === 1;
      const id = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      const w = await newWorker();
      await w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);
      clock.advance(config.backoffMaxMs + 1);
      await w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);
      expect(await statusOf(id)).toMatchObject({ status: 'done', attempts: 2, appliedSeq: 1 });
    });

    it('flags events that arrive after a later one was applied as outOfOrder', async () => {
      const w = await newWorker();
      const run = async () => w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);
      const newer = await db.seed({ patientId: 'p1', ts: at('09:05:00') }, clock);
      await run();
      const older = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      await run();

      expect(await statusOf(newer)).toMatchObject({ status: 'done', appliedSeq: 1, outOfOrder: false });
      expect(await statusOf(older)).toMatchObject({ status: 'done', appliedSeq: 2, outOfOrder: true });
    });

    it('does not process later events while the head waits (backoff / watermark)', async () => {
      const head = await db.seed({ patientId: 'p1', ts: at('09:00:00'), availableAt: at('10:00:05') }, clock);
      const later = await db.seed({ patientId: 'p1', ts: at('09:30:00') }, clock);
      const w = await newWorker();
      await w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);
      expect(processor.started).toHaveLength(0);

      clock.advance(6_000);
      await w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);
      expect((await statusOf(head)).appliedSeq).toBe(1);
      expect((await statusOf(later)).appliedSeq).toBe(2);
    });

    it('stops draining after LANE_BATCH events and releases the lane', async () => {
      const small = testConfig(config.mongoUri, { laneBatch: 2 });
      const w = await createWorker({ ...small, mongoDb: config.mongoDb }, clock, processor);
      workers.push(w);
      for (let i = 0; i < 5; i++) await db.seed({ patientId: 'p1', ts: at(`09:0${i}:00`) }, clock);
      await w.processLane.execute((await w.lanes.tryAcquire('p1', 'w', clock.now()))!);
      expect(await db.events.countDocuments({ status: 'done' })).toBe(2);
      expect((await db.lanes.findOne({ _id: 'p1' }))!.token).toBeNull();
    });
  });

  describe('graceful shutdown', () => {
    it('lets the in-flight event complete before stop() resolves', async () => {
      processor.mode = 'manual';
      const id = await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      const w = await newWorker();
      w.runner.start();
      await processor.waitForWaiting(1);

      let stopped = false;
      const stopping = w.runner.stop().then(() => { stopped = true; });
      await new Promise((r) => setTimeout(r, 150));
      expect(stopped).toBe(false);

      processor.resolveNext();
      await stopping;
      expect(await statusOf(id)).toMatchObject({ status: 'done', appliedSeq: 1 });
      expect((await db.lanes.findOne({ _id: 'p1' }))!.token).toBeNull();
    });

    it('stops acquiring new lanes once stopping', async () => {
      const w = await newWorker();
      await w.runner.stop();
      await db.seed({ patientId: 'p1', ts: at('09:00:00') }, clock);
      await w.runner.run(); // loop exits immediately
      expect(processor.started).toHaveLength(0);
    });
  });
});

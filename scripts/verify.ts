/**
 * Proves the guarantees after a load+chaos run. Exit code 1 on any violation.
 * Reads sent.jsonl (what senders were told) and MongoDB (what was stored).
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';
import { parseArgs, percentile, sleep } from './args';

const args = parseArgs({
  url: 'http://localhost:3000',
  mongoUri: 'mongodb://localhost:27017/ingest?replicaSet=rs0&directConnection=true',
  mongoDb: 'ingest',
  in: 'sent.jsonl',
  timeout: 900, // seconds to wait for the queue to drain
});

interface Sent {
  logicalId: string;
  patientId: string;
  ts: string;
  eventIds: string[];
}

interface StatsBody {
  byStatus: { pending: number; processing: number; done: number; failed: number };
}

const failures: string[] = [];
const check = (ok: boolean, message: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

async function waitForDrain(): Promise<void> {
  const deadline = Date.now() + args.timeout * 1000;
  for (;;) {
    const stats = (await (await fetch(`${args.url}/stats`)).json()) as StatsBody;
    const open = stats.byStatus.pending + stats.byStatus.processing;
    console.log(`waiting: pending=${stats.byStatus.pending} processing=${stats.byStatus.processing} failed=${stats.byStatus.failed}`);
    if (open === 0) return;
    if (Date.now() > deadline) throw new Error('Timed out waiting for the queue to drain');
    await sleep(5000);
  }
}

async function main(): Promise<void> {
  const sent: Sent[] = readFileSync(args.in, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Sent);
  console.log(`${sent.length} logical events in ${args.in}`);

  await waitForDrain();

  const client = await new MongoClient(args.mongoUri).connect();
  try {
    const events = client.db(args.mongoDb).collection('events');
    const patientIds = [...new Set(sent.map((s) => s.patientId))];
    const docs = await events.find({ patientId: { $in: patientIds } }).toArray();
    const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));

    const unacked = sent.filter((s) => s.eventIds.length === 0);
    check(unacked.length === 0, `every logical event was acknowledged to its sender (${unacked.length} unacknowledged)`);

    const ambiguous = sent.filter((s) => new Set(s.eventIds).size > 1);
    check(ambiguous.length === 0, `every logical event got exactly one distinct eventId (${ambiguous.length} had several)`);

    const acked = sent.filter((s) => s.eventIds.length > 0);
    const missing = acked.filter((s) => byId.get(s.eventIds[0])?.status !== 'done');
    check(missing.length === 0, `nothing lost: every acknowledged event exists and is done (${missing.length} not)`);

    check(docs.length === acked.length, `nothing duplicated: ${docs.length} documents for ${acked.length} logical events`);
    const keys = new Set(docs.map((d) => d.idempotencyKey as string));
    check(keys.size === docs.length, 'one document per idempotency key');

    const byPatient = new Map<string, typeof docs>();
    for (const d of docs) byPatient.set(d.patientId, [...(byPatient.get(d.patientId) ?? []), d]);

    let seqBad = 0;
    let orderBad = 0;
    let overlapBad = 0;
    for (const list of byPatient.values()) {
      const applied = [...list].sort((a, b) => (a.appliedSeq ?? 0) - (b.appliedSeq ?? 0));
      if (!applied.every((d, i) => d.appliedSeq === i + 1)) seqBad++;

      let maxTs = -Infinity;
      for (const d of applied) {
        const ts = (d.ts as Date).getTime();
        if (ts < maxTs !== (d.outOfOrder === true)) orderBad++; // flagged iff behind the max applied so far
        maxTs = Math.max(maxTs, ts);
      }

      for (let i = 1; i < applied.length; i++) {
        if ((applied[i].startedAt as Date) < (applied[i - 1].processedAt as Date)) overlapBad++;
      }
    }
    check(seqBad === 0, `per patient, appliedSeq is contiguous 1..n (${seqBad} patients violate)`);
    check(orderBad === 0, `per patient, ts is non-decreasing except flagged outOfOrder events (${orderBad} violations)`);
    check(overlapBad === 0, `per patient, processing intervals never overlap (${overlapBad} overlaps)`);

    const outOfOrder = docs.filter((d) => d.outOfOrder).length;
    const latencies = docs
      .filter((d) => d.processedAt)
      .map((d) => (d.processedAt as Date).getTime() - (d.receivedAt as Date).getTime())
      .sort((a, b) => a - b);
    console.log('\nReport');
    console.log(`  documents: ${docs.length}   patients: ${byPatient.size}`);
    console.log(`  outOfOrder (arrived after the reorder window): ${outOfOrder}`);
    console.log(`  max attempts on one event: ${Math.max(0, ...docs.map((d) => d.attempts as number))}`);
    console.log(
      `  end-to-end latency ms: p50=${percentile(latencies, 50)} p95=${percentile(latencies, 95)} p99=${percentile(latencies, 99)}`,
    );
  } finally {
    await client.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed: zero lost, zero duplicated, per-patient order and serialisation hold.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

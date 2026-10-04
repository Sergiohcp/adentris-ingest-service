/**
 * Load generator that behaves like a hostile-but-realistic sender:
 * shuffled arrival, duplicates (concurrent and delayed), header/derived idempotency keys,
 * and retries on timeouts / 5xx. Writes what it sent to sent.jsonl for verify.ts.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs, percentile, sleep } from './args';

const args = parseArgs({
  url: 'http://localhost:3000',
  rate: 1000, // events per minute
  duration: 300, // seconds
  patients: 300,
  dupRate: 0.1,
  shuffleWindow: 20, // seconds
  headerKeyRate: 0.5,
  out: 'sent.jsonl',
});

const runId = randomUUID().slice(0, 8);
const MAX_TRIES = 10;
const REQUEST_TIMEOUT_MS = 10_000;

interface Logical {
  logicalId: string;
  patientId: string;
  ts: string;
  body: { patientId: string; type: string; ts: string; data: Record<string, unknown> };
  headerKey?: string;
  eventIds: Set<string>;
  acknowledged: boolean;
}

const latencies: number[] = [];
const statusCounts = new Map<string, number>();
const bump = (key: string): void => void statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);

async function send(logical: Logical): Promise<void> {
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const started = performance.now();
    try {
      const res = await fetch(`${args.url}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(logical.headerKey ? { 'idempotency-key': logical.headerKey } : {}),
        },
        body: JSON.stringify(logical.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      latencies.push(performance.now() - started);
      bump(String(res.status));
      if (res.status === 202) {
        const json = (await res.json()) as { eventId: string };
        logical.eventIds.add(json.eventId);
        logical.acknowledged = true;
        return;
      }
      if (res.status < 500) return; // client error: retrying will not help
    } catch {
      bump('network/timeout');
    }
    await sleep(Math.min(5000, 200 * 2 ** attempt) * (0.5 + Math.random()));
  }
}

async function main(): Promise<void> {
  const total = Math.floor((args.rate / 60) * args.duration);
  const intervalMs = 60_000 / args.rate;
  const lastTs = new Map<string, number>();
  const logicals: Logical[] = [];
  const inFlight: Promise<void>[] = [];
  const startedAt = Date.now();

  console.log(`run=${runId} sending ${total} logical events at ${args.rate}/min over ${args.duration}s`);

  for (let i = 0; i < total; i++) {
    const patientId = `load-${runId}-p${Math.floor(Math.random() * args.patients)}`;
    // ts is the event's creation time: strictly increasing per patient.
    const ts = Math.max(Date.now(), (lastTs.get(patientId) ?? 0) + 1);
    lastTs.set(patientId, ts);

    const logical: Logical = {
      logicalId: `${runId}-${i}`,
      patientId,
      ts: new Date(ts).toISOString(),
      body: {
        patientId,
        type: ['vitals', 'lab', 'note'][i % 3],
        ts: new Date(ts).toISOString(),
        data: { seq: i, value: Math.round(Math.random() * 1000) / 10 },
      },
      headerKey: Math.random() < args.headerKeyRate ? `load-${runId}-${i}` : undefined,
      eventIds: new Set(),
      acknowledged: false,
    };
    logicals.push(logical);

    const delay = Math.random() * args.shuffleWindow * 1000; // arrives out of order
    const copies = [delay];
    if (Math.random() < args.dupRate) {
      copies.push(Math.random() < 0.5 ? delay : delay + 1000 + Math.random() * 4000); // concurrent or later
    }
    for (const d of copies) {
      inFlight.push(sleep(d).then(() => send(logical)));
    }

    const nextAt = startedAt + (i + 1) * intervalMs;
    await sleep(Math.max(0, nextAt - Date.now()));
  }

  const sendingS = (Date.now() - startedAt) / 1000;
  await Promise.all(inFlight);

  writeFileSync(args.out, '');
  for (const l of logicals) {
    appendFileSync(
      args.out,
      JSON.stringify({ logicalId: l.logicalId, patientId: l.patientId, ts: l.ts, eventIds: [...l.eventIds] }) + '\n',
    );
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const unacked = logicals.filter((l) => !l.acknowledged).length;
  console.log(`\nlogical events: ${logicals.length}   unacknowledged: ${unacked}`);
  console.log(`achieved rate: ${((logicals.length / sendingS) * 60).toFixed(0)}/min over ${sendingS.toFixed(0)}s of sending`);
  console.log(`http requests: ${latencies.length}   status counts: ${JSON.stringify(Object.fromEntries(statusCounts))}`);
  console.log(`http latency ms: p50=${percentile(sorted, 50).toFixed(1)} p95=${percentile(sorted, 95).toFixed(1)}`);
  console.log(`written to ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

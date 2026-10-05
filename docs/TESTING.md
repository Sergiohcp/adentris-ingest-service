# Testing guide

How to run the service, exercise every scenario from the brief by hand, run the automated suites and the load/chaos proof, and inspect the data in MongoDB.

## 1. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Docker (with Compose) | recent | MongoDB, API and worker |
| Node.js | 22.x | tests, load/verify scripts, dev mode |
| npm | 10+ | dependencies |
| MongoDB Compass / mongosh / DBeaver PRO | optional | browsing the data |

```bash
npm ci
```

## 2. Run with Docker (recommended)

```bash
docker compose up --build                        # MongoDB (replica set) + API + 1 worker
docker compose up --build -d --scale worker=2    # detached, 2 workers
```

| Service | Port | Role |
|---|---|---|
| `mongo` | 27017 | MongoDB 7, single-node replica set `rs0` (needed for transactions and `w: majority`) |
| `api` | 3000 | Accepts `POST /events`, answers `202` immediately |
| `worker` | — | Processes events (simulated 5 s external call each) |

```bash
docker compose ps
docker compose logs -f api worker     # logs never contain the event `data` (PHI)
docker compose down                   # stop, keep data
docker compose down -v                # stop and wipe the database
```

Health checks:

```bash
curl localhost:3000/health          # liveness
curl localhost:3000/health/ready    # MongoDB ping
curl localhost:3000/stats           # counts by status, oldest pending age, out-of-order, blocked lanes
```

## 3. Run locally in dev mode

Only MongoDB runs in Docker; the API and the worker run with hot reload:

```bash
docker compose up -d mongo
npm run dev:api        # terminal 1
npm run dev:worker     # terminal 2
```

The default `MONGO_URI` (`mongodb://localhost:27017/ingest?replicaSet=rs0&directConnection=true`) already works. `directConnection=true` is required outside Docker because the replica set advertises itself as `mongo:27017`, a hostname that only resolves inside the Compose network.

Handy overrides:

```bash
PROCESSING_DELAY_MS=1000 SIMULATED_FAILURE_RATE=0.3 MAX_ATTEMPTS=3 npm run dev:worker
REORDER_WINDOW_MS=0 npm run dev:api
LEASE_MS=100 npm run dev:worker    # fails fast: LEASE_MS must be greater than PROCESS_TIMEOUT_MS
```

To override variables in Docker, create a `docker-compose.override.yml` (picked up automatically) and run `docker compose up -d`:

```yaml
services:
  worker:
    environment:
      SIMULATED_FAILURE_RATE: "0.3"
      PROCESSING_DELAY_MS: "2000"
```

## 4. Automated tests

```bash
npm test                    # unit + integration
npm run test:unit           # pure domain/use-case tests, no database
npm run test:integration    # real MongoDB replica set (mongodb-memory-server)
npm run lint                # ESLint: no `any`, domain code may not import NestJS/MongoDB
npm run typecheck           # src, tests and scripts
npm run build
```

- The first run downloads a `mongod` binary (~150 MB).
- Integration tests do **not** need Docker: each suite starts its own in-memory replica set.
- Time and the external system are replaced by `FakeClock` and `ControllableProcessor`, so nothing actually waits 5 s.

| Area | Covered |
|---|---|
| Ingest | `202`, `400` (missing fields, bad `ts`, extra fields, empty key), `413`, `409`, `503` + `Retry-After` with MongoDB down, 20 concurrent identical POSTs → one document and one `eventId` |
| Ordering | shuffled input processed in `ts` order with `appliedSeq` 1..n; tie-break on `receivedAt` |
| Concurrency | two workers never process the same patient at once; different patients run in parallel |
| Crashes | an event abandoned mid-processing is finished by another worker after the lease, exactly once |
| Fencing | a zombie worker that lost its lease cannot record a result or release the new owner's lane |
| Retries | backoff, `failed` after `MAX_ATTEMPTS`, blocked lane, timeout enforced even if the processor ignores the abort signal |
| Poll pressure | blocked or backed-off lanes stop looking eligible; live `processing` events are not treated as orphans |
| Shutdown | the in-flight event completes before the worker stops |

## 5. Manual scenarios (curl)

With the stack running (`docker compose up -d`). To watch states change live in a second terminal:

```bash
while true; do curl -s localhost:3000/stats; echo; sleep 1; done
```

### 5.1 Submit an event and follow it

```bash
curl -i -X POST localhost:3000/events \
  -H 'content-type: application/json' \
  -d '{"patientId":"p1","type":"vitals","data":{"hr":72},"ts":"2024-05-01T10:00:00Z"}'
# 202 {"eventId":"...","status":"pending","duplicate":false}

curl localhost:3000/events/<eventId>
```

`status` goes `pending` → `processing` → `done`, after which `appliedSeq`, `processedAt` and `result` are set. `data` is never returned.

Timing: an event becomes eligible at `clamp(ts + REORDER_WINDOW_MS, receivedAt, receivedAt + REORDER_WINDOW_MS)`. A `ts` far in the past (like above) is eligible on arrival and is done in ~5 s. A `ts` close to "now" waits until `ts + 10 s` first.

### 5.2 Duplicate delivery (sender retry)

Send exactly the same POST again: same `eventId`, `"duplicate": true`, no new document. The same holds if only the `ts` spelling (`...00Z` vs `...00.000Z`) or the key order inside `data` changes.

### 5.3 Same `Idempotency-Key`, different payload → 409

```bash
curl -i -X POST localhost:3000/events -H 'content-type: application/json' -H 'Idempotency-Key: k-123' \
  -d '{"patientId":"p1","type":"vitals","data":{"hr":72},"ts":"2024-05-01T10:01:00Z"}'
curl -i -X POST localhost:3000/events -H 'content-type: application/json' -H 'Idempotency-Key: k-123' \
  -d '{"patientId":"p1","type":"vitals","data":{"hr":99},"ts":"2024-05-01T10:01:00Z"}'
# second: 409 {"error":"IDEMPOTENCY_CONFLICT","idempotencyKey":"hdr:k-123"}
```

### 5.4 Invalid payload → 400

```bash
curl -i -X POST localhost:3000/events -H 'content-type: application/json' \
  -d '{"patientId":"p1","type":"vitals","data":{},"ts":"yesterday","extra":1}'
```

### 5.5 Per-patient ordering

```bash
for ts in 10:00:30 10:00:10 10:00:20; do
  curl -s -X POST localhost:3000/events -H 'content-type: application/json' \
    -d "{\"patientId\":\"p-order\",\"type\":\"vitals\",\"data\":{},\"ts\":\"2024-05-01T${ts}Z\"}"; echo
done
```

The three events are processed one at a time (~5 s each) with `appliedSeq` 1, 2, 3 for 10:00:10, 10:00:20, 10:00:30.

Note: with a 2024 `ts` the reorder window does not apply (the events are already "old"), so this only comes out fully ordered because the three POSTs land within a few milliseconds, before the worker's next poll. If they are spread out, the lane still runs strictly one at a time, but an event that arrives after a later one was applied is processed with `outOfOrder: true`.

### 5.6 Reorder window in action

Use timestamps close to now and send them shuffled, one second apart (macOS `date` syntax; on Linux use `date -u -d @$((NOW - off))`):

```bash
NOW=$(date -u +%s)
for off in 6 2 4; do
  TS=$(date -u -r $((NOW - off)) +%Y-%m-%dT%H:%M:%SZ)
  curl -s -X POST localhost:3000/events -H 'content-type: application/json' \
    -d "{\"patientId\":\"p-window\",\"type\":\"vitals\",\"data\":{},\"ts\":\"$TS\"}"; echo
  sleep 1
done
```

Each event only becomes eligible at `ts + 10 s`, so despite the shuffled arrival they are applied in `ts` order and none is flagged.

Then send one with a `ts` older than all of them (e.g. now − 60 s): it is processed but flagged `outOfOrder: true`, and `/stats.outOfOrder` increases.

### 5.7 MongoDB down → 503

```bash
docker compose stop mongo
curl -i -X POST localhost:3000/events -H 'content-type: application/json' \
  -d '{"patientId":"p1","type":"vitals","data":{},"ts":"2024-05-01T11:00:00Z"}'
# 503 {"error":"STORAGE_UNAVAILABLE"}, Retry-After: 5
docker compose start mongo
```

### 5.8 Kill a worker mid-processing

```bash
docker compose up -d --scale worker=2
# submit a few events, then during the 5 s processing:
docker kill -s KILL $(docker compose ps -q worker | head -1)
```

After `LEASE_MS` (30 s) the surviving worker picks up the orphan and finishes it. The event ends with `attempts: 2` and is recorded exactly once (`appliedSeq` has no gap or duplicate).

### 5.9 Failures, retries and a blocked lane

Set `SIMULATED_FAILURE_RATE: "1"` and `MAX_ATTEMPTS: "3"` for the worker (see section 3). Events retry with exponential backoff, then become `failed`, and `/stats.blockedLanes` goes above zero. Later events of the same patient are intentionally held back so the sequence is not broken.

## 6. End-to-end proof: load + chaos + verify

```bash
docker compose down -v
docker compose up --build -d --scale worker=2

npm run load -- --duration 120 &    # 1000 events/min, duplicates, shuffled arrival, retries
npm run chaos &                     # SIGKILL a random worker every 20–60 s
wait %1; kill %2
npm run verify                      # waits for the queue to drain, then checks the guarantees
```

`load` flags: `--rate 1000`, `--duration 300`, `--patients 300`, `--dup-rate 0.1`, `--shuffle-window 20`, `--header-key-rate 0.5`, `--url http://localhost:3000`, `--out sent.jsonl`.
`bash scripts/chaos.sh --api` also kills the API from time to time.

`verify` exits with code 1 if any check fails. Expected output:

```
PASS  every logical event was acknowledged to its sender
PASS  every logical event got exactly one distinct eventId
PASS  nothing lost: every acknowledged event exists and is done
PASS  nothing duplicated: 2000 documents for 2000 logical events
PASS  one document per idempotency key
PASS  per patient, appliedSeq is contiguous 1..n
PASS  per patient, ts is non-decreasing except flagged outOfOrder events
PASS  per patient, processing intervals never overlap
```

## 7. Inspecting the data

Connection string for any client, from the host:

```
mongodb://localhost:27017/ingest?directConnection=true
```

`directConnection=true` is required; without it the client tries to reach `mongo:27017` and hangs. No authentication is configured locally.

- **mongosh, nothing to install:** `docker compose exec mongo mongosh ingest`
- **MongoDB Compass** (free): paste the connection string above.
- **DBeaver:** MongoDB support is only in DBeaver PRO (Enterprise/Ultimate/Team), not in Community. Create a MongoDB connection to `localhost:27017`, database `ingest`, no authentication, and add `directConnection=true`.

Collections:

| Collection | Contents |
|---|---|
| `events` | Inbox, queue and outcome in one document per event: `status`, `attempts`, `availableAt`, `startedAt`, `processedAt`, `appliedSeq`, `outOfOrder`, `result`, `lastError` |
| `patient_lanes` | One document per patient (`_id` = `patientId`): current owner (`token`, `owner`, `lockedUntil`), `appliedCount`, `lastAppliedTs` |

Useful queries:

```js
// A patient's events in the order they were applied (without the PHI payload)
db.events.find({ patientId: "p-order" }, { data: 0 }).sort({ appliedSeq: 1 })

// What is still queued
db.events.find({ status: { $in: ["pending", "processing"] } }).sort({ availableAt: 1 })

// Late arrivals and failures
db.events.find({ outOfOrder: true })
db.events.find({ status: "failed" }, { patientId: 1, attempts: 1, lastError: 1 })

// Counts by status
db.events.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])

// Lanes currently held
db.patient_lanes.find({ token: { $ne: null } })

// Indexes created at boot
db.events.getIndexes()
```

One-liner from the shell:

```bash
docker compose exec mongo mongosh ingest --quiet \
  --eval 'db.events.find({patientId:"p-order"},{data:0}).sort({appliedSeq:1})'
```

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl localhost:3000` refused | build failed or API still starting | `docker compose ps`, `docker compose logs api`; run `docker compose up --build` without `-d` to see the error |
| Port 27017 or 3000 in use | another MongoDB/app running | stop it or change the port mapping in `docker-compose.yml` |
| GUI client hangs on connect | missing `directConnection=true` | add it to the connection string |
| Events stay `pending` | worker down, or `ts` is recent and the 10 s reorder window has not elapsed | `docker compose logs worker`; wait, or set `REORDER_WINDOW_MS=0` |
| First `npm test` is slow | `mongod` binary download | one-time |
| `verify` reports unacknowledged events | API was down during `load` | check `docker compose ps` before the load run |
| Start from scratch | old data in the volume | `docker compose down -v` |

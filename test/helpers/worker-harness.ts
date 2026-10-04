import { Test, TestingModule } from '@nestjs/testing';
import { Collection, MongoClient, ObjectId } from 'mongodb';
import { AppConfig, APP_CONFIG } from '../../src/config/configuration';
import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { EventDocument, PatientLaneDocument } from '../../src/database/documents';
import { EVENTS_COLLECTION, LANES_COLLECTION } from '../../src/database/mongo.provider';
import { EVENT_PROCESSOR } from '../../src/processing/application/event-processor';
import { ProcessLaneUseCase } from '../../src/processing/application/process-lane.use-case';
import { LANE_REPOSITORY, LaneRepository } from '../../src/processing/application/lane.repository';
import { EVENT_COMPLETION, EventCompletion } from '../../src/processing/application/completion.service';
import { PROCESSING_EVENT_REPOSITORY, ProcessingEventRepository } from '../../src/processing/application/processing-event.repository';
import { ProcessingModule } from '../../src/processing/processing.module';
import { WorkerRunner } from '../../src/processing/worker/worker.runner';
import { CLOCK } from '../../src/shared/clock';
import { SharedModule } from '../../src/shared/shared.module';
import { sleep } from '../../src/shared/time';
import { ControllableProcessor } from './controllable-processor';
import { FakeClock } from './fake-clock';

export interface Worker {
  moduleRef: TestingModule;
  runner: WorkerRunner;
  processLane: ProcessLaneUseCase;
  lanes: LaneRepository;
  events: ProcessingEventRepository;
  completion: EventCompletion;
  close(): Promise<void>;
}

/** A worker process in miniature: its own Nest module, sharing the database under test. */
export async function createWorker(
  config: AppConfig,
  clock: FakeClock,
  processor: ControllableProcessor,
): Promise<Worker> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, SharedModule, DatabaseModule, ProcessingModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(EVENT_PROCESSOR)
    .useValue(processor)
    .compile();
  await moduleRef.init();
  return {
    moduleRef,
    runner: moduleRef.get(WorkerRunner),
    processLane: moduleRef.get(ProcessLaneUseCase),
    lanes: moduleRef.get<LaneRepository>(LANE_REPOSITORY),
    events: moduleRef.get<ProcessingEventRepository>(PROCESSING_EVENT_REPOSITORY),
    completion: moduleRef.get<EventCompletion>(EVENT_COMPLETION),
    close: () => moduleRef.close(),
  };
}

export interface SeedOptions {
  patientId: string;
  ts: Date;
  receivedAt?: Date;
  availableAt?: Date;
  key?: string;
}

export class Db {
  readonly events: Collection<EventDocument>;
  readonly lanes: Collection<PatientLaneDocument>;

  constructor(readonly client: MongoClient, config: AppConfig) {
    const db = client.db(config.mongoDb);
    this.events = db.collection<EventDocument>('events');
    this.lanes = db.collection<PatientLaneDocument>('patient_lanes');
  }

  async seed(opts: SeedOptions, clock: FakeClock): Promise<ObjectId> {
    const _id = new ObjectId();
    const receivedAt = opts.receivedAt ?? clock.now();
    await this.events.insertOne({
      _id,
      idempotencyKey: opts.key ?? `k-${_id.toHexString()}`,
      payloadHash: 'h',
      patientId: opts.patientId,
      type: 'vitals',
      data: { secret: true },
      ts: opts.ts,
      receivedAt,
      availableAt: opts.availableAt ?? receivedAt,
      status: 'pending',
      attempts: 0,
    });
    return _id;
  }

  async clear(): Promise<void> {
    await this.events.deleteMany({});
    await this.lanes.deleteMany({});
  }
}

export async function waitFor(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(10);
  }
}

export { EVENTS_COLLECTION, LANES_COLLECTION };

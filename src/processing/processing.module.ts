import { Module } from '@nestjs/common';
import { AppConfig, APP_CONFIG } from '../config/configuration';
import { EVENT_COMPLETION } from './application/completion.service';
import { EVENT_PROCESSOR } from './application/event-processor';
import { LANE_REPOSITORY } from './application/lane.repository';
import { ProcessLaneUseCase } from './application/process-lane.use-case';
import { PROCESSING_EVENT_REPOSITORY } from './application/processing-event.repository';
import { RetryPolicy } from './domain/retry-policy';
import { MongoEventCompletion } from './infrastructure/mongo-completion';
import { MongoLaneRepository } from './infrastructure/mongo-lane.repository';
import { MongoProcessingEventRepository, RETRY_POLICY } from './infrastructure/mongo-processing-event.repository';
import { SimulatedProcessor } from './infrastructure/simulated-processor';
import { WorkerRunner } from './worker/worker.runner';

@Module({
  providers: [
    {
      provide: RETRY_POLICY,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        new RetryPolicy({ maxAttempts: c.maxAttempts, baseMs: c.backoffBaseMs, maxMs: c.backoffMaxMs }),
    },
    { provide: PROCESSING_EVENT_REPOSITORY, useClass: MongoProcessingEventRepository },
    { provide: LANE_REPOSITORY, useClass: MongoLaneRepository },
    { provide: EVENT_COMPLETION, useClass: MongoEventCompletion },
    { provide: EVENT_PROCESSOR, useClass: SimulatedProcessor },
    ProcessLaneUseCase,
    WorkerRunner,
  ],
  exports: [WorkerRunner, ProcessLaneUseCase, PROCESSING_EVENT_REPOSITORY, LANE_REPOSITORY],
})
export class ProcessingModule {}

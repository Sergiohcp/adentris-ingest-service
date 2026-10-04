import { Module } from '@nestjs/common';
import { EventsController } from './api/events.controller';
import { EVENT_REPOSITORY } from './application/event.repository';
import { GetEventUseCase } from './application/get-event.use-case';
import { IngestEventUseCase } from './application/ingest-event.use-case';
import { MongoEventRepository } from './infrastructure/mongo-event.repository';

@Module({
  controllers: [EventsController],
  providers: [
    IngestEventUseCase,
    GetEventUseCase,
    { provide: EVENT_REPOSITORY, useClass: MongoEventRepository },
  ],
})
export class EventsModule {}

import { Inject, Injectable } from '@nestjs/common';
import { Collection, ObjectId } from 'mongodb';
import { EventDocument } from '../../database/documents';
import { EVENTS_COLLECTION } from '../../database/mongo.provider';
import { EventRepository } from '../application/event.repository';
import { IngestedEvent, NewEvent } from '../domain/event';
import { toIngestedEvent } from './event-mapper';

@Injectable()
export class MongoEventRepository implements EventRepository {
  constructor(@Inject(EVENTS_COLLECTION) private readonly events: Collection<EventDocument>) {}

  async insertPending(event: NewEvent): Promise<string> {
    const { insertedId } = await this.events.insertOne(
      { _id: new ObjectId(), ...event, status: 'pending', attempts: 0 },
      { writeConcern: { w: 'majority', j: true } },
    );
    return insertedId.toHexString();
  }

  async findByIdempotencyKey(key: string): Promise<IngestedEvent | null> {
    // Read from the primary with majority so a just-committed duplicate is visible.
    const doc = await this.events.findOne({ idempotencyKey: key }, { readConcern: { level: 'majority' } });
    return doc ? toIngestedEvent(doc) : null;
  }

  async findById(id: string): Promise<IngestedEvent | null> {
    const doc = await this.events.findOne({ _id: new ObjectId(id) });
    return doc ? toIngestedEvent(doc) : null;
  }
}

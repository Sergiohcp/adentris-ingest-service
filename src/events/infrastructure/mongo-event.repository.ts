import { Inject, Injectable } from '@nestjs/common';
import { Collection, ObjectId } from 'mongodb';
import { EventDocument } from '../../database/documents';
import { EVENTS_COLLECTION } from '../../database/mongo.provider';
import { EventRepository } from '../application/event.repository';
import { IngestedEvent, NewEvent } from '../domain/event';
import { DuplicateIdempotencyKeyError } from '../domain/errors';
import { isDuplicateKeyError } from '../../shared/mongo-errors';
import { sleep } from '../../shared/time';

const DUPLICATE_READ_TRIES = 5;
const DUPLICATE_READ_DELAY_MS = 100;
import { toIngestedEvent } from './event-mapper';

@Injectable()
export class MongoEventRepository implements EventRepository {
  constructor(@Inject(EVENTS_COLLECTION) private readonly events: Collection<EventDocument>) {}

  async insertPending(event: NewEvent): Promise<string> {
    try {
      const { insertedId } = await this.events.insertOne(
        { _id: new ObjectId(), ...event, status: 'pending', attempts: 0 },
        { writeConcern: { w: 'majority', j: true } },
      );
      return insertedId.toHexString();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new DuplicateIdempotencyKeyError(event.idempotencyKey);
      throw err;
    }
  }

  async findByIdempotencyKey(key: string): Promise<IngestedEvent | null> {
    // Majority read: a racing original may still be replicating, so give it a moment.
    for (let attempt = 1; attempt <= DUPLICATE_READ_TRIES; attempt++) {
      const doc = await this.events.findOne({ idempotencyKey: key }, { readConcern: { level: 'majority' } });
      if (doc) return toIngestedEvent(doc);
      if (attempt < DUPLICATE_READ_TRIES) await sleep(DUPLICATE_READ_DELAY_MS);
    }
    return null;
  }

  async findById(id: string): Promise<IngestedEvent | null> {
    const doc = await this.events.findOne({ _id: new ObjectId(id) });
    return doc ? toIngestedEvent(doc) : null;
  }
}

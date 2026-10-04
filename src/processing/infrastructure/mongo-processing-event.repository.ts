import { Inject, Injectable } from '@nestjs/common';
import { Collection, Document, ObjectId } from 'mongodb';
import { EventDocument } from '../../database/documents';
import { EVENTS_COLLECTION } from '../../database/mongo.provider';
import { IngestedEvent } from '../../events/domain/event';
import { toIngestedEvent } from '../../events/infrastructure/event-mapper';
import { addMs } from '../../shared/clock';
import { ProcessingEventRepository } from '../application/processing-event.repository';
import { RetryPolicy } from '../domain/retry-policy';

export const RETRY_POLICY = Symbol('RETRY_POLICY');

const ELIGIBILITY_SCAN_LIMIT = 1000;
const MAX_ERROR_LENGTH = 500;

@Injectable()
export class MongoProcessingEventRepository implements ProcessingEventRepository {
  constructor(
    @Inject(EVENTS_COLLECTION) private readonly events: Collection<EventDocument>,
    @Inject(RETRY_POLICY) private readonly retryPolicy: RetryPolicy,
  ) {}

  async findPatientsWithEligibleWork(now: Date, limit: number): Promise<string[]> {
    const rows = await this.events
      .aggregate<{ _id: string }>([
        // `processing` is included on purpose: it is an orphan if its worker died. A live owner
        // simply wins the lane first, so the acquire attempt fails and the patient is skipped.
        { $match: { status: { $in: ['pending', 'processing'] }, availableAt: { $lte: now } } },
        { $sort: { availableAt: 1 } },
        { $limit: ELIGIBILITY_SCAN_LIMIT },
        { $group: { _id: '$patientId', oldest: { $min: '$availableAt' } } },
        { $sort: { oldest: 1 } },
        { $limit: limit },
      ])
      .toArray();
    return rows.map((row) => row._id);
  }

  async findLaneHead(patientId: string): Promise<IngestedEvent | null> {
    const doc = await this.events.findOne(
      { patientId, status: { $in: ['pending', 'processing', 'failed'] } },
      { sort: { ts: 1, receivedAt: 1, _id: 1 } },
    );
    return doc ? toIngestedEvent(doc) : null;
  }

  async markProcessing(eventId: string, token: string, now: Date): Promise<IngestedEvent | null> {
    const doc = await this.events.findOneAndUpdate(
      { _id: new ObjectId(eventId), status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'processing', laneToken: token, startedAt: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    return doc ? toIngestedEvent(doc) : null;
  }

  async recordFailure(event: IngestedEvent, token: string, error: Error, now: Date): Promise<void> {
    const lastError = error.message.slice(0, MAX_ERROR_LENGTH);
    const update: Document = this.retryPolicy.isExhausted(event.attempts)
      ? { $set: { lastError, status: 'failed', failedAt: now }, $unset: { laneToken: '' } }
      : {
          $set: {
            lastError,
            status: 'pending',
            availableAt: addMs(now, this.retryPolicy.nextDelayMs(event.attempts)),
          },
          $unset: { laneToken: '' },
        };
    await this.events.updateOne({ _id: new ObjectId(event.id), status: 'processing', laneToken: token }, update);
  }
}

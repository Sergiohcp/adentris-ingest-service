import { Inject, Injectable } from '@nestjs/common';
import { Collection, MongoClient, ObjectId } from 'mongodb';
import { AppConfig, APP_CONFIG } from '../../config/configuration';
import { EventDocument, PatientLaneDocument } from '../../database/documents';
import { EVENTS_COLLECTION, LANES_COLLECTION, MONGO_CLIENT } from '../../database/mongo.provider';
import { IngestedEvent } from '../../events/domain/event';
import { addMs, Clock, CLOCK } from '../../shared/clock';
import { EventCompletion } from '../application/completion.service';
import { ProcessingResult } from '../application/event-processor';
import { LeaseLostError } from '../domain/errors';

@Injectable()
export class MongoEventCompletion implements EventCompletion {
  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(EVENTS_COLLECTION) private readonly events: Collection<EventDocument>,
    @Inject(LANES_COLLECTION) private readonly lanes: Collection<PatientLaneDocument>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async complete(event: IngestedEvent, token: string, result: ProcessingResult): Promise<void> {
    const session = this.client.startSession();
    try {
      // The callback may run more than once (transient write conflicts): DB writes only.
      await session.withTransaction(
        async () => {
          const now = this.clock.now();

          const lane = await this.lanes.findOneAndUpdate(
            { _id: event.patientId, token },
            {
              $inc: { appliedCount: 1 },
              $max: { lastAppliedTs: event.ts },
              $set: { lockedUntil: addMs(now, this.config.leaseMs) },
            },
            { session, returnDocument: 'before' },
          );
          if (!lane) throw new LeaseLostError(event.patientId);

          const { modifiedCount } = await this.events.updateOne(
            { _id: new ObjectId(event.id), status: 'processing', laneToken: token },
            {
              $set: {
                status: 'done',
                result,
                processedAt: now,
                appliedSeq: lane.appliedCount + 1,
                outOfOrder: lane.lastAppliedTs !== null && event.ts < lane.lastAppliedTs,
              },
              $unset: { laneToken: '' },
            },
            { session },
          );
          if (modifiedCount === 0) throw new LeaseLostError(event.patientId);
        },
        { writeConcern: { w: 'majority' } },
      );
    } finally {
      await session.endSession();
    }
  }
}

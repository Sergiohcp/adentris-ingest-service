import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Collection } from 'mongodb';
import { AppConfig, APP_CONFIG } from '../../config/configuration';
import { PatientLaneDocument } from '../../database/documents';
import { LANES_COLLECTION } from '../../database/mongo.provider';
import { isDuplicateKeyError } from '../../shared/mongo-errors';
import { addMs } from '../../shared/clock';
import { LaneRepository } from '../application/lane.repository';
import { LaneLease } from '../domain/lane';

@Injectable()
export class MongoLaneRepository implements LaneRepository {
  constructor(
    @Inject(LANES_COLLECTION) private readonly lanes: Collection<PatientLaneDocument>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async tryAcquire(patientId: string, workerId: string, now: Date): Promise<LaneLease | null> {
    const token = randomUUID();
    try {
      const lane = await this.lanes.findOneAndUpdate(
        { _id: patientId, $or: [{ token: null }, { lockedUntil: { $lte: now } }] },
        {
          $set: { token, owner: workerId, lockedUntil: addMs(now, this.config.leaseMs) },
          $setOnInsert: { lastAppliedTs: null, appliedCount: 0 },
        },
        { upsert: true, returnDocument: 'after' },
      );
      return lane ? { patientId, token } : null;
    } catch (err) {
      if (isDuplicateKeyError(err)) return null; // lane exists and is held
      throw err;
    }
  }

  async renew(lease: LaneLease, now: Date): Promise<boolean> {
    const { matchedCount } = await this.lanes.updateOne(
      { _id: lease.patientId, token: lease.token },
      { $set: { lockedUntil: addMs(now, this.config.leaseMs) } },
    );
    return matchedCount === 1;
  }

  async release(lease: LaneLease): Promise<void> {
    await this.lanes.updateOne(
      { _id: lease.patientId, token: lease.token },
      { $set: { token: null, owner: null, lockedUntil: null } },
    );
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Collection } from 'mongodb';
import { EventDocument } from '../database/documents';
import { EVENTS_COLLECTION } from '../database/mongo.provider';
import { Clock, CLOCK } from '../shared/clock';
import { EventStatus } from '../events/domain/event';

export interface Stats {
  byStatus: Record<EventStatus, number>;
  oldestPendingAgeMs: number | null;
  outOfOrder: number;
  blockedLanes: number;
}

@Injectable()
export class StatsService {
  constructor(
    @Inject(EVENTS_COLLECTION) private readonly events: Collection<EventDocument>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(): Promise<Stats> {
    const [groups, oldest, outOfOrder, blockedLanes] = await Promise.all([
      this.events.aggregate<{ _id: EventStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
      this.events.find({ status: 'pending' }).sort({ receivedAt: 1 }).limit(1).project<{ receivedAt: Date }>({ receivedAt: 1 }).next(),
      this.events.countDocuments({ outOfOrder: true }),
      this.events.countDocuments({ status: 'failed' }),
    ]);

    const byStatus: Record<EventStatus, number> = { pending: 0, processing: 0, done: 0, failed: 0 };
    for (const group of groups) byStatus[group._id] = group.n;

    return {
      byStatus,
      oldestPendingAgeMs: oldest ? this.clock.now().getTime() - oldest.receivedAt.getTime() : null,
      outOfOrder,
      blockedLanes,
    };
  }
}

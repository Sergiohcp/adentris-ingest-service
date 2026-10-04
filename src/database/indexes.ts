import { Collection } from 'mongodb';
import { EventDocument } from './documents';

export async function ensureIndexes(events: Collection<EventDocument>): Promise<void> {
  await events.createIndexes([
    { key: { idempotencyKey: 1 }, name: 'uniq_idempotency_key', unique: true },
    { key: { patientId: 1, ts: 1, receivedAt: 1, _id: 1 }, name: 'lane_head' },
    {
      key: { status: 1, availableAt: 1 },
      name: 'work_queue',
      partialFilterExpression: { status: { $in: ['pending', 'processing'] } },
    },
  ]);
}

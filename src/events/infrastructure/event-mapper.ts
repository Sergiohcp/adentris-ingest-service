import { EventDocument } from '../../database/documents';
import { IngestedEvent } from '../domain/event';

export function toIngestedEvent(doc: EventDocument): IngestedEvent {
  return {
    id: doc._id.toHexString(),
    idempotencyKey: doc.idempotencyKey,
    payloadHash: doc.payloadHash,
    patientId: doc.patientId,
    type: doc.type,
    data: doc.data,
    ts: doc.ts,
    receivedAt: doc.receivedAt,
    availableAt: doc.availableAt,
    status: doc.status,
    attempts: doc.attempts,
    startedAt: doc.startedAt,
    processedAt: doc.processedAt,
    result: doc.result,
    appliedSeq: doc.appliedSeq,
    outOfOrder: doc.outOfOrder,
  };
}

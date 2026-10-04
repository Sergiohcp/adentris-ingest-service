import { IngestedEvent } from '../domain/event';

export function toEventResponse(event: IngestedEvent) {
  return {
    eventId: event.id,
    patientId: event.patientId,
    type: event.type,
    ts: event.ts,
    status: event.status,
    attempts: event.attempts,
    receivedAt: event.receivedAt,
    processedAt: event.processedAt ?? null,
    appliedSeq: event.appliedSeq ?? null,
    outOfOrder: event.outOfOrder ?? false,
    result: event.result ?? null,
  };
}

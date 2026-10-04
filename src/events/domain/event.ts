export type EventStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface IncomingEvent {
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: Date;
}

export interface IngestedEvent extends IncomingEvent {
  id: string;
  idempotencyKey: string;
  payloadHash: string;
  receivedAt: Date;
  availableAt: Date;
  status: EventStatus;
  attempts: number;
  startedAt?: Date;
  processedAt?: Date;
  result?: Record<string, unknown>;
  appliedSeq?: number;
  outOfOrder?: boolean;
}

export type NewEvent = IncomingEvent & {
  idempotencyKey: string;
  payloadHash: string;
  receivedAt: Date;
  availableAt: Date;
};

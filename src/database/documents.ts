import { ObjectId } from 'mongodb';
import { EventStatus } from '../events/domain/event';

export interface EventDocument {
  _id: ObjectId;
  idempotencyKey: string;
  payloadHash: string;
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: Date;
  receivedAt: Date;
  availableAt: Date;
  status: EventStatus;
  attempts: number;
  laneToken?: string;
  startedAt?: Date;
  processedAt?: Date;
  failedAt?: Date;
  result?: Record<string, unknown>;
  appliedSeq?: number;
  outOfOrder?: boolean;
  lastError?: string;
}

export interface PatientLaneDocument {
  _id: string;
  token: string | null;
  owner: string | null;
  lockedUntil: Date | null;
  lastAppliedTs: Date | null;
  appliedCount: number;
}

import { IngestedEvent } from '../../events/domain/event';

export interface ProcessingEventRepository {
  findPatientsWithEligibleWork(now: Date, limit: number): Promise<string[]>;
  /** Earliest (ts, receivedAt, _id) event of the patient that is not done. */
  findLaneHead(patientId: string): Promise<IngestedEvent | null>;
  /** Claim the event for this lane token (also re-claims an orphan left by a dead worker). */
  markProcessing(eventId: string, token: string, now: Date): Promise<IngestedEvent | null>;
  /** Fenced: retry with backoff, or `failed` when attempts are exhausted. */
  recordFailure(event: IngestedEvent, token: string, error: Error, now: Date): Promise<void>;
}

export const PROCESSING_EVENT_REPOSITORY = Symbol('PROCESSING_EVENT_REPOSITORY');

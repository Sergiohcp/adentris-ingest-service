import { IngestedEvent } from '../../events/domain/event';

export interface ProcessingEventRepository {
  /** Patients with a pending event due now, or an event orphaned in `processing` past its lease. */
  findPatientsWithEligibleWork(now: Date, limit: number): Promise<string[]>;
  /** Raises the patient's pending events to at least `until` (they cannot run before the head anyway). */
  deferLane(patientId: string, until: Date): Promise<void>;
  /** Earliest (ts, receivedAt, _id) event of the patient that is not done. */
  findLaneHead(patientId: string): Promise<IngestedEvent | null>;
  /** Claim the event for this lane token (also re-claims an orphan left by a dead worker). */
  markProcessing(eventId: string, token: string, now: Date): Promise<IngestedEvent | null>;
  /** Fenced: retry with backoff, or `failed` when attempts are exhausted. */
  recordFailure(event: IngestedEvent, token: string, error: Error, now: Date): Promise<void>;
}

export const PROCESSING_EVENT_REPOSITORY = Symbol('PROCESSING_EVENT_REPOSITORY');

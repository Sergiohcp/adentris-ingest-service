import { DomainError } from '../../shared/errors';

/** The lane (or the event claim) now belongs to someone else: discard the work. */
export class LeaseLostError extends DomainError {
  constructor(readonly patientId: string) {
    super(`Lease lost for patient ${patientId}`);
  }
}

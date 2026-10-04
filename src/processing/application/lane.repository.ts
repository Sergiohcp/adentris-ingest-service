import { LaneLease } from '../domain/lane';

export interface LaneRepository {
  /** Atomically take the patient's lane if free or expired. Null when someone else holds it. */
  tryAcquire(patientId: string, workerId: string, now: Date): Promise<LaneLease | null>;
  /** Extend the lease. False when the lease was lost. */
  renew(lease: LaneLease, now: Date): Promise<boolean>;
  release(lease: LaneLease): Promise<void>;
}

export const LANE_REPOSITORY = Symbol('LANE_REPOSITORY');

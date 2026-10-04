/** availableAt given to events queued behind a failed head, so a blocked lane stops being polled. */
export const BLOCKED_LANE_AVAILABLE_AT = new Date('9999-12-31T00:00:00.000Z');

export interface LaneLease {
  patientId: string;
  token: string;
}

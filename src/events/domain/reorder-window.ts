/** clamp(ts + windowMs, receivedAt, receivedAt + windowMs) */
export function computeAvailableAt(ts: Date, receivedAt: Date, windowMs: number): Date {
  const earliest = receivedAt.getTime();
  const latest = earliest + windowMs;
  const wanted = ts.getTime() + windowMs;
  return new Date(Math.min(Math.max(wanted, earliest), latest));
}

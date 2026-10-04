import { computeAvailableAt } from './reorder-window';

const W = 10_000;
const received = new Date('2024-01-01T10:00:00Z');

describe('computeAvailableAt', () => {
  it('on-time event waits until ts + W', () => {
    const ts = new Date(received.getTime() - 4_000);
    expect(computeAvailableAt(ts, received, W).getTime()).toBe(ts.getTime() + W);
  });
  it('very old event is available immediately', () => {
    const ts = new Date(received.getTime() - 3_600_000);
    expect(computeAvailableAt(ts, received, W)).toEqual(received);
  });
  it('future ts waits at most W after arrival', () => {
    const ts = new Date(received.getTime() + 3_600_000);
    expect(computeAvailableAt(ts, received, W).getTime()).toBe(received.getTime() + W);
  });
  it('W = 0 returns receivedAt', () => {
    expect(computeAvailableAt(new Date(received.getTime() - 5), received, 0)).toEqual(received);
  });
});

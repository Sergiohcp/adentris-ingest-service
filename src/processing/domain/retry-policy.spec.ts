import { RetryPolicy } from './retry-policy';

const policy = (random = () => 1) => new RetryPolicy({ maxAttempts: 3, baseMs: 1000, maxMs: 5000, random });

describe('RetryPolicy', () => {
  it('is exhausted at maxAttempts', () => {
    expect(policy().isExhausted(2)).toBe(false);
    expect(policy().isExhausted(3)).toBe(true);
    expect(policy().isExhausted(4)).toBe(true);
  });

  it('grows exponentially', () => {
    const p = policy(() => 0.999999);
    expect(p.nextDelayMs(1)).toBeLessThanOrEqual(1000);
    expect(p.nextDelayMs(2)).toBeLessThanOrEqual(2000);
    expect(p.nextDelayMs(2)).toBeGreaterThan(1000);
  });

  it('caps at maxMs', () => {
    expect(policy(() => 0.999999).nextDelayMs(20)).toBeLessThanOrEqual(5000);
    expect(policy(() => 0.999999).nextDelayMs(20)).toBeGreaterThan(4900);
  });

  it('applies full jitter deterministically', () => {
    expect(policy(() => 0).nextDelayMs(3)).toBe(0);
    expect(policy(() => 0.5).nextDelayMs(3)).toBe(2000);
  });
});

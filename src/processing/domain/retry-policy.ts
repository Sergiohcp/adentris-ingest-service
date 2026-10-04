export interface RetryPolicyOptions {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
  random?: () => number;
}

export class RetryPolicy {
  private readonly random: () => number;

  constructor(private readonly opts: RetryPolicyOptions) {
    this.random = opts.random ?? Math.random;
  }

  isExhausted(attempts: number): boolean {
    return attempts >= this.opts.maxAttempts;
  }

  /** Full jitter: random() * min(maxMs, baseMs * 2^(attempts-1)). */
  nextDelayMs(attempts: number): number {
    const exponential = this.opts.baseMs * 2 ** Math.max(0, attempts - 1);
    return Math.floor(this.random() * Math.min(this.opts.maxMs, exponential));
  }
}

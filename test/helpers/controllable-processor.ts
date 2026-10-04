import { EventProcessor, ProcessingResult } from '../../src/processing/application/event-processor';
import { IngestedEvent } from '../../src/events/domain/event';
import { sleep } from '../../src/shared/time';

interface Deferred {
  event: IngestedEvent;
  resolve: (r: ProcessingResult) => void;
  reject: (e: Error) => void;
}

/**
 * Test double for the external system.
 * auto mode (default): every call succeeds after `autoDelayMs`.
 * manual mode: each call waits until the test resolves/rejects it.
 */
export class ControllableProcessor implements EventProcessor {
  mode: 'auto' | 'manual' = 'auto';
  autoDelayMs = 5;
  failWhen: (event: IngestedEvent) => boolean = () => false;
  /** Simulates an external client that does not honour AbortSignal. */
  ignoreAbort = false;

  readonly started: IngestedEvent[] = [];
  readonly waiting: Deferred[] = [];
  private readonly active = new Map<string, number>();
  maxConcurrentForAnyPatient = 0;
  maxConcurrentOverall = 0;
  private activeOverall = 0;

  async process(event: IngestedEvent, signal: AbortSignal): Promise<ProcessingResult> {
    this.started.push(event);
    const n = (this.active.get(event.patientId) ?? 0) + 1;
    this.active.set(event.patientId, n);
    this.activeOverall++;
    this.maxConcurrentForAnyPatient = Math.max(this.maxConcurrentForAnyPatient, n);
    this.maxConcurrentOverall = Math.max(this.maxConcurrentOverall, this.activeOverall);
    try {
      if (this.mode === 'manual') {
        return await new Promise<ProcessingResult>((resolve, reject) => {
          this.waiting.push({ event, resolve, reject });
          if (!this.ignoreAbort) signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      await sleep(this.autoDelayMs, signal);
      if (this.failWhen(event)) throw new Error('boom');
      return { ok: true };
    } finally {
      this.active.set(event.patientId, (this.active.get(event.patientId) ?? 1) - 1);
      this.activeOverall--;
    }
  }

  /** Waits until `count` calls are parked in manual mode. */
  async waitForWaiting(count = 1, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.waiting.length < count) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} parked calls`);
      await sleep(5);
    }
  }

  resolveNext(result: ProcessingResult = { ok: true }): IngestedEvent {
    const next = this.waiting.shift();
    if (!next) throw new Error('No parked call');
    next.resolve(result);
    return next.event;
  }

  rejectNext(message = 'boom'): void {
    const next = this.waiting.shift();
    if (!next) throw new Error('No parked call');
    next.reject(new Error(message));
  }
}

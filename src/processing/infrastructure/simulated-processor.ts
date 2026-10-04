import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, APP_CONFIG } from '../../config/configuration';
import { IngestedEvent } from '../../events/domain/event';
import { sleep } from '../../shared/time';
import { EventProcessor, ProcessingResult } from '../application/event-processor';

/** Stands in for the slow external system. Receives the idempotency key, as a real one would. */
@Injectable()
export class SimulatedProcessor implements EventProcessor {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async process(event: IngestedEvent, signal: AbortSignal): Promise<ProcessingResult> {
    await sleep(this.config.processingDelayMs, signal);
    if (Math.random() < this.config.simulatedFailureRate) throw new Error('Simulated external failure');
    return { processedBy: 'simulated', idempotencyKey: event.idempotencyKey };
  }
}

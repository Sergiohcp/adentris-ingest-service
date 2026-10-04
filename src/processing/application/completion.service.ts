import { IngestedEvent } from '../../events/domain/event';
import { ProcessingResult } from './event-processor';

export interface EventCompletion {
  /** Atomically marks the event done and advances the lane. Throws LeaseLostError when fenced out. */
  complete(event: IngestedEvent, token: string, result: ProcessingResult): Promise<void>;
}

export const EVENT_COMPLETION = Symbol('EVENT_COMPLETION');

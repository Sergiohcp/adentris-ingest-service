import { IngestedEvent } from '../../events/domain/event';

export type ProcessingResult = Record<string, unknown>;

export interface EventProcessor {
  process(event: IngestedEvent, signal: AbortSignal): Promise<ProcessingResult>;
}

export const EVENT_PROCESSOR = Symbol('EVENT_PROCESSOR');

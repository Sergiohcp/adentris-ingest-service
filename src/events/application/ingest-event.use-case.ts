import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, APP_CONFIG } from '../../config/configuration';
import { Clock, CLOCK } from '../../shared/clock';
import { EventStatus, IncomingEvent } from '../domain/event';
import { DuplicateIdempotencyKeyError, IdempotencyConflictError } from '../domain/errors';
import { StorageUnavailableError } from '../../shared/errors';
import { hashPayload, resolveIdempotencyKey } from '../domain/idempotency-key';
import { computeAvailableAt } from '../domain/reorder-window';
import { EventRepository, EVENT_REPOSITORY } from './event.repository';

export interface IngestResult {
  eventId: string;
  status: EventStatus;
  duplicate: boolean;
}

@Injectable()
export class IngestEventUseCase {
  constructor(
    @Inject(EVENT_REPOSITORY) private readonly events: EventRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(input: IncomingEvent, headerKey?: string): Promise<IngestResult> {
    const receivedAt = this.clock.now();
    const payloadHash = hashPayload(input);
    const idempotencyKey = resolveIdempotencyKey(headerKey, payloadHash);

    try {
      const eventId = await this.events.insertPending({
        ...input,
        idempotencyKey,
        payloadHash,
        receivedAt,
        availableAt: computeAvailableAt(input.ts, receivedAt, this.config.reorderWindowMs),
      });
      return { eventId, status: 'pending', duplicate: false };
    } catch (err) {
      if (!(err instanceof DuplicateIdempotencyKeyError)) throw err;
      const existing = await this.events.findByIdempotencyKey(idempotencyKey);
      // The original exists but is not majority-committed yet: never 2xx on it, ask for a retry.
      if (!existing) throw new StorageUnavailableError('original event not yet durable');
      if (existing.payloadHash !== payloadHash) throw new IdempotencyConflictError(idempotencyKey);
      return { eventId: existing.id, status: existing.status, duplicate: true };
    }
  }
}

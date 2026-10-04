import { IngestedEvent, NewEvent } from '../domain/event';

export interface EventRepository {
  /** Durable insert (w: majority, j: true). Throws a duplicate-key error on idempotency key reuse. */
  insertPending(event: NewEvent): Promise<string>;
  findByIdempotencyKey(key: string): Promise<IngestedEvent | null>;
  findById(id: string): Promise<IngestedEvent | null>;
}

export const EVENT_REPOSITORY = Symbol('EVENT_REPOSITORY');

import { IngestedEvent, NewEvent } from '../domain/event';

export interface EventRepository {
  /** Durable insert (w: majority, j: true). Throws DuplicateIdempotencyKeyError on key reuse. */
  insertPending(event: NewEvent): Promise<string>;
  /** Majority-committed read; null if the event is not (yet) durably visible. */
  findByIdempotencyKey(key: string): Promise<IngestedEvent | null>;
  findById(id: string): Promise<IngestedEvent | null>;
}

export const EVENT_REPOSITORY = Symbol('EVENT_REPOSITORY');

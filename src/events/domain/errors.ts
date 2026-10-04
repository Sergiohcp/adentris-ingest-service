import { DomainError } from '../../shared/errors';

export class IdempotencyConflictError extends DomainError {
  constructor(readonly idempotencyKey: string) {
    super('Idempotency key already used with a different payload');
  }
}

export class InvalidIdempotencyKeyError extends DomainError {
  constructor(reason: string) {
    super(`Invalid Idempotency-Key: ${reason}`);
  }
}

/** Raised by the repository when the idempotency key already exists (unique index). */
export class DuplicateIdempotencyKeyError extends DomainError {
  constructor(readonly idempotencyKey: string) {
    super('Idempotency key already exists');
  }
}

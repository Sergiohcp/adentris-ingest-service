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

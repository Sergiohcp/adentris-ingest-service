export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The store could not give a safe answer right now; the caller should retry (HTTP 503). */
export class StorageUnavailableError extends DomainError {
  constructor(reason: string) {
    super(`Storage unavailable: ${reason}`);
  }
}

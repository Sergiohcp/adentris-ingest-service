import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { IdempotencyConflictError, InvalidIdempotencyKeyError } from '../domain/errors';
import { isUnavailableError } from '../../shared/mongo-errors';
import { StorageUnavailableError } from '../../shared/errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpErrors');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof IdempotencyConflictError) {
      res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT', idempotencyKey: err.idempotencyKey });
    } else if (err instanceof InvalidIdempotencyKeyError) {
      res.status(400).json({ statusCode: 400, error: 'Bad Request', message: err.message });
    } else if (err instanceof StorageUnavailableError || isUnavailableError(err)) {
      this.logger.error(`Storage unavailable: ${(err as Error).name}`);
      res.setHeader('Retry-After', '5').status(503).json({ error: 'STORAGE_UNAVAILABLE' });
    } else if (err instanceof HttpException) {
      res.status(err.getStatus()).json(err.getResponse());
    } else if (hasClientStatus(err)) {
      // e.g. body-parser: 413 payload too large, 400 malformed JSON
      res.status(err.status).json({ statusCode: err.status, message: (err as unknown as Error).message });
    } else {
      // Never log the error object itself: driver errors can embed document values (PHI).
      this.logger.error(`Unhandled error: ${(err as Error)?.name ?? 'unknown'}`);
      res.status(500).json({ statusCode: 500, message: 'Internal server error' });
    }
  }
}

function hasClientStatus(err: unknown): err is { status: number } {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

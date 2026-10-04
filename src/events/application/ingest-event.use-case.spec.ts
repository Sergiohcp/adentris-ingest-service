import { buildConfig } from '../../config/configuration';
import { StorageUnavailableError } from '../../shared/errors';
import { IngestedEvent, NewEvent } from '../domain/event';
import { DuplicateIdempotencyKeyError, IdempotencyConflictError } from '../domain/errors';
import { EventRepository } from './event.repository';
import { IngestEventUseCase } from './ingest-event.use-case';

class FakeRepo implements EventRepository {
  stored = new Map<string, IngestedEvent>();
  visible = true;

  async insertPending(event: NewEvent): Promise<string> {
    if (this.stored.has(event.idempotencyKey)) throw new DuplicateIdempotencyKeyError(event.idempotencyKey);
    const id = String(this.stored.size + 1).padStart(24, '0');
    this.stored.set(event.idempotencyKey, { ...event, id, status: 'pending', attempts: 0 });
    return id;
  }
  async findByIdempotencyKey(key: string): Promise<IngestedEvent | null> {
    return this.visible ? (this.stored.get(key) ?? null) : null;
  }
  async findById(): Promise<IngestedEvent | null> {
    return null;
  }
}

describe('IngestEventUseCase', () => {
  const clock = { now: () => new Date('2024-01-01T10:00:00Z') };
  const input = { patientId: 'p1', type: 't', data: { a: 1 }, ts: new Date('2024-01-01T09:00:00Z') };
  let repo: FakeRepo;
  let useCase: IngestEventUseCase;

  beforeEach(() => {
    repo = new FakeRepo();
    useCase = new IngestEventUseCase(repo, clock, buildConfig({}));
  });

  it('returns the original eventId for a duplicate', async () => {
    const first = await useCase.execute(input);
    expect(await useCase.execute(input)).toEqual({ eventId: first.eventId, status: 'pending', duplicate: true });
  });

  it('rejects a reused header key with a different payload', async () => {
    await useCase.execute(input, 'k');
    await expect(useCase.execute({ ...input, data: { a: 2 } }, 'k')).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('asks the sender to retry when the original is not yet readable', async () => {
    await useCase.execute(input);
    repo.visible = false;
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});

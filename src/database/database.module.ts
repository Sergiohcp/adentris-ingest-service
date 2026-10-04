import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import { EventDocument } from './documents';
import { ensureIndexes } from './indexes';
import { EVENTS_COLLECTION, MONGO_CLIENT, mongoProviders } from './mongo.provider';
import { sleep } from '../shared/time';

const INDEX_RETRY_MS = 2000;
const INDEX_MAX_TRIES = 30;

@Global()
@Module({
  providers: mongoProviders,
  exports: mongoProviders,
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(EVENTS_COLLECTION) private readonly events: Collection<EventDocument>,
  ) {}

  /** Idempotent. Retries so the app can start while MongoDB is still electing a primary. */
  async onModuleInit(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await ensureIndexes(this.events);
        return;
      } catch (err) {
        if (attempt >= INDEX_MAX_TRIES) throw err;
        this.logger.warn(`MongoDB not ready for index bootstrap (try ${attempt}): ${(err as Error).message}`);
        await sleep(INDEX_RETRY_MS);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}

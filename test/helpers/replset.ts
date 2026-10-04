import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | undefined;

export async function startReplSet(): Promise<string> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replSet.getUri();
}

export async function stopReplSet(): Promise<void> {
  await replSet?.stop();
  replSet = undefined;
}

import { Provider } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import { AppConfig, APP_CONFIG } from '../config/configuration';
import { EventDocument, PatientLaneDocument } from './documents';

export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const EVENTS_COLLECTION = Symbol('EVENTS_COLLECTION');
export const LANES_COLLECTION = Symbol('LANES_COLLECTION');

export const mongoProviders: Provider[] = [
  {
    provide: MONGO_CLIENT,
    inject: [APP_CONFIG],
    useFactory: (config: AppConfig): MongoClient =>
      // connect() is lazy: the client reconnects by itself if MongoDB is briefly down.
      new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 }),
  },
  {
    provide: EVENTS_COLLECTION,
    inject: [MONGO_CLIENT, APP_CONFIG],
    useFactory: (client: MongoClient, config: AppConfig): Collection<EventDocument> =>
      client.db(config.mongoDb).collection<EventDocument>('events'),
  },
  {
    provide: LANES_COLLECTION,
    inject: [MONGO_CLIENT, APP_CONFIG],
    useFactory: (client: MongoClient, config: AppConfig): Collection<PatientLaneDocument> =>
      client.db(config.mongoDb).collection<PatientLaneDocument>('patient_lanes'),
  },
];

import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { configureApp } from '../../src/api-setup';
import { AppConfig, APP_CONFIG } from '../../src/config/configuration';
import { EVENTS_COLLECTION } from '../../src/database/mongo.provider';
import { EventsModule } from '../../src/events/events.module';
import { SharedModule } from '../../src/shared/shared.module';
import { createApiApp } from '../helpers/api-app';
import { startReplSet, stopReplSet } from '../helpers/replset';
import { testConfig } from '../helpers/test-config';

describe('POST /events', () => {
  let app: INestApplication;
  let config: AppConfig;
  let client: MongoClient;

  const event = (overrides: Record<string, unknown> = {}) => ({
    patientId: 'p1',
    type: 'vitals',
    data: { hr: 70 },
    ts: '2024-01-01T09:59:00Z',
    ...overrides,
  });
  const events = () => client.db(config.mongoDb).collection('events');

  beforeAll(async () => {
    const uri = await startReplSet();
    config = testConfig(uri, { reorderWindowMs: 10_000 });
    client = await new MongoClient(uri).connect();
    app = await createApiApp(config);
  });

  afterAll(async () => {
    await app.close();
    await client.close();
    await stopReplSet();
  });

  beforeEach(async () => {
    await events().deleteMany({});
  });

  it('accepts a valid event with 202 and stores it pending with availableAt', async () => {
    const res = await request(app.getHttpServer()).post('/events').send(event()).expect(202);
    expect(res.body).toEqual({ eventId: expect.any(String), status: 'pending', duplicate: false });

    const doc = await events().findOne({});
    expect(doc).toMatchObject({ status: 'pending', attempts: 0, patientId: 'p1' });
    expect(doc!.availableAt.getTime()).toBeGreaterThanOrEqual(doc!.receivedAt.getTime());
    expect(doc!.availableAt.getTime()).toBeLessThanOrEqual(doc!.receivedAt.getTime() + 10_000);
  });

  it.each([
    ['missing patientId', { patientId: undefined }],
    ['empty type', { type: '' }],
    ['non-object data', { data: 'x' }],
    ['array data', { data: [1] }],
    ['bad ts', { ts: 'yesterday' }],
    ['non-ISO ts', { ts: '2024-13-45' }],
    ['extra field', { extra: true }],
  ])('rejects %s with 400', async (_name, overrides) => {
    await request(app.getHttpServer()).post('/events').send(event(overrides)).expect(400);
    expect(await events().countDocuments()).toBe(0);
  });

  it('rejects an empty Idempotency-Key header with 400', async () => {
    await request(app.getHttpServer()).post('/events').set('Idempotency-Key', '   ').send(event()).expect(400);
  });

  it('rejects oversized bodies with 413', async () => {
    const big = event({ data: { blob: 'x'.repeat(config.maxBodyBytes) } });
    await request(app.getHttpServer()).post('/events').send(big).expect(413);
  });

  it('stores one document for 20 concurrent identical POSTs, all sharing the eventId', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(app.getHttpServer()).post('/events').send(event())),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(202));
    expect(new Set(responses.map((r) => r.body.eventId)).size).toBe(1);
    expect(responses.filter((r) => !r.body.duplicate)).toHaveLength(1);
    expect(await events().countDocuments()).toBe(1);
  });

  it('treats equivalent ts spellings and key order as the same event', async () => {
    const a = await request(app.getHttpServer()).post('/events').send(event({ ts: '2024-01-01T09:59:00Z', data: { a: 1, b: 2 } }));
    const b = await request(app.getHttpServer()).post('/events').send(event({ ts: '2024-01-01T09:59:00.000Z', data: { b: 2, a: 1 } }));
    expect(b.body.eventId).toBe(a.body.eventId);
    expect(b.body.duplicate).toBe(true);
  });

  it('returns 409 for the same Idempotency-Key with a different body', async () => {
    await request(app.getHttpServer()).post('/events').set('Idempotency-Key', 'k1').send(event()).expect(202);
    const res = await request(app.getHttpServer())
      .post('/events')
      .set('Idempotency-Key', 'k1')
      .send(event({ data: { hr: 99 } }))
      .expect(409);
    expect(res.body).toEqual({ error: 'IDEMPOTENCY_CONFLICT', idempotencyKey: 'hdr:k1' });
  });

  it('returns the same eventId for the same Idempotency-Key and body', async () => {
    const a = await request(app.getHttpServer()).post('/events').set('Idempotency-Key', 'k2').send(event());
    const b = await request(app.getHttpServer()).post('/events').set('Idempotency-Key', 'k2').send(event());
    expect(b.status).toBe(202);
    expect(b.body).toMatchObject({ eventId: a.body.eventId, duplicate: true });
  });
});

describe('GET /events/:id', () => {
  let app: INestApplication;
  let client: MongoClient;

  beforeAll(async () => {
    const uri = await startReplSet();
    app = await createApiApp(testConfig(uri));
    client = await new MongoClient(uri).connect();
  });
  afterAll(async () => {
    await app.close();
    await client.close();
    await stopReplSet();
  });

  it('returns the event without its data', async () => {
    const post = await request(app.getHttpServer())
      .post('/events')
      .send({ patientId: 'p1', type: 't', data: { secret: 1 }, ts: '2024-01-01T09:59:00Z' });
    const res = await request(app.getHttpServer()).get(`/events/${post.body.eventId}`).expect(200);
    expect(res.body).toMatchObject({ eventId: post.body.eventId, patientId: 'p1', status: 'pending', attempts: 0, outOfOrder: false });
    expect(res.body).not.toHaveProperty('data');
  });

  it('404s on unknown ids and 400s on malformed ones', async () => {
    await request(app.getHttpServer()).get('/events/aaaaaaaaaaaaaaaaaaaaaaaa').expect(404);
    await request(app.getHttpServer()).get('/events/nope').expect(400);
  });
});

describe('storage outage', () => {
  it('maps an unreachable MongoDB to 503 with Retry-After', async () => {
    const config = testConfig('mongodb://127.0.0.1:1/ingest');
    const dead = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 300 });

    @Global()
    @Module({
      providers: [
        { provide: EVENTS_COLLECTION, useValue: dead.db('ingest').collection('events') },
        { provide: APP_CONFIG, useValue: config },
      ],
      exports: [EVENTS_COLLECTION, APP_CONFIG],
    })
    class DeadDatabaseModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [SharedModule, DeadDatabaseModule, EventsModule],
    }).compile();
    const app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app, config.maxBodyBytes);
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/events')
      .send({ patientId: 'p1', type: 't', data: {}, ts: '2024-01-01T09:59:00Z' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'STORAGE_UNAVAILABLE' });
    expect(res.headers['retry-after']).toBe('5');

    await app.close();
    await dead.close();
  }, 30000);
});

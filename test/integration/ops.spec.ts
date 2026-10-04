import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApiApp } from '../helpers/api-app';
import { startReplSet, stopReplSet } from '../helpers/replset';
import { testConfig } from '../helpers/test-config';

describe('ops endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApiApp(testConfig(await startReplSet()));
  });
  afterAll(async () => {
    await app.close();
    await stopReplSet();
  });

  it('GET /health is live and /health/ready pings MongoDB', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
  });

  it('GET /stats reports counts by status', async () => {
    const empty = await request(app.getHttpServer()).get('/stats').expect(200);
    expect(empty.body).toEqual({
      byStatus: { pending: 0, processing: 0, done: 0, failed: 0 },
      oldestPendingAgeMs: null,
      outOfOrder: 0,
      blockedLanes: 0,
    });

    await request(app.getHttpServer())
      .post('/events')
      .send({ patientId: 'p1', type: 't', data: {}, ts: '2024-01-01T09:59:00Z' })
      .expect(202);
    const after = await request(app.getHttpServer()).get('/stats').expect(200);
    expect(after.body.byStatus.pending).toBe(1);
    expect(after.body.oldestPendingAgeMs).toBeGreaterThanOrEqual(0);
  });
});

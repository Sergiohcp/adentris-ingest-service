import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiModule } from '../../src/api.module';
import { configureApp } from '../../src/api-setup';
import { AppConfig, APP_CONFIG } from '../../src/config/configuration';
import { CLOCK } from '../../src/shared/clock';
import { FakeClock } from './fake-clock';

export async function createApiApp(config: AppConfig, clock?: FakeClock): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [ApiModule] }).overrideProvider(APP_CONFIG).useValue(config);
  if (clock) builder.overrideProvider(CLOCK).useValue(clock);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app, config.maxBodyBytes);
  await app.init();
  return app;
}

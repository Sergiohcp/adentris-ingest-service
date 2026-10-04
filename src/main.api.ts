import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from './api.module';
import { configureApp } from './api-setup';
import { AppConfig, APP_CONFIG } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config.maxBodyBytes);
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${config.port}`);
}

bootstrap().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

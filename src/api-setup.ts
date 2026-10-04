import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './events/api/http-exception.filter';

/** Shared by main.api.ts and the integration tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication, maxBodyBytes: number): void {
  (app as NestExpressApplication).useBodyParser('json', { limit: maxBodyBytes });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

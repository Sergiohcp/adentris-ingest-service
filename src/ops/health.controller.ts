import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { MongoClient } from 'mongodb';
import { AppConfig, APP_CONFIG } from '../config/configuration';
import { MONGO_CLIENT } from '../database/mongo.provider';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: the process is up. */
  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: MongoDB answers a ping. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      async () => {
        const session = this.indicator.check('mongodb');
        try {
          await this.client.db(this.config.mongoDb).command({ ping: 1 });
          return session.up();
        } catch {
          return session.down({ message: 'MongoDB ping failed' });
        }
      },
    ]);
  }
}

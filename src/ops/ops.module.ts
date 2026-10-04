import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, StatsController],
  providers: [StatsService],
})
export class OpsModule {}

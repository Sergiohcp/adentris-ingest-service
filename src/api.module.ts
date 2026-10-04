import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { OpsModule } from './ops/ops.module';
import { SharedModule } from './shared/shared.module';

@Module({ imports: [AppConfigModule, SharedModule, DatabaseModule, EventsModule, OpsModule] })
export class ApiModule {}

import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ProcessingModule } from './processing/processing.module';
import { WorkerLifecycle } from './processing/worker/worker.lifecycle';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [AppConfigModule, SharedModule, DatabaseModule, ProcessingModule],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}

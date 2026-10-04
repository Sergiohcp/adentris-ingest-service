import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { WorkerRunner } from './worker.runner';

/** Ties the runner to the worker process lifecycle (tests drive the runner directly). */
@Injectable()
export class WorkerLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(private readonly runner: WorkerRunner) {}

  onApplicationBootstrap(): void {
    this.runner.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.runner.stop();
  }
}

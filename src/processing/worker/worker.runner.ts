import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, APP_CONFIG } from '../../config/configuration';
import { Clock, CLOCK } from '../../shared/clock';
import { sleep } from '../../shared/time';
import { LaneRepository, LANE_REPOSITORY } from '../application/lane.repository';
import { ProcessLaneUseCase } from '../application/process-lane.use-case';
import { ProcessingEventRepository, PROCESSING_EVENT_REPOSITORY } from '../application/processing-event.repository';

@Injectable()
export class WorkerRunner {
  private readonly logger = new Logger(WorkerRunner.name);
  readonly workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly activePatients = new Set<string>();
  private stopping = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(PROCESSING_EVENT_REPOSITORY) private readonly events: ProcessingEventRepository,
    @Inject(LANE_REPOSITORY) private readonly lanes: LaneRepository,
    private readonly processLane: ProcessLaneUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts the polling loop in the background. */
  start(): void {
    this.loop ??= this.run();
  }

  /** Stop acquiring lanes, then let in-flight drains finish (up to SHUTDOWN_GRACE_MS). */
  async stop(): Promise<void> {
    this.stopping = true;
    const graceTimer = new AbortController();
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      sleep(this.config.shutdownGraceMs, graceTimer.signal).catch(() => undefined),
    ]);
    graceTimer.abort();
    await this.loop;
  }

  async run(): Promise<void> {
    this.logger.log(`Worker ${this.workerId} started (concurrency=${this.config.workerConcurrency})`);
    while (!this.stopping) {
      let pollAgain = false;
      try {
        pollAgain = await this.fillFreeSlots();
      } catch (err) {
        this.logger.error(`Poll failed: ${(err as Error).name}`);
      }
      if (!pollAgain && !this.stopping) await sleep(this.config.pollIntervalMs);
    }
    this.logger.log(`Worker ${this.workerId} stopped acquiring lanes`);
  }

  /** Returns true when an immediate re-poll is worthwhile (slots were filled and more work may be waiting). */
  private async fillFreeSlots(): Promise<boolean> {
    const freeSlots = this.config.workerConcurrency - this.inFlight.size;
    if (freeSlots <= 0) return false;

    let started = 0;
    const patientIds = await this.events.findPatientsWithEligibleWork(this.clock.now(), freeSlots);
    for (const patientId of patientIds) {
      if (this.stopping || this.inFlight.size >= this.config.workerConcurrency) break;
      if (this.activePatients.has(patientId)) continue;
      const lease = await this.lanes.tryAcquire(patientId, this.workerId, this.clock.now());
      if (!lease) continue; // another worker owns it
      this.track(patientId, this.processLane.execute(lease)); // not awaited: lanes run concurrently
      started++;
    }
    return started > 0 && patientIds.length >= freeSlots;
  }

  private track(patientId: string, work: Promise<void>): void {
    this.activePatients.add(patientId);
    const tracked: Promise<void> = work
      .catch((err: Error) => this.logger.error(`Lane failed patient=${patientId}: ${err.name}`))
      .finally(() => {
        this.inFlight.delete(tracked);
        this.activePatients.delete(patientId);
      });
    this.inFlight.add(tracked);
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, APP_CONFIG } from '../../config/configuration';
import { IngestedEvent } from '../../events/domain/event';
import { Clock, CLOCK } from '../../shared/clock';
import { LaneLease } from '../domain/lane';
import { LeaseLostError } from '../domain/errors';
import { EventCompletion, EVENT_COMPLETION } from './completion.service';
import { EventProcessor, EVENT_PROCESSOR, ProcessingResult } from './event-processor';
import { LaneRepository, LANE_REPOSITORY } from './lane.repository';
import { ProcessingEventRepository, PROCESSING_EVENT_REPOSITORY } from './processing-event.repository';

type Outcome = { ok: true; result: ProcessingResult } | { ok: false; error: Error };

@Injectable()
export class ProcessLaneUseCase {
  private readonly logger = new Logger(ProcessLaneUseCase.name);

  constructor(
    @Inject(PROCESSING_EVENT_REPOSITORY) private readonly events: ProcessingEventRepository,
    @Inject(LANE_REPOSITORY) private readonly lanes: LaneRepository,
    @Inject(EVENT_PROCESSOR) private readonly processor: EventProcessor,
    @Inject(EVENT_COMPLETION) private readonly completion: EventCompletion,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Drains up to LANE_BATCH events of one patient, strictly one at a time and in order. */
  async execute(lease: LaneLease): Promise<void> {
    try {
      for (let i = 0; i < this.config.laneBatch; i++) {
        const now = this.clock.now();
        const head = await this.events.findLaneHead(lease.patientId);
        if (!head) break; // lane empty
        if (head.status === 'failed') {
          this.logger.warn(`Lane blocked patient=${head.patientId} event=${head.id} attempts=${head.attempts}`);
          break;
        }
        if (head.availableAt > now) break; // backoff / watermark: never skip the head

        // Fence the claim: if the lease was lost we must not touch the event.
        if (!(await this.lanes.renew(lease, now))) throw new LeaseLostError(lease.patientId);

        const claimed = await this.events.markProcessing(head.id, lease.token, now);
        if (!claimed) break;

        const outcome = await this.runWithTimeout(claimed);
        if (outcome.ok) {
          await this.completion.complete(claimed, lease.token, outcome.result);
          this.logger.log(`Done patient=${claimed.patientId} event=${claimed.id} type=${claimed.type}`);
        } else {
          await this.events.recordFailure(claimed, lease.token, outcome.error, this.clock.now());
          this.logger.warn(
            `Failed patient=${claimed.patientId} event=${claimed.id} attempts=${claimed.attempts}: ${outcome.error.message}`,
          );
          break; // head not done: stop draining this lane
        }
      }
    } catch (err) {
      if (err instanceof LeaseLostError) {
        this.logger.warn(`Lease lost patient=${lease.patientId}; discarding work`);
        return;
      }
      throw err;
    } finally {
      await this.lanes.release(lease).catch(() => undefined); // best effort; lease expiry is the fallback
    }
  }

  private async runWithTimeout(event: IngestedEvent): Promise<Outcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Processing timed out')), this.config.processTimeoutMs);
    try {
      return { ok: true, result: await this.processor.process(event, controller.signal) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      clearTimeout(timer);
    }
  }
}

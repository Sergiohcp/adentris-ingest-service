import { Inject, Injectable } from '@nestjs/common';
import { IngestedEvent } from '../domain/event';
import { EventRepository, EVENT_REPOSITORY } from './event.repository';

@Injectable()
export class GetEventUseCase {
  constructor(@Inject(EVENT_REPOSITORY) private readonly events: EventRepository) {}

  execute(id: string): Promise<IngestedEvent | null> {
    return this.events.findById(id);
  }
}

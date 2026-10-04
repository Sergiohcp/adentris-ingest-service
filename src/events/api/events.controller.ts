import { Body, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, BadRequestException } from '@nestjs/common';
import { GetEventUseCase } from '../application/get-event.use-case';
import { IngestEventUseCase } from '../application/ingest-event.use-case';
import { CreateEventDto } from './create-event.dto';
import { toEventResponse } from './event-response.mapper';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

@Controller('events')
export class EventsController {
  constructor(
    private readonly ingestEvent: IngestEventUseCase,
    private readonly getEvent: GetEventUseCase,
  ) {}

  @Post()
  @HttpCode(202)
  create(@Body() dto: CreateEventDto, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.ingestEvent.execute(
      { patientId: dto.patientId, type: dto.type, data: dto.data, ts: new Date(dto.ts) },
      idempotencyKey,
    );
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    if (!OBJECT_ID_PATTERN.test(id)) throw new BadRequestException('id must be a valid ObjectId');
    const event = await this.getEvent.execute(id);
    if (!event) throw new NotFoundException('Event not found');
    return toEventResponse(event);
  }
}

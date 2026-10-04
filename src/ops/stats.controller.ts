import { Controller, Get } from '@nestjs/common';
import { Stats, StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(): Promise<Stats> {
    return this.stats.get();
  }
}

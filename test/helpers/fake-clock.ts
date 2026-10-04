import { Clock } from '../../src/shared/clock';

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2024-01-01T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = date;
  }
}

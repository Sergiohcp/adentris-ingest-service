export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

import { createHash } from 'node:crypto';
import { InvalidIdempotencyKeyError } from './errors';

const MAX_HEADER_KEY_LENGTH = 200;

/** Deterministic JSON: object keys sorted recursively, arrays keep their order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export function hashPayload(input: { patientId: string; type: string; ts: Date; data: unknown }): string {
  const canonical = canonicalize({
    patientId: input.patientId,
    type: input.type,
    ts: input.ts.toISOString(),
    data: input.data,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** The prefix stops a client-chosen key from colliding with a derived one. */
export function resolveIdempotencyKey(headerKey: string | undefined, payloadHash: string): string {
  if (headerKey === undefined) return `body:${payloadHash}`;
  const trimmed = headerKey.trim();
  if (trimmed.length === 0) throw new InvalidIdempotencyKeyError('must not be empty');
  if (trimmed.length > MAX_HEADER_KEY_LENGTH) {
    throw new InvalidIdempotencyKeyError(`must be at most ${MAX_HEADER_KEY_LENGTH} characters`);
  }
  return `hdr:${trimmed}`;
}

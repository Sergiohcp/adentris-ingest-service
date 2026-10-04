import { canonicalize, hashPayload, resolveIdempotencyKey } from './idempotency-key';

describe('canonicalize', () => {
  it('sorts keys recursively', () => {
    expect(canonicalize({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalize({ a: { c: 2, d: 1 }, b: 1 }));
  });
  it('keeps array order', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
  it('distinguishes types', () => {
    expect(canonicalize({ a: '1' })).not.toBe(canonicalize({ a: 1 }));
  });
});

describe('hashPayload', () => {
  const base = { patientId: 'p1', type: 'vitals', data: { hr: 70 } };
  it('treats equivalent ISO strings as equal', () => {
    const a = hashPayload({ ...base, ts: new Date('2024-01-01T10:00:00Z') });
    const b = hashPayload({ ...base, ts: new Date('2024-01-01T10:00:00.000Z') });
    expect(a).toBe(b);
  });
  it('is independent of data key order', () => {
    const ts = new Date('2024-01-01T10:00:00Z');
    expect(hashPayload({ ...base, ts, data: { a: 1, b: 2 } })).toBe(hashPayload({ ...base, ts, data: { b: 2, a: 1 } }));
  });
  it('changes when data changes', () => {
    const ts = new Date('2024-01-01T10:00:00Z');
    expect(hashPayload({ ...base, ts })).not.toBe(hashPayload({ ...base, ts, data: { hr: 71 } }));
  });
});

describe('resolveIdempotencyKey', () => {
  it('prefers the header, prefixed', () => {
    expect(resolveIdempotencyKey(' abc ', 'h')).toBe('hdr:abc');
  });
  it('derives from the hash otherwise', () => {
    expect(resolveIdempotencyKey(undefined, 'h')).toBe('body:h');
  });
  it('rejects empty and oversized headers', () => {
    expect(() => resolveIdempotencyKey('  ', 'h')).toThrow();
    expect(() => resolveIdempotencyKey('x'.repeat(201), 'h')).toThrow();
  });
});

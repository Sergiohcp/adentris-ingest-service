import { buildConfig } from './configuration';

describe('buildConfig', () => {
  it('applies defaults', () => {
    const c = buildConfig({});
    expect(c.port).toBe(3000);
    expect(c.leaseMs).toBeGreaterThan(c.processTimeoutMs);
  });

  it('fails fast with every problem listed', () => {
    expect(() => buildConfig({ PORT: 'abc', SIMULATED_FAILURE_RATE: '2' })).toThrow(/PORT[\s\S]*SIMULATED_FAILURE_RATE/);
  });

  it('requires lease > process timeout', () => {
    expect(() => buildConfig({ LEASE_MS: '1000', PROCESS_TIMEOUT_MS: '1000' })).toThrow(/LEASE_MS/);
  });
});

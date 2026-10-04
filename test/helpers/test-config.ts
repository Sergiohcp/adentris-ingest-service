import { randomUUID } from 'node:crypto';
import { AppConfig, buildConfig } from '../../src/config/configuration';

export function testConfig(mongoUri: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...buildConfig({}),
    mongoUri,
    mongoDb: `test_${randomUUID().replace(/-/g, '')}`,
    processingDelayMs: 0,
    reorderWindowMs: 0,
    pollIntervalMs: 20,
    ...overrides,
  };
}

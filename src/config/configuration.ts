export interface AppConfig {
  port: number;
  mongoUri: string;
  mongoDb: string;
  processingDelayMs: number;
  simulatedFailureRate: number;
  processTimeoutMs: number;
  leaseMs: number;
  workerConcurrency: number;
  pollIntervalMs: number;
  laneBatch: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  reorderWindowMs: number;
  shutdownGraceMs: number;
  maxBodyBytes: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

type Env = Record<string, string | undefined>;

export function buildConfig(env: Env): AppConfig {
  const errors: string[] = [];

  const int = (name: string, def: number, min: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      errors.push(`${name} must be an integer >= ${min} (got "${raw}")`);
      return def;
    }
    return value;
  };

  const rate = (name: string, def: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return def;
    const value = Number(raw);
    if (Number.isNaN(value) || value < 0 || value > 1) {
      errors.push(`${name} must be a number between 0 and 1 (got "${raw}")`);
      return def;
    }
    return value;
  };

  const str = (name: string, def: string): string => (env[name] ? (env[name] as string) : def);

  const config: AppConfig = {
    port: int('PORT', 3000, 1),
    mongoUri: str('MONGO_URI', 'mongodb://localhost:27017/ingest?replicaSet=rs0&directConnection=true'),
    mongoDb: str('MONGO_DB', 'ingest'),
    processingDelayMs: int('PROCESSING_DELAY_MS', 5000, 0),
    simulatedFailureRate: rate('SIMULATED_FAILURE_RATE', 0),
    processTimeoutMs: int('PROCESS_TIMEOUT_MS', 15000, 1),
    leaseMs: int('LEASE_MS', 30000, 1),
    workerConcurrency: int('WORKER_CONCURRENCY', 200, 1),
    pollIntervalMs: int('POLL_INTERVAL_MS', 500, 1),
    laneBatch: int('LANE_BATCH', 10, 1),
    maxAttempts: int('MAX_ATTEMPTS', 5, 1),
    backoffBaseMs: int('BACKOFF_BASE_MS', 1000, 1),
    backoffMaxMs: int('BACKOFF_MAX_MS', 60000, 1),
    reorderWindowMs: int('REORDER_WINDOW_MS', 10000, 0),
    shutdownGraceMs: int('SHUTDOWN_GRACE_MS', 25000, 0),
    maxBodyBytes: int('MAX_BODY_BYTES', 262144, 1),
  };

  if (config.leaseMs <= config.processTimeoutMs) {
    errors.push(`LEASE_MS (${config.leaseMs}) must be greater than PROCESS_TIMEOUT_MS (${config.processTimeoutMs})`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n - ${errors.join('\n - ')}`);
  }
  return config;
}

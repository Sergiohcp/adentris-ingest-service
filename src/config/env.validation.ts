import { buildConfig } from './configuration';

/** Used by ConfigModule: fails fast on boot with a readable message. */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  buildConfig(env as Record<string, string | undefined>);
  return env;
}

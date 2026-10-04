/** Tiny `--flag value` parser shared by the proof scripts. */
export function parseArgs<T extends Record<string, string | number>>(defaults: T): T {
  const out: Record<string, string | number> = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!(name in defaults)) throw new Error(`Unknown flag ${arg}`);
    const raw = argv[++i];
    out[name] = typeof defaults[name] === 'number' ? Number(raw) : raw;
  }
  return out as T;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

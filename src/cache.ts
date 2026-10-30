import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderResult } from './providers/types';

// The cache stores the RAW provider results, keyed by everything that could change them. Scoring,
// capping, aggregation and the composite are recomputed from those raw results every time, so:
//   - the same page, rubric, prompt and model always give the same grades (the second call never reaches the model);
//   - changing the weights costs nothing (no new model calls).
// It guarantees repeatability of OUR results. It does not make the model itself deterministic.

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface RawRuns {
  results: ProviderResult[];
}

export interface Cache {
  get(key: string): RawRuns | undefined;
  set(key: string, value: RawRuns): void;
}

export function fileCache(dir: string): Cache {
  return {
    get(key) {
      const f = join(dir, `${key}.json`);
      if (!existsSync(f)) return undefined;
      try {
        return JSON.parse(readFileSync(f, 'utf8')) as RawRuns;
      } catch {
        return undefined; // a corrupt cache file is treated as a miss
      }
    },
    set(key, value) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(value));
    },
  };
}

export function memoryCache(): Cache & { size: number } {
  const m = new Map<string, RawRuns>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), get size() { return m.size; } };
}

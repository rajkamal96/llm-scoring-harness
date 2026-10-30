import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const Cap = z.object({
  fact: z.enum(['titleChars', 'wordCount', 'bulletCount', 'numberWithUnitCount', 'superlativeCount']),
  lt: z.number().optional(),
  gt: z.number().optional(),
  max: z.number().int().min(0).max(4),
}).refine((c) => (c.lt === undefined) !== (c.gt === undefined), 'a cap needs exactly one of lt / gt');

const Category = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  criteria: z.string(),
  levels: z.object({ '0': z.string(), '1': z.string(), '2': z.string(), '3': z.string(), '4': z.string() }),
  caps: z.array(Cap).default([]),
});

const Rule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('major-fix-vs-high-score'), minScore: z.number().int().min(1).max(4) }),
  z.object({ type: z.literal('low-score-without-fix'), maxScore: z.number().int().min(0).max(3) }),
  z.object({
    type: z.literal('implication'),
    if: z.object({ category: z.string(), atLeast: z.number().int().min(0).max(4) }),
    then: z.object({ category: z.string(), atLeast: z.number().int().min(0).max(4) }),
    message: z.string(),
  }),
]);

export const RubricSchema = z.object({
  version: z.string(),
  name: z.string(),
  unsupportedScoreCap: z.number().int().min(0).max(4),
  categories: z.array(Category).min(1),
  consistencyRules: z.array(Rule).default([]),
});

export const WeightsSchema = z.object({
  note: z.string().optional(),
  weights: z.record(z.string(), z.number().min(0)),
  grades: z.array(z.object({ min: z.number(), grade: z.string() })).min(1),
});

export const SettingsSchema = z.object({
  runs: z.number().int().min(1).max(25),
  maxSpread: z.number().int().min(0).max(4),
  pricing: z.object({ note: z.string().optional(), inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0) }),
});

export type Rubric = z.infer<typeof RubricSchema>;
export type Weights = z.infer<typeof WeightsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export interface Config {
  rubric: Rubric;
  weights: Weights;
  settings: Settings;
}

/** Cross-file checks: weights must name real categories, and every category needs a weight. */
export function validateConfig(c: Config): string[] {
  const problems: string[] = [];
  const ids = new Set(c.rubric.categories.map((x) => x.id));
  if (ids.size !== c.rubric.categories.length) problems.push('Duplicate category ids in rubric.json.');
  for (const id of Object.keys(c.weights.weights)) if (!ids.has(id)) problems.push(`weights.json has a weight for unknown category "${id}".`);
  for (const id of ids) if (!(id in c.weights.weights)) problems.push(`weights.json has no weight for category "${id}".`);
  if (!Object.values(c.weights.weights).some((w) => w > 0)) problems.push('All weights are zero.');
  const sorted = [...c.weights.grades].sort((a, b) => b.min - a.min);
  if (sorted[sorted.length - 1].min > 0) problems.push('The lowest grade band must start at 0.');
  for (const r of c.rubric.consistencyRules) {
    if (r.type === 'implication') for (const id of [r.if.category, r.then.category]) if (!ids.has(id)) problems.push(`A consistency rule names unknown category "${id}".`);
  }
  return problems;
}

export function loadConfig(dir = join(process.cwd(), 'config')): Config {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
  const config: Config = {
    rubric: RubricSchema.parse(read('rubric.json')),
    weights: WeightsSchema.parse(read('weights.json')),
    settings: SettingsSchema.parse(read('settings.json')),
  };
  const problems = validateConfig(config);
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  return config;
}

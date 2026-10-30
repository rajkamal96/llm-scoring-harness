import type { Config } from './config';
import { sha, type Cache } from './cache';
import { computeFacts, normaliseText, type Facts, type Page } from './facts';
import { PROMPT_VERSION, systemPrompt, userPrompt } from './prompt';
import type { Provider, ProviderResult } from './providers/types';
import { RunOutputSchema, runJsonSchema } from './schema';
import { agreement, appliedCaps, capScore, checkConsistency, composite, median, spread, type Cap, type Composite, type Flag } from './scoring';

export interface RunCategory { id: string; score: number; rawScore: number; evidence: string; evidenceOk: boolean; rationale: string; caps: Cap[]; /** True when a cap actually lowered the score. */ capped: boolean }
export interface RunFix { category: string; severity: 'minor' | 'major'; fix: string }
export interface RunResult { categories: RunCategory[]; fixes: RunFix[]; composite: Composite }

export interface CategoryResult {
  id: string;
  name: string;
  /** Final score: median over runs of (evidence-checked, capped) scores. */
  score: number;
  /** The same category's score in each valid run, after capping. */
  runScores: number[];
  spread: number;
  agreement: number;
  unstable: boolean;
  caps: Cap[];
  capped: boolean;
  evidence: string;
  evidenceOk: boolean;
  rationale: string;
}

export interface ScoreResult {
  page: { name: string; title: string };
  provider: string;
  facts: Facts;
  categories: CategoryResult[];
  composite: Composite;
  /** Composite of each valid run, so noise in the headline number is visible. */
  runComposites: number[];
  compositeRange: [number, number];
  fixes: RunFix[];
  flags: Flag[];
  runsRequested: number;
  runsValid: number;
  fromCache: boolean;
  usage: { inputTokens: number; outputTokens: number; calls: number };
  costUsd: number;
}

/** Lowercase, drop markdown punctuation and collapse whitespace, so a quote only has to match in words. */
const squash = (s: string) => s.toLowerCase().replace(/[*_`#>\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();

export function evidenceIsReal(evidence: string, pageText: string): boolean {
  const e = squash(evidence);
  return e.length >= 8 && squash(pageText).includes(e);
}

/** Turns one raw model result into a checked run, or returns the reason it is unusable. */
export function processRun(raw: unknown, page: Page, facts: Facts, config: Config): { run: RunResult } | { error: string } {
  const parsed = RunOutputSchema.safeParse(raw);
  if (!parsed.success) return { error: 'output did not match the schema' };
  const ids = config.rubric.categories.map((c) => c.id);
  const got = parsed.data.categories.map((c) => c.id);
  if (got.length !== ids.length || ids.some((id) => got.filter((g) => g === id).length !== 1)) {
    return { error: `expected exactly one entry for each of: ${ids.join(', ')}` };
  }
  const categories: RunCategory[] = parsed.data.categories.map((c) => {
    const evidenceOk = evidenceIsReal(c.evidence, page.text);
    // Scores the page does not support are not trusted: a high score with no real quote is capped.
    const supported = c.score <= config.rubric.unsupportedScoreCap || evidenceOk ? c.score : config.rubric.unsupportedScoreCap;
    const caps = appliedCaps(config.rubric, c.id, facts);
    const score = capScore(supported, caps);
    return { id: c.id, rawScore: c.score, score, evidence: c.evidence, evidenceOk, rationale: c.rationale, caps, capped: score < supported };
  });
  const scores = Object.fromEntries(categories.map((c) => [c.id, c.score]));
  const fixes = parsed.data.fixes.filter((f) => ids.includes(f.category));
  return { run: { categories, fixes, composite: composite(scores, config.rubric, config.weights) } };
}

/** Combines valid runs into one result: per-category median, spread, agreement, flags and the composite. */
export function aggregate(runs: RunResult[], page: Page, facts: Facts, config: Config): Omit<ScoreResult, 'provider' | 'runsRequested' | 'fromCache' | 'usage' | 'costUsd' | 'page'> {
  if (!runs.length) throw new Error('No valid runs to aggregate.');
  const flags: Flag[] = [];
  const categories: CategoryResult[] = config.rubric.categories.map((cat) => {
    const per = runs.map((r) => r.categories.find((c) => c.id === cat.id)!);
    const runScores = per.map((c) => c.score);
    const score = median(runScores);
    const sp = spread(runScores);
    const rep = per.find((c) => c.score === score)!;
    const unstable = sp > config.settings.maxSpread;
    if (unstable) flags.push({ kind: 'unstable', category: cat.id, message: `${cat.name}: runs disagree (scores ${[...runScores].sort().join(', ')}).` });
    if (rep.capped) {
      const tight = rep.caps.reduce((a, b) => (b.max < a.max ? b : a));
      flags.push({ kind: 'capped', category: cat.id, message: `${cat.name}: the model gave ${rep.rawScore}, capped at ${tight.max} by a counted fact (${tight.fact} = ${tight.value}).` });
    }
    if (!rep.evidenceOk && rep.rawScore > config.rubric.unsupportedScoreCap) {
      flags.push({ kind: 'unsupported-evidence', category: cat.id, message: `${cat.name}: the quoted evidence was not found on the page, so the score is limited to ${config.rubric.unsupportedScoreCap}.` });
    }
    return { id: cat.id, name: cat.name, score, runScores, spread: sp, agreement: agreement(runScores, score), unstable, caps: rep.caps, capped: rep.capped, evidence: rep.evidence, evidenceOk: rep.evidenceOk, rationale: rep.rationale };
  });
  const scores = Object.fromEntries(categories.map((c) => [c.id, c.score]));

  // The representative run (closest to the aggregated scores) supplies the fixes, so they match the final scores.
  const dist = (r: RunResult) => r.categories.reduce((s, c) => s + Math.abs(c.score - scores[c.id]), 0);
  const rep = runs.reduce((best, r) => (dist(r) < dist(best) ? r : best), runs[0]);
  flags.push(...checkConsistency(config.rubric, categories.map((c) => ({ id: c.id, score: c.score, fixes: rep.fixes.filter((f) => f.category === c.id) }))));

  const runComposites = runs.map((r) => r.composite.score);
  return {
    facts,
    categories,
    composite: composite(scores, config.rubric, config.weights),
    runComposites,
    compositeRange: [Math.min(...runComposites), Math.max(...runComposites)],
    fixes: rep.fixes,
    flags,
    runsValid: runs.length,
  };
}

export interface ScoreOptions {
  runs?: number;
  cache?: Cache;
}

export function cacheKey(page: Page, provider: Provider, config: Config, runs: number): string {
  return sha(JSON.stringify([provider.id, PROMPT_VERSION, config.rubric, page.title, normaliseText(page.text), runs]));
}

/** Calls the provider `runs` times (or reads the cached raw results), then scores in code. */
export async function scorePage(page: Page, provider: Provider, config: Config, opts: ScoreOptions = {}): Promise<ScoreResult> {
  const runsRequested = opts.runs ?? config.settings.runs;
  const facts = computeFacts(page);
  const key = cacheKey(page, provider, config, runsRequested);
  let raws = opts.cache?.get(key)?.results;
  const fromCache = Boolean(raws);

  if (!raws) {
    raws = await collectRuns(page, facts, provider, config, runsRequested);
    opts.cache?.set(key, { results: raws });
  }

  const valid: RunResult[] = [];
  const problems: string[] = [];
  raws.forEach((r, i) => {
    const out = processRun(r.raw, page, facts, config);
    if ('run' in out) valid.push(out.run);
    else problems.push(`run ${i + 1}: ${out.error}`);
  });
  if (!valid.length) throw new Error(`No valid model output. ${problems.join('; ')}`);

  const agg = aggregate(valid, page, facts, config);
  for (const p of problems) agg.flags.push({ kind: 'invalid-run', message: `A run was discarded (${p}).` });
  const usage = raws.reduce((u, r) => ({ inputTokens: u.inputTokens + (r.usage?.inputTokens ?? 0), outputTokens: u.outputTokens + (r.usage?.outputTokens ?? 0), calls: u.calls + 1 }), { inputTokens: 0, outputTokens: 0, calls: 0 });
  const p = config.settings.pricing;
  const costUsd = (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return { page: { name: page.name, title: page.title }, provider: provider.id, runsRequested, fromCache, usage, costUsd, ...agg };
}

/** One result per requested run. A run whose output is unusable is retried once with the same input. */
async function collectRuns(page: Page, facts: Facts, provider: Provider, config: Config, n: number): Promise<ProviderResult[]> {
  const system = systemPrompt(config.rubric);
  const user = userPrompt(page, facts);
  const schema = runJsonSchema(config.rubric);
  const out: ProviderResult[] = [];
  for (let i = 0; i < n; i++) {
    let res = await provider.run({ system, user, schema, runIndex: i });
    if ('error' in processRun(res.raw, page, facts, config)) res = await provider.run({ system, user, schema, runIndex: i });
    out.push(res);
  }
  return out;
}

/** The raw runs for a consistency study: no cache, no aggregation. */
export async function rawRuns(page: Page, provider: Provider, config: Config, n: number): Promise<RunResult[]> {
  const facts = computeFacts(page);
  const raws = await collectRuns(page, facts, provider, config, n);
  return raws.flatMap((r) => {
    const out = processRun(r.raw, page, facts, config);
    return 'run' in out ? [out.run] : [];
  });
}

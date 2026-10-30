import type { Facts } from './facts';
import type { Config, Rubric, Weights } from './config';

// Everything in this file is plain arithmetic: the same inputs always give the same outputs.

export const MIN_SCORE = 0;
export const MAX_SCORE = 4;

export interface Cap { fact: string; value: number; max: number }

/** Caps that apply to a category given the page's counted facts. */
export function appliedCaps(rubric: Rubric, categoryId: string, facts: Facts): Cap[] {
  const cat = rubric.categories.find((c) => c.id === categoryId);
  if (!cat) return [];
  return cat.caps.flatMap((c) => {
    const value = facts[c.fact];
    const hit = c.lt !== undefined ? value < c.lt : value > (c.gt as number);
    return hit ? [{ fact: c.fact, value, max: c.max }] : [];
  });
}

export const capScore = (score: number, caps: Cap[]) => Math.min(score, ...caps.map((c) => c.max));

/** Lower median: for an even count it picks the lower middle value, so the result is always one of the observed scores. */
export function median(values: number[]): number {
  if (!values.length) throw new Error('median of nothing');
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

export const spread = (values: number[]) => (values.length ? Math.max(...values) - Math.min(...values) : 0);

/** Share of runs that equal the aggregated value. */
export const agreement = (values: number[], agg: number) => (values.length ? values.filter((v) => v === agg).length / values.length : 1);

export interface Composite {
  /** 0..100, one decimal. */
  score: number;
  grade: string;
  /** The normalised weight each category contributed (sums to 1). */
  shares: Record<string, number>;
}

export function composite(scores: Record<string, number>, rubric: Rubric, weights: Weights): Composite {
  const ids = rubric.categories.map((c) => c.id);
  const total = ids.reduce((s, id) => s + (weights.weights[id] ?? 0), 0);
  if (total <= 0) throw new Error('Weights sum to zero.');
  let acc = 0;
  const shares: Record<string, number> = {};
  for (const id of ids) {
    const sc = scores[id];
    if (sc === undefined || sc < MIN_SCORE || sc > MAX_SCORE) throw new Error(`Missing or out-of-range score for "${id}".`);
    const share = (weights.weights[id] ?? 0) / total;
    shares[id] = share;
    acc += share * (sc / MAX_SCORE);
  }
  const score = Math.round(acc * 1000) / 10;
  const grade = [...weights.grades].sort((a, b) => b.min - a.min).find((g) => score >= g.min)?.grade ?? weights.grades[weights.grades.length - 1].grade;
  return { score, grade, shares };
}

export interface Flag { kind: 'unstable' | 'capped' | 'contradiction' | 'unsupported-evidence' | 'invalid-run'; category?: string; message: string }

export interface CategoryForRules {
  id: string;
  score: number;
  /** Fixes the model recommended for this category, with severity. */
  fixes: { severity: 'minor' | 'major' }[];
}

/** Cross-section consistency: contradictions between scores and recommended fixes, or between categories. */
export function checkConsistency(rubric: Rubric, cats: CategoryForRules[]): Flag[] {
  const flags: Flag[] = [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const name = (id: string) => rubric.categories.find((c) => c.id === id)?.name ?? id;
  for (const rule of rubric.consistencyRules) {
    if (rule.type === 'major-fix-vs-high-score') {
      for (const c of cats) {
        if (c.score >= rule.minScore && c.fixes.some((f) => f.severity === 'major')) {
          flags.push({ kind: 'contradiction', category: c.id, message: `${name(c.id)} scores ${c.score} but a major fix is recommended for it.` });
        }
      }
    } else if (rule.type === 'low-score-without-fix') {
      for (const c of cats) {
        if (c.score <= rule.maxScore && c.fixes.length === 0) {
          flags.push({ kind: 'contradiction', category: c.id, message: `${name(c.id)} scores ${c.score} but no fix is recommended for it.` });
        }
      }
    } else {
      const a = byId.get(rule.if.category), b = byId.get(rule.then.category);
      if (a && b && a.score >= rule.if.atLeast && b.score < rule.then.atLeast) {
        flags.push({ kind: 'contradiction', category: rule.then.category, message: `${rule.message} (${name(a.id)} ${a.score}, ${name(b.id)} ${b.score}).` });
      }
    }
  }
  return flags;
}

export type { Config };

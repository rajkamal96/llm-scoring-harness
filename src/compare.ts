import type { ScoreResult } from './score';

export interface CategoryDelta {
  id: string;
  name: string;
  before: number;
  after: number;
  delta: number;
  /** True only when the change is larger than the run-to-run spread seen in either page. */
  beyondNoise: boolean;
}

export interface Comparison {
  composite: { before: number; after: number; delta: number; beforeGrade: string; afterGrade: string };
  /** 'improved' / 'worse' only when the two pages' run ranges do not overlap; otherwise 'within-noise' or 'no-change'. */
  verdict: 'improved' | 'worse' | 'within-noise' | 'no-change';
  categories: CategoryDelta[];
  note: string;
}

export function compareResults(before: ScoreResult, after: ScoreResult): Comparison {
  const delta = Math.round((after.composite.score - before.composite.score) * 10) / 10;
  const [bLo, bHi] = before.compositeRange;
  const [aLo, aHi] = after.compositeRange;
  const verdict: Comparison['verdict'] = aLo > bHi ? 'improved' : aHi < bLo ? 'worse' : delta === 0 ? 'no-change' : 'within-noise';
  const categories: CategoryDelta[] = before.categories.map((b) => {
    const a = after.categories.find((c) => c.id === b.id)!;
    const d = a.score - b.score;
    return { id: b.id, name: b.name, before: b.score, after: a.score, delta: d, beyondNoise: Math.abs(d) > Math.max(a.spread, b.spread) };
  });
  const runs = Math.min(before.runsValid, after.runsValid);
  const note =
    verdict === 'within-noise'
      ? `The composite changed by ${delta}, but the runs for the two pages overlap (${bLo}–${bHi} vs ${aLo}–${aHi}), so the change cannot be told apart from run-to-run noise with ${runs} run(s).`
      : verdict === 'no-change'
        ? 'The composite is identical.'
        : `The run ranges do not overlap (${bLo}–${bHi} vs ${aLo}–${aHi}), so the ${verdict === 'improved' ? 'improvement' : 'drop'} is larger than the run-to-run noise observed. With only ${runs} run(s) per page this is evidence, not proof.`;
  return {
    composite: { before: before.composite.score, after: after.composite.score, delta, beforeGrade: before.composite.grade, afterGrade: after.composite.grade },
    verdict,
    categories,
    note,
  };
}

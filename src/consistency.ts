import { agreement, median, spread } from './scoring';
import { aggregate, type RunResult } from './score';
import { computeFacts, type Page } from './facts';
import type { Config } from './config';

export interface ConsistencyReport {
  n: number;
  groupSize: number;
  groups: number;
  /** Per category: how stable is one raw run, versus the median of `groupSize` runs? */
  categories: { id: string; name: string; singleAgreement: number; singleSpread: number; methodAgreement: number; methodSpread: number }[];
  composite: { singleRange: [number, number]; methodRange: [number, number]; singleGradeAgreement: number; methodGradeAgreement: number };
}

const modeShare = (xs: (number | string)[]) => {
  const c = new Map<number | string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return Math.max(...c.values()) / xs.length;
};

/**
 * From N independent runs of the same page: how much do single runs disagree with each other, and how much
 * do medians of `groupSize` runs disagree with each other? Same data, two methods.
 */
export function consistencyStudy(runs: RunResult[], page: Page, config: Config, groupSize: number): ConsistencyReport {
  const facts = computeFacts(page);
  const groups: RunResult[][] = [];
  for (let i = 0; i + groupSize <= runs.length; i += groupSize) groups.push(runs.slice(i, i + groupSize));
  if (runs.length < 2 || groups.length < 2) throw new Error(`Need at least 2 groups of ${groupSize} runs (${groupSize * 2} runs in total).`);

  const grouped = groups.map((g) => aggregate(g, page, facts, config));
  const categories = config.rubric.categories.map((cat) => {
    const single = runs.map((r) => r.categories.find((c) => c.id === cat.id)!.score);
    const method = grouped.map((g) => g.categories.find((c) => c.id === cat.id)!.score);
    return {
      id: cat.id, name: cat.name,
      singleAgreement: agreement(single, median(single)) , singleSpread: spread(single),
      methodAgreement: agreement(method, median(method)), methodSpread: spread(method),
    };
  });
  const sc = runs.map((r) => r.composite.score);
  const mc = grouped.map((g) => g.composite.score);
  return {
    n: runs.length, groupSize, groups: groups.length, categories,
    composite: {
      singleRange: [Math.min(...sc), Math.max(...sc)], methodRange: [Math.min(...mc), Math.max(...mc)],
      singleGradeAgreement: modeShare(runs.map((r) => r.composite.grade)),
      methodGradeAgreement: modeShare(grouped.map((g) => g.composite.grade)),
    },
  };
}


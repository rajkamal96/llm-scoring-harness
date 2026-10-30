import { createHash } from 'node:crypto';
import { computeFacts, parsePage } from '../facts';
import type { Provider } from './types';

// NOT a language model. A rule-based stand-in that lets the harness run (and be tested) with no API key,
// and whose random "noise" is controllable, so the effect of aggregation can be simulated. Its scores say
// nothing about how a real model would grade a page.

const hashUnit = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;
const BENEFIT = /\b(so you|helps?|lets? you|keeps?|means|ideal for|great for|allows?|makes it easy|reduces?|saves?)\b/gi;

export function mockProvider(opts: { noise?: number } = {}): Provider {
  const noise = Math.min(1, Math.max(0, opts.noise ?? 0));
  return {
    id: `mock:noise=${noise}`,
    async run(req) {
      // The page is inside <page ...>...</page> in the user prompt.
      const m = /<page title="([^"]*)">\n([\s\S]*?)\n<\/page>/.exec(req.user);
      const page = parsePage('mock', m?.[2] ?? '');
      page.title = m?.[1] ?? '';
      const f = computeFacts(page);
      const benefits = (page.text.match(BENEFIT) ?? []).length;
      const bucket = (n: number, edges: number[]) => edges.filter((e) => n >= e).length;
      const base: Record<string, number> = {
        title: bucket(f.titleChars, [10, 25, 45, 60]),
        benefits: bucket(benefits, [1, 2, 3, 5]),
        structure: bucket(f.bulletCount, [1, 2, 4, 6]),
        specs: bucket(f.numberWithUnitCount, [1, 2, 4, 6]),
        claims: Math.max(0, 4 - f.superlativeCount),
        keywords: bucket(f.wordCount, [25, 60, 110, 160]),
      };
      const quote = page.text.split(/(?<=[.!?])\s+|\n/).map((s) => s.replace(/^[#>*\-\s]+/, '').trim()).find((s) => s.length > 15)?.slice(0, 120) ?? '';
      const categories = Object.entries(base).map(([id, v]) => {
        let score = v;
        const u = hashUnit(`${page.text}|${id}|${req.runIndex}`);
        if (u < noise / 2) score += 1;
        else if (u < noise) score -= 1;
        score = Math.max(0, Math.min(4, score));
        return { id, score, evidence: quote, rationale: 'Mock rule-based score.' };
      });
      const fixes = categories.filter((c) => c.score < 4).map((c) => ({ category: c.id, severity: c.score <= 1 ? ('major' as const) : ('minor' as const), fix: `Improve ${c.id} (mock suggestion).` }));
      return { raw: { categories, fixes }, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

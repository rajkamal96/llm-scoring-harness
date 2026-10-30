import { describe, expect, it } from 'vitest';
import { loadConfig, validateConfig, type Config } from '../src/config';
import { computeFacts, parsePage } from '../src/facts';
import { agreement, appliedCaps, capScore, checkConsistency, composite, median, spread } from '../src/scoring';

const config = loadConfig();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ALL = (n: number) => Object.fromEntries(config.rubric.categories.map((c) => [c.id, n]));

describe('facts are counted by code', () => {
  const page = parsePage('p.md', `---\ntitle: Test Title\n---\n# Test Title\n\nThe best lamp! It is perfect and amazing.\n\n- Height 46 cm\n- Weighs 1.2 kg and runs 8 hours\n* 600 lumens\n1. second\n\nNo bullets here – 5x4 ok.`);
  const f = computeFacts(page);
  it('counts bullets (dash, star, numbered)', () => expect(f.bulletCount).toBe(4));
  it('counts measurements with units', () => expect(f.numberWithUnitCount).toBe(4)); // 46 cm, 1.2 kg, 8 hours, 600 lumens
  it('counts superlatives as whole words', () => expect(f.superlativeCount).toBe(3)); // best, perfect, amazing
  it('uses the title', () => expect(f.titleChars).toBe('Test Title'.length));
  it('does not count a superlative inside another word', () => {
    expect(computeFacts(parsePage('x', '# T\n\nThe bestseller and the contest.')).superlativeCount).toBe(0);
  });
  it('reads front matter and falls back to the first heading', () => {
    expect(parsePage('x', '# Heading Title\n\ntext').title).toBe('Heading Title');
    expect(parsePage('x', '---\ntitle: "Quoted"\n---\nbody').title).toBe('Quoted');
  });
});

describe('caps', () => {
  it('apply from counted facts and only ever lower a score', () => {
    const facts = { titleChars: 11, wordCount: 50, bulletCount: 0, numberWithUnitCount: 0, superlativeCount: 5 };
    expect(appliedCaps(config.rubric, 'structure', facts).map((c) => c.max)).toEqual([1, 2]);
    expect(capScore(4, appliedCaps(config.rubric, 'structure', facts))).toBe(1);
    expect(capScore(1, appliedCaps(config.rubric, 'structure', facts))).toBe(1);
    expect(capScore(4, appliedCaps(config.rubric, 'benefits', facts))).toBe(4);
    expect(appliedCaps(config.rubric, 'claims', facts)).toEqual([{ fact: 'superlativeCount', value: 5, max: 2 }]);
  });
  it('do not apply when the fact is fine', () => {
    const facts = { titleChars: 80, wordCount: 200, bulletCount: 6, numberWithUnitCount: 9, superlativeCount: 0 };
    for (const c of config.rubric.categories) expect(appliedCaps(config.rubric, c.id, facts)).toEqual([]);
  });
});

describe('median, spread, agreement', () => {
  it('uses the lower median so the result is always an observed score', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([4])).toBe(4);
    expect(() => median([])).toThrow();
  });
  it('is order independent', () => expect(median([4, 1, 3, 2, 2])).toBe(median([2, 2, 1, 4, 3])));
  it('spread and agreement', () => {
    expect(spread([2, 3, 4])).toBe(2);
    expect(agreement([2, 2, 3, 2], 2)).toBe(0.75);
  });
});

describe('composite', () => {
  it('is 0 for all zeros and 100 for all fours', () => {
    expect(composite(ALL(0), config.rubric, config.weights).score).toBe(0);
    expect(composite(ALL(4), config.rubric, config.weights)).toMatchObject({ score: 100, grade: 'A' });
  });
  it('weights are relative: scaling them changes nothing', () => {
    const scores = { title: 4, benefits: 1, structure: 2, specs: 3, claims: 0, keywords: 4 };
    const w2 = clone(config.weights);
    for (const k of Object.keys(w2.weights)) w2.weights[k] *= 7;
    expect(composite(scores, config.rubric, w2).score).toBe(composite(scores, config.rubric, config.weights).score);
  });
  it('changing a weight moves the composite the expected way', () => {
    const scores = { title: 4, benefits: 0, structure: 4, specs: 4, claims: 4, keywords: 4 };
    const base = composite(scores, config.rubric, config.weights).score;
    const w = clone(config.weights);
    w.weights.benefits = 100; // the weak category now matters far more
    expect(composite(scores, config.rubric, w).score).toBeLessThan(base);
  });
  it('maps scores to grade bands', () => {
    expect(composite(ALL(3), config.rubric, config.weights)).toMatchObject({ score: 75, grade: 'B' });
    expect(composite(ALL(2), config.rubric, config.weights)).toMatchObject({ score: 50, grade: 'D' });
    expect(composite(ALL(1), config.rubric, config.weights).grade).toBe('F');
  });
  it('rejects missing or out-of-range scores and zero weights', () => {
    expect(() => composite({ ...ALL(2), title: 7 }, config.rubric, config.weights)).toThrow();
    const missing = ALL(2) as Record<string, number>;
    delete missing.specs;
    expect(() => composite(missing, config.rubric, config.weights)).toThrow();
    const zero = clone(config.weights);
    for (const k of Object.keys(zero.weights)) zero.weights[k] = 0;
    expect(() => composite(ALL(2), config.rubric, zero)).toThrow();
  });
});

describe('config validation', () => {
  const problems = (mutate: (c: Config) => void) => {
    const c = clone(config);
    mutate(c);
    return validateConfig(c);
  };
  it('accepts the shipped config', () => expect(validateConfig(config)).toEqual([]));
  it('catches a weight for an unknown category, a missing weight and all-zero weights', () => {
    expect(problems((c) => { c.weights.weights.nope = 5; })[0]).toContain('unknown category');
    expect(problems((c) => { delete c.weights.weights.specs; })[0]).toContain('no weight');
    expect(problems((c) => { for (const k of Object.keys(c.weights.weights)) c.weights.weights[k] = 0; })).toContain('All weights are zero.');
  });
  it('requires the lowest grade band to start at 0', () => {
    expect(problems((c) => { c.weights.grades = [{ min: 50, grade: 'A' }]; })[0]).toContain('start at 0');
  });
});

describe('cross-section consistency rules', () => {
  const cats = (o: Record<string, { score: number; fixes?: ('minor' | 'major')[] }>) =>
    Object.entries(o).map(([id, v]) => ({ id, score: v.score, fixes: (v.fixes ?? []).map((severity) => ({ severity })) }));
  it('flags a high score with a major fix', () => {
    const f = checkConsistency(config.rubric, cats({ title: { score: 4, fixes: ['major'] } }));
    expect(f.some((x) => x.category === 'title' && x.message.includes('major fix'))).toBe(true);
  });
  it('flags a low score with no fix, but not when a fix exists', () => {
    expect(checkConsistency(config.rubric, cats({ claims: { score: 0 } })).length).toBe(1);
    expect(checkConsistency(config.rubric, cats({ claims: { score: 0, fixes: ['major'] } })).length).toBe(0);
  });
  it('flags an implication that does not hold (strong specs but unstructured)', () => {
    const f = checkConsistency(config.rubric, cats({ specs: { score: 4 }, structure: { score: 1, fixes: ['minor'] } }));
    expect(f.some((x) => x.category === 'structure' && x.message.includes('unstructured'))).toBe(true);
  });
  it('is quiet when everything is consistent', () => {
    expect(checkConsistency(config.rubric, cats({ specs: { score: 3 }, structure: { score: 3, fixes: ['minor'] }, title: { score: 4 } }))).toEqual([]);
  });
});

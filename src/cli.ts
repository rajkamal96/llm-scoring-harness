import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileCache } from './cache';
import { compareResults } from './compare';
import { loadConfig } from './config';
import { consistencyStudy } from './consistency';
import { parsePage } from './facts';
import { geminiProvider } from './providers/gemini';
import { mockProvider } from './providers/mock';
import { ProviderError, type Provider } from './providers/types';
import { renderReport } from './report';
import { rawRuns, scorePage, type ScoreResult } from './score';

const USAGE = `LLM scoring harness (demo)

  npm run score -- <page.md> [--runs 3] [--provider gemini|mock] [--mock-noise 0.3] [--no-cache] [--out out]
  npm run compare -- <before.md> <after.md> [same options]
  npm run consistency -- <page.md> [--n 12] [--group 3] [--provider gemini|mock] [--mock-noise 0.3]

Provider: "gemini" needs GEMINI_API_KEY (free key from Google AI Studio). "mock" is a rule-based stand-in, NOT a language model.
Default: gemini when a key is set, otherwise mock (and it says so).`;

function pickProvider(name: string | undefined, noise: number): { provider: Provider; mock: boolean } {
  const chosen = name ?? (process.env.GEMINI_API_KEY ? 'gemini' : 'mock');
  if (chosen === 'mock') {
    if (!name) console.error('No GEMINI_API_KEY set: using the MOCK scorer (rule-based, not a language model).');
    return { provider: mockProvider({ noise }), mock: true };
  }
  if (chosen !== 'gemini') throw new Error(`Unknown provider "${chosen}".`);
  return { provider: geminiProvider(), mock: false };
}

const loadPage = (path: string) => parsePage(basename(path), readFileSync(path, 'utf8'));

function print(r: ScoreResult) {
  console.log(`\n${r.page.title || r.page.name}  [${r.provider}${r.fromCache ? ', from cache' : ''}]`);
  for (const c of r.categories) console.log(`  ${c.name.padEnd(28)} ${c.score}/4   runs: ${c.runScores.join(',')}${c.unstable ? '  (runs disagree)' : ''}${c.capped ? '  (capped by a counted fact)' : ''}`);
  console.log(`  ${'COMPOSITE'.padEnd(28)} ${r.composite.score}/100  grade ${r.composite.grade}   per-run range ${r.compositeRange[0]}–${r.compositeRange[1]}`);
  console.log(`  tokens ${r.usage.inputTokens + r.usage.outputTokens} over ${r.usage.calls} call(s); est. cost $${r.costUsd.toFixed(4)}`);
  for (const f of r.flags) console.log(`  ! [${f.kind}] ${f.message}`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      runs: { type: 'string' }, n: { type: 'string', default: '12' }, group: { type: 'string', default: '3' },
      provider: { type: 'string' }, 'mock-noise': { type: 'string', default: '0' }, 'no-cache': { type: 'boolean', default: false },
      out: { type: 'string', default: 'out' }, help: { type: 'boolean', default: false },
    },
  });
  const [cmd, ...files] = positionals;
  if (values.help || !cmd) return void console.log(USAGE);

  const config = loadConfig();
  const { provider, mock } = pickProvider(values.provider, Number(values['mock-noise']));
  const cache = values['no-cache'] ? undefined : fileCache(join(process.cwd(), '.cache'));
  const runs = values.runs ? Number(values.runs) : undefined;
  mkdirSync(values.out!, { recursive: true });

  if (cmd === 'score' && files.length === 1) {
    const r = await scorePage(loadPage(files[0]), provider, config, { runs, cache });
    print(r);
    const out = join(values.out!, `${basename(files[0], '.md')}.html`);
    writeFileSync(out, renderReport({ title: `Score: ${r.page.title || r.page.name}`, before: r, weights: config.weights.weights, mock }));
    writeFileSync(out.replace('.html', '.json'), JSON.stringify(r, null, 2));
    console.log(`\nReport: ${out}`);
  } else if (cmd === 'compare' && files.length === 2) {
    const before = await scorePage(loadPage(files[0]), provider, config, { runs, cache });
    const after = await scorePage(loadPage(files[1]), provider, config, { runs, cache });
    const cmp = compareResults(before, after);
    print(before);
    print(after);
    console.log(`\nComposite ${cmp.composite.before} -> ${cmp.composite.after} (${cmp.composite.delta >= 0 ? '+' : ''}${cmp.composite.delta}): ${cmp.verdict}. ${cmp.note}`);
    const out = join(values.out!, `${basename(files[0], '.md')}-vs-${basename(files[1], '.md')}.html`);
    writeFileSync(out, renderReport({ title: 'Before / after comparison', before, after, comparison: cmp, weights: config.weights.weights, mock }));
    writeFileSync(out.replace('.html', '.json'), JSON.stringify({ before, after, comparison: cmp }, null, 2));
    console.log(`Report: ${out}`);
  } else if (cmd === 'consistency' && files.length === 1) {
    const page = loadPage(files[0]);
    const n = Number(values.n), k = Number(values.group);
    console.log(`Running ${n} independent single runs of ${page.name} (no cache) with ${provider.id}…`);
    const runsList = await rawRuns(page, provider, config, n);
    const rep = consistencyStudy(runsList, page, config, k);
    console.log(`\nValid runs: ${runsList.length}/${n}. Compared: one run vs the median of ${k} runs (${rep.groups} groups).`);
    console.log(`${'Category'.padEnd(28)}${'single: agree/spread'.padEnd(24)}median-of-${k}: agree/spread`);
    for (const c of rep.categories) console.log(`${c.name.padEnd(28)}${`${Math.round(c.singleAgreement * 100)}% / ${c.singleSpread}`.padEnd(24)}${Math.round(c.methodAgreement * 100)}% / ${c.methodSpread}`);
    const x = rep.composite;
    console.log(`${'Composite range'.padEnd(28)}${`${x.singleRange[0]}–${x.singleRange[1]}`.padEnd(24)}${x.methodRange[0]}–${x.methodRange[1]}`);
    console.log(`${'Same letter grade'.padEnd(28)}${`${Math.round(x.singleGradeAgreement * 100)}%`.padEnd(24)}${Math.round(x.methodGradeAgreement * 100)}%`);
    if (mock) console.log('\n(MOCK scorer: this shows the measurement, not how a real model behaves.)');
  } else {
    console.log(USAGE);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof ProviderError ? `Model error (${e.code}): ${e.message}` : `Failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});

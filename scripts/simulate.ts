import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config';
import { consistencyStudy } from '../src/consistency';
import { parsePage } from '../src/facts';
import { mockProvider } from '../src/providers/mock';
import { rawRuns } from '../src/score';

// A SIMULATION of the method, not of any real model. The mock scorer's "noise" randomly moves a category score by
// one point with the given probability. This shows how much a median of 3 runs reduces disagreement IF a model's
// run-to-run noise looked like that. How noisy a real model is must be measured with the `consistency` command.

const config = loadConfig();
const page = parsePage('aurora-lamp-revised.md', readFileSync('data/pages/aurora-lamp-revised.md', 'utf8'));
const N = 60, K = 3;

console.log(`Simulation: ${N} runs of one page per noise level; "one run" vs "median of ${K}" (${N / K} groups). Mock scorer, not a language model.\n`);
console.log(`${'noise'.padEnd(8)}${'one run: same grade'.padEnd(22)}${'one run: composite range'.padEnd(28)}${`median of ${K}: same grade`.padEnd(26)}composite range`);
for (const noise of [0, 0.2, 0.4, 0.6]) {
  const runs = await rawRuns(page, mockProvider({ noise }), config, N);
  const r = consistencyStudy(runs, page, config, K).composite;
  console.log(`${String(noise).padEnd(8)}${`${Math.round(r.singleGradeAgreement * 100)}%`.padEnd(22)}${`${r.singleRange[0]}–${r.singleRange[1]}`.padEnd(28)}${`${Math.round(r.methodGradeAgreement * 100)}%`.padEnd(26)}${r.methodRange[0]}–${r.methodRange[1]}`);
}

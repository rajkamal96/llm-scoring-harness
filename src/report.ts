import type { Comparison } from './compare';
import type { ScoreResult } from './score';

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const CSS = `
:root{--bg:#fff;--fg:#1a1f24;--muted:#55606a;--line:#d9e0e6;--soft:#f4f7f9;--ok:#067647;--okbg:#ecfdf3;--bad:#b42318;--badbg:#fef3f2;--warn:#8a5a00;--warnbg:#fff8e6}
@media (prefers-color-scheme:dark){:root{--bg:#12171b;--fg:#e8edf0;--muted:#9aa6b0;--line:#2a333b;--soft:#1a2127;--ok:#6ce9a6;--okbg:#0f2a1d;--bad:#ff8a80;--badbg:#3a1a18;--warn:#ffd27a;--warnbg:#33290d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:16px 16px 60px}h1{font-size:1.5rem;margin:8px 0}h2{font-size:1.15rem;margin:26px 0 8px}h3{font-size:1rem;margin:0}
.muted{color:var(--muted)}.note{background:var(--soft);border:1px solid var(--line);border-left:4px solid #1d4ed8;padding:10px 14px;border-radius:6px;margin:12px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:10px;padding:14px}
.big{font-size:2.2rem;font-weight:700;line-height:1.1}.grade{display:inline-block;margin-left:8px;padding:1px 10px;border-radius:999px;background:var(--soft);border:1px solid var(--line);font-weight:600}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12.5px;border:1px solid var(--line)}.tag.ok{background:var(--okbg);color:var(--ok)}.tag.bad{background:var(--badbg);color:var(--bad)}.tag.warn{background:var(--warnbg);color:var(--warn)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12.5px;color:var(--muted)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.quote{font-style:italic;color:var(--muted)}.tablewrap{overflow-x:auto}
ul{margin:4px 0;padding-left:20px}.flagline{margin:2px 0}
`;

const tag = (cls: string, text: string) => `<span class="tag ${cls}">${esc(text)}</span>`;
const sgn = (n: number) => (n > 0 ? `+${n}` : String(n));

function summary(r: ScoreResult, label: string): string {
  return `<div class="card"><h3>${esc(label)}</h3><div class="muted">${esc(r.page.title || r.page.name)}</div>
<div class="big">${r.composite.score}<span class="grade">${esc(r.composite.grade)}</span></div>
<div class="muted">composite (0–100) · runs ${r.compositeRange[0]}–${r.compositeRange[1]} · ${r.runsValid}/${r.runsRequested} valid run(s)${r.fromCache ? ' · from cache' : ''}</div>
<div class="muted">provider ${esc(r.provider)} · ${r.usage.calls} call(s), ${r.usage.inputTokens + r.usage.outputTokens} tokens · est. cost $${r.costUsd.toFixed(4)}</div></div>`;
}

function categoryTable(r: ScoreResult): string {
  const rows = r.categories
    .map(
      (c) => `<tr><td><strong>${esc(c.name)}</strong></td><td class="num">${c.score}/4</td>
<td class="num">${esc(c.runScores.join(', '))} ${c.unstable ? tag('warn', 'runs disagree') : ''}</td>
<td>${c.evidence ? `<span class="quote">“${esc(c.evidence)}”</span> ${c.evidenceOk ? '' : tag('bad', 'quote not on page')}` : '<span class="muted">no evidence quoted</span>'}<div class="muted">${esc(c.rationale)}</div></td></tr>`,
    )
    .join('');
  return `<div class="tablewrap"><table><thead><tr><th>Category</th><th class="num">Score</th><th class="num">Per run</th><th>Evidence and rationale</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function flagsAndFixes(r: ScoreResult, label: string): string {
  const flags = r.flags.length ? r.flags.map((f) => `<div class="flagline">${tag(f.kind === 'contradiction' || f.kind === 'unsupported-evidence' ? 'bad' : 'warn', f.kind)} ${esc(f.message)}</div>`).join('') : '<div class="muted">No flags.</div>';
  const fixes = r.fixes.length ? `<ul>${r.fixes.map((f) => `<li>${tag(f.severity === 'major' ? 'bad' : 'warn', f.severity)} <strong>${esc(f.category)}:</strong> ${esc(f.fix)}</li>`).join('')}</ul>` : '<div class="muted">No fixes recommended.</div>';
  return `<h3>${esc(label)}: flags</h3>${flags}<h3 style="margin-top:12px">${esc(label)}: recommended fixes</h3>${fixes}`;
}

/** A self-contained HTML report. Everything that came from a page or a model is escaped. */
export function renderReport(opts: { title: string; before: ScoreResult; after?: ScoreResult; comparison?: Comparison; weights: Record<string, number>; mock: boolean }): string {
  const { before, after, comparison } = opts;
  const verdictTag = comparison ? tag(comparison.verdict === 'improved' ? 'ok' : comparison.verdict === 'worse' ? 'bad' : 'warn', comparison.verdict === 'within-noise' ? 'within noise' : comparison.verdict) : '';
  const cmpTable = comparison
    ? `<h2>Before / after</h2><div class="note">${verdictTag} ${esc(comparison.note)}</div>
<div class="tablewrap"><table><thead><tr><th>Category</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th><th>Beyond noise?</th></tr></thead><tbody>
${comparison.categories.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.before}</td><td class="num">${c.after}</td><td class="num">${esc(sgn(c.delta))}</td><td>${c.delta === 0 ? '<span class="muted">no change</span>' : c.beyondNoise ? tag('ok', 'yes') : tag('warn', 'not shown')}</td></tr>`).join('')}
<tr><td><strong>Composite</strong></td><td class="num">${comparison.composite.before} (${esc(comparison.composite.beforeGrade)})</td><td class="num">${comparison.composite.after} (${esc(comparison.composite.afterGrade)})</td><td class="num"><strong>${esc(sgn(comparison.composite.delta))}</strong></td><td>${verdictTag}</td></tr></tbody></table></div>`
    : '';
  const w = Object.entries(opts.weights).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title><style>${CSS}</style></head><body><div class="wrap">
<h1>${esc(opts.title)}</h1>
<div class="note"><strong>Demo report.</strong> Pages are fictional. ${opts.mock ? '<strong>Scores here come from a rule-based MOCK scorer, not a language model</strong>; they only show the harness working. ' : ''}The composite is computed in code from the category scores using the weights in <code>config/weights.json</code> (${w}).</div>
<div class="cards">${summary(before, after ? 'Before' : 'Page')}${after ? summary(after, 'After') : ''}</div>
${cmpTable}
<h2>${after ? 'Before' : 'Scores'}: categories</h2>${categoryTable(before)}${flagsAndFixes(before, after ? 'Before' : 'Page')}
${after ? `<h2>After: categories</h2>${categoryTable(after)}${flagsAndFixes(after, 'After')}` : ''}
</div></body></html>`;
}

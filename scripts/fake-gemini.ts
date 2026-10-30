import { createServer } from 'node:http';

// A FAKE Gemini endpoint to test the harness's live code path without a key:
//   npx tsx scripts/fake-gemini.ts            (listens on :4010)
//   GEMINI_API_BASE=http://127.0.0.1:4010 GEMINI_API_KEY=fake npm run score -- data/pages/aurora-lamp-revised.md
// It does no grading. It scores every category 3 with a quote taken from the page, and adds noise on
// every third call, so the retry, spread and flag paths get exercised. It proves plumbing, not quality.

const port = Number(process.env.PORT ?? 4010);
const ids = ['title', 'benefits', 'structure', 'specs', 'claims', 'keywords'];
let calls = 0;

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls++;
    try {
      const data = JSON.parse(body) as { contents: { parts: { text: string }[] }[]; generationConfig: Record<string, unknown> };
      const user = data.contents[0].parts[0].text;
      const page = /<page [^>]*>\n([\s\S]*?)\n<\/page>/.exec(user)?.[1] ?? '';
      const quote = page.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l.length > 20)?.slice(0, 100) ?? '';
      const categories = ids.map((id, i) => ({ id, score: calls % 3 === 0 && i === 1 ? 1 : 3, evidence: quote, rationale: 'Fake model.' }));
      const fixes = ids.map((id) => ({ category: id, severity: 'minor', fix: `Fake fix for ${id}.` }));
      const hasThinking = 'thinkingConfig' in (data.generationConfig ?? {});
      console.log(`call ${calls}: temperature=${data.generationConfig?.temperature} thinkingConfig=${hasThinking}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ categories, fixes }) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 350 } }));
    } catch {
      res.writeHead(400);
      res.end('{"error":{"message":"bad request"}}');
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`fake gemini on http://127.0.0.1:${port}`));

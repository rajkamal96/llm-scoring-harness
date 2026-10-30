import { ProviderError, type Provider } from './types';

// gemini-2.5-flash returned 404 for new API keys, so the default is a newer model and GEMINI_MODEL can
// override it. No thinkingConfig is sent. Temperature 0 reduces, but does not remove, run-to-run variation.
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 60_000;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function geminiProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  return {
    id: `gemini:${model}`,
    async run(req) {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) throw new ProviderError('not_configured', 'GEMINI_API_KEY is not set');
      // GEMINI_API_BASE exists so tests can point at a local stub; leave it unset in real use.
      const base = env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2500, responseMimeType: 'application/json', responseSchema: req.schema },
      };

      for (let attempt = 0; attempt < 2; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: ctrl.signal });
        } catch (e) {
          console.error('Gemini request error:', e instanceof Error ? e.name : 'unknown');
          if (attempt === 0) continue;
          throw new ProviderError('unavailable', 'The model did not respond in time');
        } finally {
          clearTimeout(timer);
        }
        if (res.status === 429) {
          console.error('Gemini quota/rate limit (429)');
          throw new ProviderError('rate_limited', 'Model quota reached');
        }
        if (res.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (!res.ok) {
          // Log status and Google's error text (e.g. "model not found"); never the key or the page.
          const detail = await res.text().catch(() => '');
          console.error('Gemini request failed with status', res.status, detail.slice(0, 300));
          throw new ProviderError('unavailable', `Model request failed (${res.status})`);
        }
        const data = (await res.json()) as GeminiResponse;
        if (data.promptFeedback?.blockReason) throw new ProviderError('bad_output', 'The request was blocked by the model');
        const cand = data.candidates?.[0];
        if (cand?.finishReason === 'MAX_TOKENS') throw new ProviderError('bad_output', 'The output was cut off');
        let raw: unknown;
        try {
          raw = JSON.parse(cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '');
        } catch {
          throw new ProviderError('bad_output', 'The model returned invalid JSON');
        }
        const u = data.usageMetadata;
        return { raw, usage: u ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 } : undefined };
      }
      throw new ProviderError('unavailable', 'The model is unavailable');
    },
  };
}

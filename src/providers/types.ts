export interface ProviderRequest {
  system: string;
  user: string;
  schema: unknown;
  /** Which repeat this is (0-based). Real providers ignore it; the mock uses it to vary its noise. */
  runIndex: number;
}

export interface ProviderResult {
  raw: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface Provider {
  /** Part of the cache key, so results from different providers or models never mix. */
  id: string;
  run(req: ProviderRequest): Promise<ProviderResult>;
}

export class ProviderError extends Error {
  constructor(
    public code: 'not_configured' | 'rate_limited' | 'unavailable' | 'bad_output',
    message: string,
  ) {
    super(message);
  }
}

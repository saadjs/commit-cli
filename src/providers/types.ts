export interface GenerateOptions {
  /** Model id passed through to the underlying CLI; falls back to the provider's cheap default. */
  model?: string;
  cwd: string;
  timeoutMs: number;
}

/** One coding-agent CLI. Adding a provider means implementing this and registering it. */
export interface Provider {
  readonly name: string;
  readonly bin: string;
  /** Fastest/cheapest model for this provider, used unless the user overrides it. */
  readonly defaultModel?: string;
  /** Send a prompt, get the assistant's final text back. No tools, no side effects. */
  generate(prompt: string, opts: GenerateOptions): Promise<string>;
}

export class ProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

/** Errors worth retrying on a different provider rather than the same one. */
export function isCapacityError(message: string): boolean {
  return /usage limit|rate limit|quota|too many requests|\b429\b|overloaded|credit/i.test(message);
}

import { which } from "../exec.js";
import { claude } from "./claude.js";
import { codex } from "./codex.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";
import type { Provider } from "./types.js";

export const providers: Provider[] = [claude, codex, opencode, pi];
export const defaultProvider = claude.name;

export function providerNames(): string[] {
  return providers.map((p) => p.name);
}

export function getProvider(name: string): Provider {
  const provider = providers.find((p) => p.name === name);
  if (!provider) {
    throw new Error(`Unknown provider "${name}". Available: ${providerNames().join(", ")}`);
  }
  return provider;
}

export function isInstalled(provider: Provider): boolean {
  return which(provider.bin) !== null;
}

export type { Provider, GenerateOptions } from "./types.js";
export { ProviderError, isCapacityError } from "./types.js";

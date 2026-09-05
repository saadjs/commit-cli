import { stripVTControlCharacters } from "node:util";
import { ProviderError } from "./types.js";

export interface FailureOptions {
  /** When any line matches, show only those - cuts through verbose agent logs. */
  prefer?: RegExp;
  /** Lines to always drop, e.g. banners and unrelated warnings. */
  drop?: RegExp;
  maxLines?: number;
}

/** Turn a failed CLI's raw output into something worth putting in front of a user. */
export function providerFailure(
  name: string,
  text: string,
  code: number,
  opts: FailureOptions = {},
): ProviderError {
  const lines = stripVTControlCharacters(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !opts.drop?.test(line));

  const preferred = opts.prefer ? lines.filter((line) => opts.prefer!.test(line)) : [];
  const unique = [...new Set(preferred.length ? preferred : lines)];
  const message = unique.slice(0, opts.maxLines ?? 6).join("\n");

  return new ProviderError(name, message || `exited with code ${code}`);
}

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { providerNames } from "./providers/index.js";

export interface Config {
  provider?: string;
  /** Per-provider model override, e.g. { "claude": "sonnet" } */
  models?: Record<string, string>;
  split?: boolean;
  /** Paths always left out of a commit; CLI -x adds to these. */
  exclude?: string[];
  maxDiffBytes?: number;
  timeoutMs?: number;
  /** Extra style guidance appended to the prompt. */
  instructions?: string;
}

export interface ConfigFile {
  path: string;
  loaded: boolean;
}

export interface LoadedConfig {
  config: Config;
  files: ConfigFile[];
  /** Which file each key came from, for `commit --config`. */
  sources: Record<string, string>;
}

const GLOBAL_PATH = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "commit-cli", "config.json");
const REPO_FILE = ".commitrc.json";

const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
const isStringMap = (v: unknown) =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
const isPositive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

const SCHEMA: Record<keyof Config, { check: (v: unknown) => boolean; expected: string }> = {
  provider: { check: (v) => typeof v === "string", expected: `one of: ${providerNames().join(", ")}` },
  models: { check: isStringMap, expected: 'an object like { "claude": "sonnet" }' },
  split: { check: (v) => typeof v === "boolean", expected: "true or false" },
  exclude: { check: isStringArray, expected: 'an array like ["*.lock"]' },
  maxDiffBytes: { check: isPositive, expected: "a positive number" },
  timeoutMs: { check: isPositive, expected: "a positive number" },
  instructions: { check: (v) => typeof v === "string", expected: "a string" },
};

const KEYS = Object.keys(SCHEMA);

function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

function suggest(key: string): string {
  const near = KEYS.map((k) => ({ k, d: distance(key.toLowerCase(), k.toLowerCase()) }))
    .filter((c) => c.d <= 3)
    .sort((a, b) => a.d - b.d)[0];
  return near ? ` Did you mean "${near.k}"?` : ` Valid keys: ${KEYS.join(", ")}.`;
}

function validate(raw: unknown, path: string): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: expected a JSON object`);
  }

  for (const [key, value] of Object.entries(raw)) {
    const rule = SCHEMA[key as keyof Config];
    if (!rule) throw new Error(`${path}: unknown option "${key}".${suggest(key)}`);
    if (!rule.check(value)) throw new Error(`${path}: "${key}" must be ${rule.expected}`);
  }

  const config = raw as Config;
  if (config.provider && !providerNames().includes(config.provider)) {
    throw new Error(`${path}: unknown provider "${config.provider}". Valid: ${providerNames().join(", ")}`);
  }
  for (const name of Object.keys(config.models ?? {})) {
    if (!providerNames().includes(name)) {
      throw new Error(`${path}: "models" has unknown provider "${name}". Valid: ${providerNames().join(", ")}`);
    }
  }
  return config;
}

async function read(path: string): Promise<Config | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path}: invalid JSON - ${(err as Error).message}`);
  }
  return validate(parsed, path);
}

/** Repo config wins over global; `exclude` lists and `models` maps merge instead of replacing. */
export async function loadConfig(repoRoot: string): Promise<LoadedConfig> {
  const paths = [GLOBAL_PATH, join(repoRoot, REPO_FILE)];
  const loaded = await Promise.all(paths.map(read));

  const config: Config = {};
  const sources: Record<string, string> = {};

  paths.forEach((path, i) => {
    const layer = loaded[i];
    if (!layer) return;
    for (const [key, value] of Object.entries(layer)) {
      if (key === "models") {
        config.models = { ...config.models, ...(value as Record<string, string>) };
      } else if (key === "exclude") {
        config.exclude = [...new Set([...(config.exclude ?? []), ...(value as string[])])];
      } else {
        (config as Record<string, unknown>)[key] = value;
      }
      sources[key] = path;
    }
  });

  return { config, files: paths.map((path, i) => ({ path, loaded: loaded[i] !== null })), sources };
}

export const configPath = GLOBAL_PATH;
export const repoConfigFile = REPO_FILE;

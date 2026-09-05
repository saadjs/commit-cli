import { z } from "zod";
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

const GLOBAL_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "commit-cli",
  "config.json",
);
const REPO_FILE = ".commitrc.json";

const configSchema = z.compile(
  z.strictObject({
    provider: z.string().optional(),
    models: z.record(z.string(), z.string()).optional(),
    split: z.boolean().optional(),
    exclude: z.array(z.string()).optional(),
    maxDiffBytes: z.number().positive().optional(),
    timeoutMs: z.number().positive().optional(),
    instructions: z.string().optional(),
  }),
);
const expectedValues = new Map([
  ["provider", `one of: ${providerNames().join(", ")}`],
  ["models", 'an object like { "claude": "sonnet" }'],
  ["split", "true or false"],
  ["exclude", 'an array like ["*.lock"]'],
  ["maxDiffBytes", "a positive number"],
  ["timeoutMs", "a positive number"],
  ["instructions", "a string"],
]);
const KEYS = Object.keys(configSchema.shape);

function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + cost,
      );
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

function validate(text: string, path: string): Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path}: invalid JSON - ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    if (issue.code === "unrecognized_keys") {
      const key = issue.keys[0]!;
      throw new Error(`${path}: unknown option "${key}".${suggest(key)}`);
    }
    if (!issue.path.length) throw new Error(`${path}: expected a JSON object`);
    const key = String(issue.path[0]);
    throw new Error(`${path}: "${key}" must be ${expectedValues.get(key)}`);
  }
  const config = result.data;
  if (config.provider && !providerNames().includes(config.provider)) {
    throw new Error(
      `${path}: unknown provider "${config.provider}". Valid: ${providerNames().join(", ")}`,
    );
  }
  for (const name of Object.keys(config.models ?? {})) {
    if (!providerNames().includes(name)) {
      throw new Error(
        `${path}: "models" has unknown provider "${name}". Valid: ${providerNames().join(", ")}`,
      );
    }
  }
  return config;
}

async function read(path: string): Promise<Config | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }

  return validate(text, path);
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
    const models = config.models;
    const exclude = config.exclude;
    Object.assign(config, layer);
    if (layer.models) config.models = { ...models, ...layer.models };
    if (layer.exclude) config.exclude = [...new Set([...(exclude ?? []), ...layer.exclude])];
    for (const key of Object.keys(layer)) sources[key] = path;
  });

  return { config, files: paths.map((path, i) => ({ path, loaded: loaded[i] !== null })), sources };
}

export const configPath = GLOBAL_PATH;
export const repoConfigFile = REPO_FILE;

#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { branchNameTaken, sanitizeBranchName, uniqueBranchName } from "./branch.js";
import { loadConfig, configPath, repoConfigFile, type LoadedConfig } from "./config.js";
import { preparePublish, publish, existingPr, run, type PublishOptions } from "./publish.js";
import { prPrompt, proposePr } from "./pr.js";
import { editMessage } from "./editor.js";
import * as git from "./git.js";
import { formatMessage, parseResponse, type Proposal, type ProposedCommit } from "./parse.js";
import { buildPrompt } from "./prompt.js";
import { ProviderError, defaultProvider, getProvider, isCapacityError, isInstalled, providerNames, providers } from "./providers/index.js";
import { ask, color, fail, info, out, spinner, warn } from "./ui.js";

const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
const DEFAULT_MAX_DIFF_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 180_000;

const HELP = `${color.bold("commit")} - write and organize git commits with a coding-agent CLI

${color.bold("Usage")}
  commit [options] [paths...]

${color.bold("Paths")}
  Named paths are committed on their own, staged for you if needed - so you can
  attach files that are not yet tracked. Without paths, see Staging below.

${color.bold("Options")}
  -m, --message <hint>   Tell the model what the change is about
  -a, --all              Stage untracked files too
  -x, --exclude <path>   Leave a path out of the commit (repeatable, globs ok)
  -b, --branch           Propose a new branch and commit there
      --branch-name <name>  Use an explicit new branch name (implies -b)
      --split            Split the changes into multiple logical commits
      --push             Push the branch after committing (also works with no changes)
      --pr               Push and create a GitHub PR (requires gh)
      --draft            Create a draft PR (requires --pr)
      --base <branch>    PR base (default: repository default branch)
      --remote <name>    Push remote (default: configured remote, otherwise origin)
  -y, --yes              Commit and publish without confirming
      --dry-run          Preview without committing or publishing
  -P, --provider <name>  ${providerNames().join(", ")} (default: ${defaultProvider})
      --model <id>       Override the provider's default model
      --no-verify        Skip git commit hooks
      --timeout <sec>    Provider timeout (default: ${DEFAULT_TIMEOUT_MS / 1000})
      --providers        List providers and whether they are installed
      --config           Show the resolved config and where each value came from
  -v, --verbose          Print the raw provider response
  -h, --help             Show this help
  -V, --version          Show version

${color.bold("Config")}
  ${configPath}
  ${repoConfigFile} in the repo root (wins over global)
  COMMIT_PROVIDER / COMMIT_MODEL env vars (win over both)

  { "provider": "claude", "models": { "claude": "sonnet" },
    "split": false, "exclude": ["*.lock"], "instructions": "..." }

${color.bold("Staging")}
  Anything already staged is used as-is. Otherwise all tracked changes are
  staged for you; add -a to include untracked files.`;

function listProviders(): void {
  for (const p of providers) {
    const mark = isInstalled(p) ? color.green("installed") : color.dim("not found");
    const star = p.name === defaultProvider ? "*" : " ";
    out(`${star} ${p.name.padEnd(10)} ${mark.padEnd(20)} ${color.dim(p.defaultModel ?? "provider default")}`);
  }
}

function showConfig({ config, files, sources }: LoadedConfig): void {
  const envProvider = process.env.COMMIT_PROVIDER;
  const envModel = process.env.COMMIT_MODEL;
  const active = envProvider ?? config.provider ?? defaultProvider;

  const shown: [string, unknown][] = [
    ["provider", active],
    ["split", config.split ?? false],
    ["exclude", config.exclude?.join(" ") || "-"],
    ["maxDiffBytes", config.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES],
    ["timeoutMs", config.timeoutMs ?? DEFAULT_TIMEOUT_MS],
    ["instructions", config.instructions ?? "-"],
  ];

  for (const [key, value] of shown) {
    const env = key === "provider" && envProvider ? "COMMIT_PROVIDER env" : undefined;
    const origin = env ?? sources[key] ?? "default";
    out(`${key.padEnd(16)} ${String(value).slice(0, 60).padEnd(30)} ${color.dim(origin)}`);
  }
  for (const p of providers) {
    const overridden = envModel && p.name === active;
    const model = (overridden ? envModel : config.models?.[p.name]) ?? p.defaultModel ?? "provider default";
    const origin = overridden ? "COMMIT_MODEL env" : config.models?.[p.name] ? sources.models! : "default";
    const marker = p.name === active ? color.cyan("*") : " ";
    out(`${marker}${`models.${p.name}`.padEnd(15)} ${model.padEnd(30)} ${color.dim(origin)}`);
  }

  out("");
  for (const f of files) out(color.dim(`${f.loaded ? "loaded" : "absent"}  ${f.path}`));
  if (!files.some((f) => f.loaded)) {
    out(color.dim(`\ncreate one with:  mkdir -p "$(dirname ${configPath})" && $EDITOR ${configPath}`));
  }
}

function renderProposal(commits: ProposedCommit[], totalFiles: number, branch?: string): void {
  info("");
  if (branch) info(color.cyan(`→ new branch: ${branch}`));
  commits.forEach((commit, i) => {
    const label = commits.length > 1 ? color.dim(`[${i + 1}/${commits.length}] `) : "";
    info(`${label}${color.bold(color.green(commit.subject))}`);
    if (commit.body) info(commit.body.split("\n").map((l) => `  ${l}`).join("\n"));
    if (commits.length > 1 && commit.files?.length) {
      info(commit.files.map((f) => color.dim(`  - ${f}`)).join("\n"));
    }
    info("");
  });
  if (commits.length === 1) info(color.dim(`${totalFiles} file${totalFiles === 1 ? "" : "s"} staged`));
}

/** Make the model's grouping safe to execute: known paths only, nothing dropped, nothing twice. */
function reconcileGroups(commits: ProposedCommit[], staged: string[]): ProposedCommit[] {
  const remaining = new Set(staged);
  const groups = commits.map((commit) => {
    const files = (commit.files ?? []).filter((f) => remaining.has(f));
    for (const f of files) remaining.delete(f);
    return { ...commit, files };
  });

  const kept = groups.filter((g) => g.files.length > 0);
  if (kept.length === 0) throw new Error("the model did not assign any known files to a commit");

  if (remaining.size > 0) {
    warn(`${remaining.size} file(s) were left out of the split; adding them to the last commit`);
    kept[kept.length - 1]!.files.push(...remaining);
  }
  return kept;
}

/** A short reply with no JSON at all is an error message, not a bad attempt - don't pay for a retry. */
function looksLikeError(raw: string): boolean {
  return !raw.includes("{") && raw.trim().length < 400;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Cut at a byte boundary without leaving a dangling partial UTF-8 sequence. */
function truncateBytes(text: string, maxBytes: number): string {
  return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
}

async function generate(
  prompt: string,
  provider: ReturnType<typeof getProvider>,
  model: string | undefined,
  cwd: string,
  timeoutMs: number,
  verbose: boolean,
): Promise<Proposal> {
  let lastError: Error | undefined;
  let lastRaw = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const label = `asking ${provider.name}${model ? ` (${model})` : ""}${attempt > 1 ? " again" : ""}...`;
    // Tell the model what went wrong last time; a verbatim retry tends to fail the same way.
    const fullPrompt = lastError
      ? `${prompt}\n\nYour previous reply could not be used (${lastError.message}). Reply with only the JSON object described above.`
      : prompt;
    const stop = spinner(label);
    let raw: string;
    try {
      raw = await provider.generate(fullPrompt, { model, cwd, timeoutMs });
    } finally {
      stop();
    }

    if (verbose) info(color.dim(`--- ${provider.name} response ---\n${raw}\n---`));

    try {
      return parseResponse(raw);
    } catch (err) {
      lastError = toError(err);
      lastRaw = raw;
      if (looksLikeError(raw)) break;
      warn(`could not read the response (${lastError.message})`);
    }
  }

  // A CLI that reports its own errors on stdout and exits 0 lands here, so show what it said.
  const snippet = lastRaw.trim().split("\n").slice(0, 4).join("\n").slice(0, 400);
  throw new ProviderError(
    provider.name,
    snippet ? `${lastError?.message ?? "unusable response"}\n${snippet}` : (lastError?.message ?? "empty response"),
  );
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: {
      message: { type: "string", short: "m" },
      all: { type: "boolean", short: "a", default: false },
      branch: { type: "boolean", short: "b", default: false },
      "branch-name": { type: "string" },
      push: { type: "boolean", default: false },
      pr: { type: "boolean", default: false },
      draft: { type: "boolean", default: false },
      base: { type: "string" },
      remote: { type: "string" },
      split: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "dry-run": { type: "boolean", default: false },
      provider: { type: "string", short: "P" },
      model: { type: "string" },
      "no-verify": { type: "boolean", default: false },
      timeout: { type: "string" },
      providers: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "V", default: false },
      exclude: { type: "string", short: "x", multiple: true, default: [] },
      config: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    out(HELP);
    return 0;
  }
  if (values.version) {
    out(VERSION);
    return 0;
  }
  if (values.providers) {
    listProviders();
    return 0;
  }

  const wantPublish = values.push || values.pr;
  if ((values.draft || values.base !== undefined) && !values.pr) throw new Error("--draft and --base require --pr");
  if (values.remote !== undefined && !wantPublish) throw new Error("--remote requires --push or --pr");
  for (const key of ["base", "remote"] as const) {
    if (values[key] !== undefined && (!values[key]!.trim() || values[key]!.startsWith("-"))) throw new Error(`invalid --${key}`);
  }

  const foundRoot = await git.repoRoot(process.cwd());
  if (!foundRoot) {
    fail("not a git repository");
    return 1;
  }

  const root = foundRoot;
  const { config, files, sources } = await loadConfig(root);

  if (values.config) {
    showConfig({ config, files, sources });
    return 0;
  }

  const providerName = values.provider ?? process.env.COMMIT_PROVIDER ?? config.provider ?? defaultProvider;
  const provider = getProvider(providerName);
  function requireProvider(): void {
    if (!isInstalled(provider)) throw new Error(`${provider.name} CLI not found on PATH (looked for "${provider.bin}")`);
  }
  if (!values.yes && !values["dry-run"] && !process.stdin.isTTY) {
    fail("stdin is not a terminal, so there is no way to confirm; use -y to commit or --dry-run to preview");
    return 1;
  }
  const model = values.model ?? process.env.COMMIT_MODEL ?? config.models?.[provider.name] ?? provider.defaultModel;
  const split = values.split || config.split === true;
  let timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (values.timeout !== undefined) {
    const seconds = Number(values.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      fail(`--timeout must be a positive number of seconds, got "${values.timeout}"`);
      return 1;
    }
    timeoutMs = seconds * 1000;
  }

  const explicitBranch = values["branch-name"];
  const wantBranch = values.branch || explicitBranch !== undefined;
  if (explicitBranch !== undefined) {
    await git.validateBranchName(root, explicitBranch);
    if (branchNameTaken(explicitBranch, await git.listBranches(root))) {
      throw new Error(`branch name already exists or conflicts with an existing branch: ${explicitBranch}`);
    }
  }

  const publishOptions: PublishOptions = {
    pr: values.pr, remote: values.remote, base: values.base, draft: values.draft,
    dryRun: values["dry-run"], newBranch: wantBranch,
  };
  const destination = wantPublish ? await preparePublish(root, publishOptions) : undefined;
  async function finishPublish(branch: string, pendingCommits = false, createBranch = false): Promise<number> {
    if (!destination) return 0;
    const reviewedHead = await run(root, "git", ["rev-parse", "HEAD"]);
    const reviewedBranch = await git.branchName(root);
    if (values.pr && (branch === destination.base || branch === destination.defaultBranch)) {
      throw new Error("PR head must be a feature branch distinct from the base and default branch");
    }
    if (createBranch) info(`→ new branch: ${branch}`);
    info(`\nDestination: ${destination.remote}${destination.repo ? ` (${destination.repo}), ${branch} → ${destination.base}` : `, branch ${branch}`}`);
    const url = values.pr ? await existingPr(root, destination, branch) : undefined;
    let pr;
    if (values.pr && !url) {
      requireProvider();
      const prompt = await prPrompt(root, destination, branch, config.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES,
        pendingCommits, config.instructions, values.message);
      pr = await proposePr(prompt, provider, { cwd: root, model, timeoutMs }, values.yes, values["dry-run"], values.verbose);
      if (!pr) { info("publishing canceled; local commits and staged changes are preserved"); return 1; }
    } else if (!values.yes && !values["dry-run"]) {
      if (await ask("push branch? [Y]es [n]o ", ["y", "n"]) === "n") {
        info("publishing canceled; local commits are preserved"); return 1;
      }
    }
    if (await run(root, "git", ["rev-parse", "HEAD"]) !== reviewedHead || await git.branchName(root) !== reviewedBranch) {
      throw new Error("branch changed during PR preview; rerun to review the current commits");
    }
    if (createBranch && !values["dry-run"]) await git.createBranch(root, branch);
    await publish(root, destination, branch, publishOptions, pr, url);
    return 0;
  }

  const exclude = [...new Set([...(config.exclude ?? []), ...(values.exclude ?? [])])];
  let staged = await git.stagedPaths(root);

  if (positionals.length > 0) {
    if (staged.length > 0) warn("committing only the paths you named; everything else has been unstaged");
    await git.resetIndex(root);
    await git.stagePaths(root, positionals);
  } else if (values.all) {
    await git.stageAll(root);
  } else if (staged.length === 0) {
    await git.stageTracked(root);
  }

  if (exclude.length > 0) await git.unstagePaths(root, exclude);
  staged = await git.stagedPaths(root);

  if (staged.length === 0) {
    if (wantPublish) {
      if (wantBranch) {
        let name = explicitBranch;
        if (name === undefined) {
          requireProvider();
          const proposal = await generate(`Propose a new feature branch name for these existing commits.
Return JSON {"branch":"lowercase-kebab-case","commits":[{"subject":"brief summary"}]}.
Recent commits: ${(await git.recentSubjects(root)).join("\n")}
Author hint: ${values.message ?? "none"}`, provider, model, root, timeoutMs, values.verbose);
          name = uniqueBranchName(sanitizeBranchName(proposal.branch), await git.listBranches(root));
        }
        return finishPublish(name, false, true);
      }
      return finishPublish(await git.branchName(root));
    }
    if (positionals.length > 0) {
      info(`nothing to commit for: ${positionals.join(", ")}`);
    } else if (exclude.length > 0) {
      info("nothing to commit once the excluded paths are left out");
    } else {
      const untracked = await git.untrackedPaths(root);
      info(untracked.length ? `nothing staged; ${untracked.length} untracked file(s) - use -a to include them` : "nothing to commit");
    }
    return 0;
  }

  requireProvider();
  const [changes, stat, fullDiff, branch, recentSubjects] = await Promise.all([
    git.stagedChanges(root),
    git.stagedStat(root),
    git.stagedDiff(root),
    git.branchName(root),
    git.recentSubjects(root),
  ]);

  const maxBytes = config.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;
  const truncated = Buffer.byteLength(fullDiff) > maxBytes;
  if (truncated) warn(`diff is large; sending the first ${Math.round(maxBytes / 1000)}KB plus the diffstat`);

  const prompt = buildPrompt({
    branch,
    files: changes,
    stat,
    diff: truncated ? truncateBytes(fullDiff, maxBytes) : fullDiff,
    truncated,
    recentSubjects,
    split,
    wantBranch: wantBranch && explicitBranch === undefined,
    hint: values.message,
    instructions: config.instructions,
  });

  for (;;) {
    const proposal = await generate(prompt, provider, model, root, timeoutMs, values.verbose);
    let commits = proposal.commits;
    const newBranch = wantBranch
      ? explicitBranch ?? uniqueBranchName(sanitizeBranchName(proposal.branch), [...await git.listBranches(root), branch])
      : undefined;
    if (split) commits = reconcileGroups(commits, staged);
    else commits = [commits[0]!];

    if (destination && values.pr && newBranch && (newBranch === destination.base || newBranch === destination.defaultBranch)) {
      throw new Error("new PR branch must differ from the base and default branch");
    }
    renderProposal(commits, staged.length, newBranch);

    if (values["dry-run"]) return finishPublish(newBranch ?? branch, true);

    let answer = "y";
    if (!values.yes) {
      answer = await ask(`${color.bold("commit?")} ${color.dim("[Y]es [e]dit [r]egenerate [n]o")} `, ["y", "e", "r", "n"]);
    }

    if (answer === "n") {
      info("aborted; your changes are still staged");
      return 1;
    }

    if (answer === "r") continue;

    if (answer === "e") {
      const edited: ProposedCommit[] = [];
      for (const [i, commit] of commits.entries()) {
        // In split mode one editor opens per commit; say so, or the second one is a surprise.
        if (commits.length > 1) info(color.dim(`opening editor ${i + 1} of ${commits.length}...`));
        const note = commits.length > 1 ? `commit ${i + 1} of ${commits.length}: ${commit.files?.join(", ")}` : `${staged.length} file(s)`;
        const original = formatMessage(commit);
        const text = await editMessage(original, note);
        if (!text) {
          info("aborted; your changes are still staged");
          return 1;
        }
        if (text.trim() === original.trim()) info(color.dim("message unchanged"));
        const [subject, ...rest] = text.split("\n");
        edited.push({ subject: subject!.trim(), body: rest.join("\n").trim() || undefined, files: commit.files });
      }
      commits = edited;
    }

    const code = await applyCommits(root, commits, split, values["no-verify"] === true, newBranch);
    if (code !== 0) return code;
    return finishPublish(await git.branchName(root));
  }
}

async function applyCommits(root: string, commits: ProposedCommit[], split: boolean, noVerify: boolean, branch?: string): Promise<number> {
  if (branch) await git.createBranch(root, branch);
  if (!split) {
    const sha = await git.commit(root, formatMessage(commits[0]!), { noVerify });
    info(`${color.green("committed")} ${color.dim(sha)} ${commits[0]!.subject}`);
    return 0;
  }

  await git.resetIndex(root);
  let made = 0;
  for (const commit of commits) {
    await git.stagePaths(root, commit.files ?? []);
    if ((await git.stagedPaths(root)).length === 0) {
      warn(`skipping "${commit.subject}" - nothing to commit for it`);
      continue;
    }
    const sha = await git.commit(root, formatMessage(commit), { noVerify });
    info(`${color.green("committed")} ${color.dim(sha)} ${commit.subject}`);
    made++;
  }

  if (made === 0) {
    fail("no commits were created; your changes are unstaged");
    return 1;
  }
  return 0;
}

// Set exitCode rather than calling process.exit(): piped stdout is async and exit() would truncate it.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const error = toError(err);
    fail(error.message);
    if (error instanceof ProviderError && isCapacityError(error.message)) {
      const others = providers.filter((p) => p.name !== error.provider && isInstalled(p)).map((p) => `-P ${p.name}`);
      if (others.length) info(color.dim(`  another provider is available: ${others.join("  ")}`));
    }
    process.exitCode = 1;
  });

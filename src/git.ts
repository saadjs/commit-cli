import { exec } from "./exec.js";

export interface FileChange {
  status: string;
  path: string;
}

async function git(args: string[], cwd: string, input?: string): Promise<string> {
  const result = await exec("git", args, { cwd, input });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
  } catch {
    return null;
  }
}

export async function branchName(cwd: string): Promise<string> {
  const result = await exec("git", ["branch", "--show-current"], { cwd });
  return result.stdout.trim() || "(detached)";
}

/** Recent subjects let the model match the repo's existing message style. */
export async function recentSubjects(cwd: string, count = 10): Promise<string[]> {
  try {
    const out = await git(["log", `-n${count}`, "--pretty=%s"], cwd);
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function stagedPaths(cwd: string): Promise<string[]> {
  const out = await git(["diff", "--cached", "--name-only", "-z"], cwd);
  return out.split("\0").filter(Boolean);
}

export async function unstagedTrackedPaths(cwd: string): Promise<string[]> {
  const out = await git(["diff", "--name-only", "-z"], cwd);
  return out.split("\0").filter(Boolean);
}

export async function untrackedPaths(cwd: string): Promise<string[]> {
  const out = await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  return out.split("\0").filter(Boolean);
}

export async function stagedChanges(cwd: string): Promise<FileChange[]> {
  const out = await git(["diff", "--cached", "--name-status", "-M", "-z"], cwd);
  const parts = out.split("\0").filter(Boolean);
  const changes: FileChange[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i]!;
    // Renames and copies carry two paths; the destination is what we commit.
    if (status.startsWith("R") || status.startsWith("C")) {
      changes.push({ status, path: parts[i + 2] ?? "" });
      i += 3;
    } else {
      changes.push({ status, path: parts[i + 1] ?? "" });
      i += 2;
    }
  }
  return changes.filter((c) => c.path);
}

export async function stageTracked(cwd: string): Promise<void> {
  await git(["add", "-u"], cwd);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(["add", "-A"], cwd);
}

export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(["add", "-A", "--", ...paths], cwd);
}

export async function resetIndex(cwd: string): Promise<void> {
  await git(["reset", "-q"], cwd);
}

export async function stagedDiff(cwd: string, paths?: string[]): Promise<string> {
  const args = ["diff", "--cached", "--no-color", "-M", "--unified=3"];
  if (paths?.length) args.push("--", ...paths);
  return git(args, cwd);
}

export async function stagedStat(cwd: string): Promise<string> {
  return git(["diff", "--cached", "--no-color", "--stat=200"], cwd);
}

export async function commit(cwd: string, message: string, opts: { noVerify?: boolean } = {}): Promise<string> {
  const args = ["commit", "-F", "-", "--cleanup=strip"];
  if (opts.noVerify) args.push("--no-verify");
  await git(args, cwd, message);
  return (await git(["rev-parse", "--short", "HEAD"], cwd)).trim();
}

async function hasHead(cwd: string): Promise<boolean> {
  const result = await exec("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd });
  return result.code === 0;
}

/** Drop paths from the index. Before the first commit there is no HEAD to reset against. */
export async function unstagePaths(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (await hasHead(cwd)) {
    await git(["reset", "-q", "--", ...paths], cwd);
  } else {
    const result = await exec("git", ["rm", "-q", "--cached", "-r", "--ignore-unmatch", "--", ...paths], { cwd });
    if (result.code !== 0) throw new Error(`git rm --cached failed:\n${result.stderr.trim()}`);
  }
}

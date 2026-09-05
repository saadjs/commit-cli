import { z } from "zod";
import { exec, which } from "./exec.js";
import { info, out } from "./ui.js";

export interface PublishOptions {
  pr: boolean;
  remote?: string;
  base?: string;
  draft: boolean;
  dryRun: boolean;
  newBranch: boolean;
}
export interface Destination {
  remote: string;
  pushUrl: string;
  repo?: string;
  base?: string;
  baseSha?: string;
  defaultBranch?: string;
}

export async function run(
  cwd: string,
  bin: string,
  args: string[],
  input?: string,
): Promise<string> {
  const result = await exec(bin, args, { cwd, input });
  if (result.code !== 0)
    throw new Error(
      `${bin} ${args.join(" ")} failed:\n${result.stderr.trim() || result.stdout.trim()}`,
    );
  return result.stdout.trim();
}

export function githubRepo(url: string): string {
  const match = url.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)[:/]([^/]+)\/([^/]+?)\/?$/);
  if (!match) throw new Error("PRs require a GitHub HTTPS or SSH remote URL");
  return `${match[1]}/${match[2]}/${match[3]!.replace(/\.git$/, "")}`;
}

const repositorySchema = z.compile(
  z.object({
    nameWithOwner: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    isFork: z.boolean(),
    defaultBranchRef: z.object({ name: z.string().min(1) }).nullable(),
  }),
);
const pullRequestsSchema = z.compile(
  z.array(
    z.object({
      url: z.url(),
      isCrossRepository: z.boolean(),
      baseRefName: z.string().min(1),
    }),
  ),
);

/** Resolve and validate all destinations before staging or committing. */
export async function preparePublish(cwd: string, options: PublishOptions): Promise<Destination> {
  const branch = await run(cwd, "git", ["branch", "--show-current"]);
  if (!branch && !options.newBranch)
    throw new Error("cannot publish detached HEAD; use -b or --branch-name");
  const remotes = (await run(cwd, "git", ["remote"])).split("\n").filter(Boolean);
  const configured = branch
    ? await exec("git", ["config", "--get", `branch.${branch}.remote`], { cwd })
    : undefined;
  const remote = options.remote ?? (configured?.code === 0 ? configured.stdout.trim() : "origin");
  if (!remotes.includes(remote))
    throw new Error(`no usable remote '${remote}'; choose a destination with --remote <name>`);
  const urls = (await run(cwd, "git", ["remote", "get-url", "--push", "--all", remote])).split(
    "\n",
  );
  if (urls.length !== 1)
    throw new Error(
      `remote '${remote}' has multiple push URLs; choose a remote with one destination`,
    );
  const destination: Destination = { remote, pushUrl: urls[0]! };
  if (!options.pr) return destination;
  if (!which("gh"))
    throw new Error("gh CLI not found on PATH; install and authenticate gh before using --pr");
  const repo = githubRepo(destination.pushUrl);
  await run(cwd, "gh", ["auth", "status", "--hostname", repo.split("/")[0]!]);
  const metadata = repositorySchema.parse(
    JSON.parse(
      await run(cwd, "gh", [
        "repo",
        "view",
        repo,
        "--json",
        "nameWithOwner,isFork,defaultBranchRef",
      ]),
    ),
  );
  if (metadata.isFork)
    throw new Error(
      "fork destinations are not supported yet; choose a same-repository remote with --remote",
    );
  const fetchRepo = githubRepo(await run(cwd, "git", ["remote", "get-url", remote]));
  if (fetchRepo.toLowerCase() !== repo.toLowerCase())
    throw new Error("different fetch and push repositories are not supported for PRs");
  destination.repo = `${repo.split("/")[0]}/${metadata.nameWithOwner}`;
  destination.defaultBranch = metadata.defaultBranchRef?.name;
  destination.base = options.base ?? destination.defaultBranch;
  if (!destination.base) throw new Error("repository has no default branch; specify --base");
  await run(cwd, "git", ["check-ref-format", `refs/heads/${destination.base}`]);
  if (!options.newBranch && (branch === destination.defaultBranch || branch === destination.base)) {
    throw new Error("create a feature branch before opening a PR; use -b or --branch-name");
  }
  // Fetch to FETCH_HEAD, without creating a local branch or moving the user's branch.
  await run(cwd, "git", ["fetch", "--no-tags", remote, `refs/heads/${destination.base}`]);
  destination.baseSha = await run(cwd, "git", ["rev-parse", "FETCH_HEAD"]);
  return destination;
}

export async function existingPr(
  cwd: string,
  destination: Destination,
  branch: string,
): Promise<string | undefined> {
  const prs = pullRequestsSchema.parse(
    JSON.parse(
      await run(cwd, "gh", [
        "pr",
        "list",
        "--repo",
        destination.repo!,
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "url,headRepositoryOwner,headRepository,isCrossRepository,baseRefName",
      ]),
    ),
  );
  const matches = prs.filter((pr) => !pr.isCrossRepository);
  if (matches.length > 1)
    throw new Error(
      "multiple open PRs exist for this branch; resolve the ambiguity on GitHub first",
    );
  if (matches[0] && matches[0].baseRefName !== destination.base) {
    throw new Error(
      `existing PR targets '${matches[0].baseRefName}'; rerun with --base ${matches[0].baseRefName}`,
    );
  }
  return matches[0]?.url;
}

export async function publish(
  cwd: string,
  destination: Destination,
  branch: string,
  options: PublishOptions,
  pr?: { title: string; body: string },
  existingUrl?: string,
): Promise<void> {
  info(`→ push ${branch} to ${destination.remote}`);
  if (options.pr)
    info(
      `→ ${existingUrl ? "update existing PR" : options.draft ? "create draft PR" : "create PR"}: ${branch} → ${destination.base}`,
    );
  if (options.dryRun) {
    if (existingUrl) out(existingUrl);
    return;
  }
  // Explicit refspec limits branches; --no-follow-tags overrides automatic tag publication.
  const currentUrl = await run(cwd, "git", [
    "remote",
    "get-url",
    "--push",
    "--all",
    destination.remote,
  ]);
  if (currentUrl !== destination.pushUrl)
    throw new Error("push destination changed during the preview; rerun to review it");
  try {
    await run(cwd, "git", [
      "push",
      "--no-follow-tags",
      "--set-upstream",
      destination.remote,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ]);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nLocal commits are preserved. Fix the push failure and rerun with --${options.pr ? "pr" : "push"}.`,
    );
  }
  if (!options.pr) return;
  if (existingUrl) {
    out(existingUrl);
    return;
  }
  if (!pr) throw new Error("missing approved PR text");
  try {
    const url = await run(
      cwd,
      "gh",
      [
        "pr",
        "create",
        "--repo",
        destination.repo!,
        "--base",
        destination.base!,
        "--head",
        branch,
        "--title",
        pr.title,
        "--body-file",
        "-",
        ...(options.draft ? ["--draft"] : []),
      ],
      pr.body,
    );
    out(url);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nThe branch was pushed. Rerun with --pr to retry; local commits are preserved.`,
    );
  }
}

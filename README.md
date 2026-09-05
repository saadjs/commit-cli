# commit-cli

Write clean git commits with the coding-agent CLI you already use.

`commit-cli` collects your changes, asks an agent for a commit message (or a set of
logical commits), shows you the proposal, and commits only after you approve it.
The agent proposes text; `commit-cli` runs every git command.

## Install

```sh
brew install saadjs/tap/commit-cli
```

Or install from source (Node.js 20.19+):

```sh
npm install && npm run build && npm link
```

You also need at least one of `claude`, `codex`, `opencode`, or `pi` on your `PATH`.
Check which providers are available with:

```sh
commit --providers
```

## Quick start

```sh
commit                       # propose one commit
commit --split               # split changes into logical commits
commit -m "fix the race"    # give the agent a hint
commit --dry-run             # preview without committing
commit --push                # commit and push the branch
commit --pr                  # commit, push, and open a GitHub PR
commit -b --pr --draft       # create a branch and open a draft PR
```

After the proposal, choose **y**es, **e**dit, **r**egenerate, or **n**o. Use `-y` to
skip the confirmation.

### Common commands

| Command                       | Action                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `commit`                      | Use staged changes; if nothing is staged, stage tracked changes. |
| `commit -a`                   | Stage tracked changes plus untracked files.                      |
| `commit <paths...>`           | Commit only the named paths, including untracked files.          |
| `commit -x '*.lock'`          | Exclude matching paths; repeatable.                              |
| `commit -b`                   | Ask the agent for a branch name and commit on that new branch.   |
| `commit --branch-name <name>` | Commit on an explicitly named new branch (implies `-b`).         |
| `commit -P codex`             | Use a specific provider.                                         |
| `commit --model <id>`         | Override the provider's model.                                   |
| `commit --no-verify`          | Skip git commit hooks.                                           |
| `commit --config`             | Show resolved settings and their sources.                        |

Paths are git pathspecs, so globs and `:(exclude)` syntax work. Run `commit --help`
for every option.

### Creating a branch

Use `-b` / `--branch` to have the agent propose a branch name alongside the commit
messages. The proposal shows `→ new branch: <name>`; **y** approves both, **n**
aborts without creating a branch, and **r** regenerates both. **e** edits only the
messages and keeps the proposed branch name.

`--branch-name <name>` skips asking the agent for a branch name; the agent still
writes the commit messages. Explicit names are used unchanged and must be valid,
unused Git branch names. Generated names are normalized to lowercase kebab-case,
kept under 50 characters, and given a numeric suffix when needed to avoid existing
local branches. If the agent supplies no usable name, `commit-<timestamp>` is used.

With `--split`, the branch is created once, after approval and all message edits,
before the first commit. `-y` approves automatically. `--dry-run` shows the name
without creating a branch or commit; the usual staging behavior still applies.
If a commit hook fails after branch creation, you remain on the new branch with
your uncommitted changes available.

## Pushing and pull requests

`--push` pushes the current branch after committing. `--pr` includes pushing and
creates a GitHub pull request using your installed, authenticated `gh` CLI. Both
also work when your changes are already committed. Ordinary `commit` stays local.

```sh
commit --push
commit --pr
commit -b --pr
commit --pr --draft
commit --pr --base develop --remote origin
commit --pr --dry-run
```

For a new PR, the selected agent writes a title and description from the **entire
branch diff against the base**, including earlier commits. After committing, you
see the destination and proposed PR text before anything is pushed. Choose
**y**es, **e**dit, **r**egenerate, or **n**o. Editing opens a Markdown file: the first
line is the title and the remaining lines are the description. Markdown headings
are preserved. `-y` approves both committing and publishing automatically.

Descriptions lead with the problem and resulting behavior. A compact flow diff,
file tree, or diagram is included when it helps explain a larger change. The
generator respects a local repository PR template and does not claim tests passed
without evidence. It does not run tests. If several templates exist, add a default
`pull_request_template.md` in `.github/`, the repository root, or `docs/`.

New PRs are ready for review by default; use `--draft` for drafts. If an open PR
already exists for the branch and base, the CLI pushes and prints its URL without
regenerating or replacing its title or description. The PR URL goes to stdout;
progress and previews go to stderr.

The remote defaults to the current branch's configured remote, otherwise
`origin`; override it with `--remote`. Only the current branch is pushed, using
its existing name, and its upstream is set. PRs default to the GitHub repository's
default branch; override with `--base`. The CLI fetches that base before generating
the description. Ambiguous destinations require an explicit choice. This version
supports same-repository PRs; fork destinations and remotes with different fetch
and push repositories are rejected.

Opening a PR from the default branch requires `-b` or `--branch-name` to create a
feature branch. These options also work with already committed changes. PR head
and base must differ. `--draft` and `--base` require `--pr`; `--remote` requires
`--push` or `--pr`.

Canceling the PR preview keeps local commits. If a commit or hook fails, publishing
does not start. If pushing fails, no PR is created. If PR creation fails, the branch
remains pushed. Resolve the failure and rerun `--push` or `--pr` with the same
remote/base options; another commit is not required. Pushes are never forced.

`--dry-run` previews without creating branches, commits, pushes, or PRs. Existing
staging behavior still applies, and PR previews still check GitHub and fetch the
base. Uncommitted changes excluded from the commit are excluded from the PR text.

## What gets committed

| Situation                   | Files committed                              |
| --------------------------- | -------------------------------------------- |
| Something is already staged | Exactly the staged changes, unless excluded. |
| Nothing is staged           | All tracked changes.                         |
| `-a` is used                | Tracked changes and untracked files.         |
| Paths are provided          | Only those paths; they are staged for you.   |
| `-x` is used                | Matching paths are left out.                 |

## Providers

The default provider is `claude`. Override it with `-P` or set `COMMIT_PROVIDER`.
Each provider uses its own CLI and default model:

| Provider   | CLI            | Default model              |
| ---------- | -------------- | -------------------------- |
| `claude`   | `claude -p`    | `haiku`                    |
| `codex`    | `codex exec`   | `gpt-5.6-luna`             |
| `opencode` | `opencode run` | `opencode-go/gpt-5.6-luna` |
| `pi`       | `pi --print`   | `opencode-go/gpt-5.6-luna` |

Override models per run with `--model`, or in your config.

## Configuration

Settings are applied in this order, with later values winning:

1. Built-in defaults
2. Global config: `$XDG_CONFIG_HOME/commit-cli/config.json` (usually
   `~/.config/commit-cli/config.json`)
3. Repository config: `.commitrc.json`
4. `COMMIT_PROVIDER` / `COMMIT_MODEL`
5. Command-line flags

`models` and `exclude` merge between config files; other settings replace earlier
values. Example:

```json
{
  "provider": "claude",
  "models": { "claude": "sonnet" },
  "split": false,
  "exclude": ["*.lock", "dist/"],
  "timeoutMs": 180000,
  "instructions": "Mention the ticket ID when there is one."
}
```

Available keys: `provider`, `models`, `split`, `exclude`, `maxDiffBytes`, `timeoutMs`,
and `instructions`. Invalid keys and values are rejected with an explanation.

## Editing and caveats

- `e` opens `COMMIT_EDITMSG` using `$GIT_EDITOR`, then `$VISUAL`, then `$EDITOR` (or
  `vi`). Saving an empty message or using `:cq` aborts; quitting without changing
  the message accepts it unchanged.
- `--split` re-stages files commit by commit, so it does not preserve hunk-level
  staging. Plain `commit` does.
- Large diffs are truncated at `maxDiffBytes` (200,000 bytes by default); the full
  diffstat is always sent to the agent.

## Development

```sh
npm install
npm run build
npm link
```

Run the build and unit tests with:

```sh
npm test
```

The test suite does not require provider credentials or model calls.

To add a provider, implement `Provider` in `src/providers/` and register it in
`src/providers/index.ts`. The provider returns text; prompting, parsing, staging, and
committing are handled by the core.

<details>
<summary>Release notes</summary>

`homebrew/commit-cli.rb` is the source of truth for the Homebrew formula. A release
tag builds the tarball, attaches it to GitHub, and updates
[`saadjs/homebrew-tap`](https://github.com/saadjs/homebrew-tap).

```sh
npm version patch
git push --follow-tags
```

The workflow requires a `HOMEBREW_TAP_TOKEN` repository secret with write access to
the tap repository.

</details>

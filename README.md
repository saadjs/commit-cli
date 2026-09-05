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
```

After the proposal, choose **y**es, **e**dit, **r**egenerate, or **n**o. Use `-y` to
skip the confirmation.

### Common commands

| Command | Action |
| --- | --- |
| `commit` | Use staged changes; if nothing is staged, stage tracked changes. |
| `commit -a` | Stage tracked changes plus untracked files. |
| `commit <paths...>` | Commit only the named paths, including untracked files. |
| `commit -x '*.lock'` | Exclude matching paths; repeatable. |
| `commit -b` | Ask the agent for a branch name and commit on that new branch. |
| `commit --branch-name <name>` | Commit on an explicitly named new branch (implies `-b`). |
| `commit -P codex` | Use a specific provider. |
| `commit --model <id>` | Override the provider's model. |
| `commit --no-verify` | Skip git commit hooks. |
| `commit --config` | Show resolved settings and their sources. |

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

## What gets committed

| Situation | Files committed |
| --- | --- |
| Something is already staged | Exactly the staged changes, unless excluded. |
| Nothing is staged | All tracked changes. |
| `-a` is used | Tracked changes and untracked files. |
| Paths are provided | Only those paths; they are staged for you. |
| `-x` is used | Matching paths are left out. |

## Providers

The default provider is `claude`. Override it with `-P` or set `COMMIT_PROVIDER`.
Each provider uses its own CLI and default model:

| Provider | CLI | Default model |
| --- | --- | --- |
| `claude` | `claude -p` | `haiku` |
| `codex` | `codex exec` | `gpt-5.6-luna` |
| `opencode` | `opencode run` | `opencode-go/gpt-5.6-luna` |
| `pi` | `pi --print` | `opencode-go/gpt-5.6-luna` |

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

Run the build, unit tests, and terminal interaction tests entirely in Docker
(no local dependency installation required):

```sh
docker build -f Dockerfile.test -t commit-cli-test .
docker run --rm commit-cli-test
```

Tests use temporary Git repositories and real terminal input for approval,
regeneration, and editing. The external agent and editor are deterministic test
programs, so no provider credentials or model calls are needed. With Node.js,
Git, and Python 3 already available, `npm ci && npm test` also runs the suite.

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

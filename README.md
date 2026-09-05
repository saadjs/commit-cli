# commit-cli

Writes and organizes your git commits using a coding-agent CLI you already have installed.

It collects the diff, asks the agent for a commit message (or a split into several
commits), shows you the result, and commits once you approve. The agent only ever
returns text — every git command is run by this tool.

## Install

```sh
brew install saadjs/tap/commit-cli
```

Or from source:

```sh
npm install && npm run build && npm link
```

`commit` drives a coding-agent CLI, so you need at least one of `claude`, `codex`,
`opencode` or `pi` on your PATH. `commit --providers` shows which ones it can see.

## Use

```sh
commit                      # one commit for everything
commit --split              # group the changes into logical commits
commit -m "fixing the race" # steer the message
commit src/auth.ts          # commit just these paths (untracked ones too)
commit -x '*.lock'          # commit everything except these
commit -y                   # skip the confirmation
commit -P codex             # use a different provider
```

At the prompt: `y` commit, `e` open `$EDITOR` on the message, `r` regenerate, `n` abort.

`e` lets you rewrite the message by hand; `r` asks the provider for a new one. In
`--split` mode `e` walks you through each message in turn but keeps the file grouping,
so if the grouping itself is wrong, use `r`.

### In the editor

The buffer is named `COMMIT_EDITMSG`, so vim and emacs give it the usual gitcommit
highlighting. It behaves like `git commit --amend`:

| you do | result |
| --- | --- |
| edit, then `:wq` | commits your message |
| `:q` or `:q!` | commits the message **unchanged** - quitting is not a cancel |
| delete everything, save | aborts; changes stay staged |
| `:cq` | aborts; changes stay staged |

`$GIT_EDITOR` wins over `$VISUAL`, which wins over `$EDITOR`, falling back to `vi`.
Blank values are skipped.

### Which files get committed

| you run | what is committed |
| --- | --- |
| `commit` with something already staged | exactly what is staged |
| `commit` with nothing staged | all tracked changes |
| `commit -a` | tracked changes plus untracked files |
| `commit <paths...>` | only those paths, staged for you — untracked files included |
| `commit -x <paths...>` | the above, minus those paths |

Paths are git pathspecs, so globs and `:(exclude)` syntax work.

## Providers

| name | CLI | default model |
| --- | --- | --- |
| `claude` (default) | `claude -p` | `haiku` |
| `codex` | `codex exec` | `gpt-5.6-luna` |
| `opencode` | `opencode run` | `opencode-go/gpt-5.6-luna` |
| `pi` | `pi --print` | `opencode-go/gpt-5.6-luna` |

Each defaults to a fast, cheap model. Override per run with `--model`, or permanently
in config. `commit --providers` shows which ones are installed.

## Config

Settings are layered, each winning over the one above it:

| # | source | scope |
| --- | --- | --- |
| 1 | built-in defaults | |
| 2 | `~/.config/commit-cli/config.json` | you, everywhere (honours `$XDG_CONFIG_HOME`) |
| 3 | `.commitrc.json` in the repo root | this repo, commit it to share with the team |
| 4 | `COMMIT_PROVIDER` / `COMMIT_MODEL` env vars | one shell |
| 5 | command-line flags | one run |

`models` maps and `exclude` lists merge across layers; everything else is replaced.
So a global `"exclude": ["*.lock"]` still applies in a repo that adds its own.

Run `commit --config` to see every resolved value and which file it came from.

```json
{
  "provider": "claude",
  "models": {
    "claude": "sonnet",
    "opencode": "opencode-go/gpt-5.6-luna"
  },
  "split": false,
  "exclude": ["*.lock", "dist/"],
  "maxDiffBytes": 200000,
  "timeoutMs": 180000,
  "instructions": "Reference the ticket id from the branch name when there is one."
}
```

| key | meaning |
| --- | --- |
| `provider` | default provider: `claude`, `codex`, `opencode` or `pi` |
| `models` | per-provider model override, keyed by provider name |
| `split` | always split into logical commits |
| `exclude` | paths never committed; `-x` adds to this |
| `maxDiffBytes` | diff is truncated past this; the diffstat is always sent |
| `timeoutMs` | how long to wait for the provider |
| `instructions` | extra style guidance appended to the prompt |

Unknown keys, wrong types and unknown provider names are rejected at startup with
the offending file and a suggestion, rather than being silently ignored.

## Adding a provider

Implement `Provider` in `src/providers/` and add it to the list in `src/providers/index.ts`:

```ts
export interface Provider {
  readonly name: string;
  readonly bin: string;
  readonly defaultModel?: string;
  generate(prompt: string, opts: GenerateOptions): Promise<string>;
}
```

`generate` takes a prompt and returns the agent's final text. That is the whole contract —
prompting, JSON parsing, staging and committing all live in the core.

## Releasing

`homebrew/commit-cli.rb` is the source of truth for the formula. Tagging a release
builds the tarball, attaches it to a GitHub release, and pushes the rewritten formula
to [saadjs/homebrew-tap](https://github.com/saadjs/homebrew-tap) as `Formula/commit-cli.rb`.

```sh
npm version patch    # bumps package.json and creates the vX.Y.Z tag
git push --follow-tags
```

The workflow needs a `HOMEBREW_TAP_TOKEN` repository secret: a PAT with write access
to the tap repo (fine-grained, Contents: read and write).

## Notes

- `--split` re-stages files commit by commit, so it discards any partial (hunk-level)
  staging you had set up. Plain `commit` respects it.
- Large diffs are truncated to `maxDiffBytes`; the full diffstat is always sent.

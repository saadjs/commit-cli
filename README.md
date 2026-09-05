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

## Documentation

See the [documentation site](https://saadjs.github.io/commit-cli/) for the complete
flag reference, staging behavior, branches, pull requests, providers, configuration,
and editing details.

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

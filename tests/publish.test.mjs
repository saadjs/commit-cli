import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { githubRepo } from '../dist/publish.js';
import { parsePr, prPrompt } from '../dist/pr.js';

const cli = resolve('dist/cli.js');
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'commit-publish-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'work'), remote = join(dir, 'remote.git'), bin = join(dir, 'bin');
  mkdirSync(cwd); mkdirSync(bin);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CONFIG_HOME: join(dir, 'config'),
    COMMIT_PROVIDER: 'claude', COMMIT_MODEL: '', TEST_DIR: dir, REAL_GIT: realGit, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  function git(...args) {
    const result = spawnSync(realGit, args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  }
  git('init', '--bare', remote); git('init', '-b', 'main');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  writeFileSync(join(cwd, 'file.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
  git('remote', 'add', 'origin', remote); git('push', '-u', 'origin', 'main');
  git('checkout', '-b', 'feature');
  writeFileSync(join(cwd, 'file.txt'), 'base\nfeature\n'); git('commit', '-am', 'feature');
  function script(name, source) { writeFileSync(join(bin, name), `#!${process.execPath}\n${source}`, { mode: 0o755 }); }
  script('git', `
    const { spawnSync } = require('node:child_process');
    const { appendFileSync } = require('node:fs');
    const args = process.argv.slice(2);
    if (process.env.TEST_PR && args[0] === 'remote' && args[1] === 'get-url') {
      console.log('git@github.com:owner/repo.git'); process.exit(0);
    }
    if (args[0] === 'push') {
      appendFileSync(process.env.TEST_DIR + '/pushes', JSON.stringify(args) + '\\n');
      if (process.env.FAIL_PUSH) { console.error('push rejected'); process.exit(1); }
    }
    const result = spawnSync(process.env.REAL_GIT, args, { stdio: 'inherit' }); process.exit(result.status ?? 1);
  `);
  script('gh', `
    const { appendFileSync, writeFileSync } = require('node:fs');
    const args = process.argv.slice(2);
    appendFileSync(process.env.TEST_DIR + '/gh-log', JSON.stringify(args) + '\\n');
    if (args[0] === 'auth') process.exit(process.env.FAIL_AUTH ? 1 : 0);
    if (args[0] === 'repo') console.log(JSON.stringify({ nameWithOwner: 'owner/repo', isFork: !!process.env.FORK, defaultBranchRef: { name: 'main' } }));
    if (args[1] === 'list') console.log(JSON.stringify(process.env.EXISTING ? [{ url: 'https://github.com/owner/repo/pull/1', isCrossRepository: false, baseRefName: 'main' }] : []));
    if (args[1] === 'create') {
      let body = ''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
        writeFileSync(process.env.TEST_DIR + '/body', body);
        if (process.env.FAIL_CREATE) { console.error('create failed'); process.exitCode = 1; }
        else console.log('https://github.com/owner/repo/pull/2');
      });
    }
  `);
  script('claude', `
    const { writeFileSync } = require('node:fs');
    let prompt = ''; process.stdin.on('data', chunk => prompt += chunk); process.stdin.on('end', () => {
      writeFileSync(process.env.TEST_DIR + '/prompt', prompt);
      const text = prompt.includes('Write a pull request title')
        ? JSON.stringify({ title: 'Add feature', body: 'Outcome.\\n\\n### Workflow\\nNew flow.\\n\\n### Validation\\nNot run.' })
        : JSON.stringify({ branch: 'new-feature', commits: [{ subject: 'feat: change', files: ['file.txt'] }] });
      console.log(text);
    });
  `);
  function run(args, extra = {}) { return spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...env, ...extra }, encoding: 'utf8' }); }
  return { dir, cwd, remote, git, run };
}

test('GitHub URL parsing and PR text validation', () => {
  for (const url of ['git@github.com:owner/repo.git', 'https://github.com/owner/repo.git', 'ssh://git@github.com/owner/repo.git']) {
    assert.equal(githubRepo(url), 'github.com/owner/repo');
  }
  assert.throws(() => githubRepo('/tmp/remote.git'));
  assert.throws(() => parsePr('{"title":"bad\\ntitle","body":"body"}'));
  assert.throws(() => parsePr('{"title":"title","body":""}'));
  assert.equal(parsePr('```json\n{"title":"title","body":"### Heading"}\n```').body, '### Heading');
});

test('clean branch pushes only itself and sets upstream', t => {
  const f = fixture(t);
  const result = f.run(['--push', '-y']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('rev-parse', 'feature@{upstream}'), f.git('rev-parse', 'HEAD'));
  assert.match(readFileSync(join(f.dir, 'pushes'), 'utf8'), /refs\/heads\/feature:refs\/heads\/feature/);
});

for (const flag of ['--push', '--pr']) test(`${flag} does not publish tags when push.followTags is enabled`, t => {
  const f = fixture(t);
  f.git('config', 'push.followTags', 'true');
  f.git('tag', '-a', 'unreviewed-release', '-m', 'Local release tag');
  const result = f.run([flag, '-y'], flag === '--pr' ? { TEST_PR: '1' } : {});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('--git-dir', f.remote, 'rev-parse', 'refs/heads/feature'), f.git('rev-parse', 'HEAD'));
  assert.equal(f.git('--git-dir', f.remote, 'tag', '--list'), '');
  assert.equal(f.git('tag', '--list'), 'unreviewed-release');
});

test('new commits are created before pushing and PR creation', t => {
  const f = fixture(t); writeFileSync(join(f.cwd, 'file.txt'), 'base\nfeature\nmore\n');
  const before = f.git('rev-parse', 'HEAD');
  const result = f.run(['--pr', '--draft', '-y'], { TEST_PR: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(f.git('rev-parse', 'HEAD'), before);
  assert.match(result.stdout, /pull\/2/);
  assert.match(readFileSync(join(f.dir, 'body'), 'utf8'), /### Workflow/);
  const logs = readFileSync(join(f.dir, 'gh-log'), 'utf8');
  assert.match(logs, /--draft/); assert.match(logs, /--body-file/); assert.match(logs, /--head/);
});

test('existing PR pushes without generating or changing its description', t => {
  const f = fixture(t);
  const result = f.run(['--pr', '-y'], { TEST_PR: '1', EXISTING: '1' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /pull\/1/);
  assert.equal(existsSync(join(f.dir, 'prompt')), false);
  assert.equal(existsSync(join(f.dir, 'body')), false);
});

test('dry run previews pending changes without creating branch, commit, push, or PR', t => {
  const f = fixture(t); writeFileSync(join(f.cwd, 'file.txt'), 'pending unique change\n');
  const before = f.git('rev-parse', 'HEAD');
  const result = f.run(['--pr', '-b', '--dry-run'], { TEST_PR: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('rev-parse', 'HEAD'), before); assert.equal(f.git('branch', '--show-current'), 'feature');
  assert.equal(existsSync(join(f.dir, 'pushes')), false); assert.equal(existsSync(join(f.dir, 'body')), false);
  assert.match(readFileSync(join(f.dir, 'prompt'), 'utf8'), /pending unique change/);
});

test('failed push preserves commits and prevents PR creation', t => {
  const f = fixture(t); const before = f.git('rev-parse', 'HEAD');
  const result = f.run(['--pr', '-y'], { TEST_PR: '1', FAIL_PUSH: '1' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Local commits are preserved/);
  assert.equal(f.git('rev-parse', 'HEAD'), before); assert.equal(existsSync(join(f.dir, 'body')), false);
});

test('PR creation failure preserves pushed branch and retry needs no new commit', t => {
  const f = fixture(t); const before = f.git('rev-parse', 'HEAD');
  const failed = f.run(['--pr', '-y'], { TEST_PR: '1', FAIL_CREATE: '1' });
  assert.equal(failed.status, 1); assert.match(failed.stderr, /branch was pushed/);
  assert.equal(f.git('rev-parse', 'feature@{upstream}'), before);
  const retry = f.run(['--pr', '-y'], { TEST_PR: '1' });
  assert.equal(retry.status, 0, retry.stderr); assert.equal(f.git('rev-parse', 'HEAD'), before);
});

for (const [name, extra, pattern] of [
  ['fork', { FORK: '1' }, /fork destinations/], ['authentication', { FAIL_AUTH: '1' }, /auth status/],
]) test(`${name} failure happens before committing`, t => {
  const f = fixture(t); const before = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.cwd, 'file.txt'), 'uncommitted\n');
  const result = f.run(['--pr', '-y'], { TEST_PR: '1', ...extra });
  assert.equal(result.status, 1); assert.match(result.stderr, pattern);
  assert.equal(f.git('rev-parse', 'HEAD'), before); assert.equal(f.git('diff', '--cached'), '');
});

test('default branch PR is rejected before staging', t => {
  const f = fixture(t); f.git('checkout', 'main'); writeFileSync(join(f.cwd, 'file.txt'), 'pending\n');
  const result = f.run(['--pr', '-y'], { TEST_PR: '1' });
  assert.equal(result.status, 1); assert.match(result.stderr, /feature branch/); assert.equal(f.git('diff', '--cached'), '');
});

test('PR prompt includes full committed branch and template, excludes worktree edits', async t => {
  const f = fixture(t); mkdirSync(join(f.cwd, '.github'));
  writeFileSync(join(f.cwd, '.github', 'pull_request_template.md'), '## Required section\n');
  writeFileSync(join(f.cwd, 'file.txt'), 'WORKTREE_ONLY\n');
  const prompt = await prPrompt(f.cwd, { baseSha: f.git('rev-parse', 'main'), base: 'main' }, 'feature', 200000, false);
  assert.match(prompt, /\+feature/); assert.match(prompt, /## Required section/); assert.doesNotMatch(prompt, /WORKTREE_ONLY/);
});

test('already committed changes can be published on an explicitly named new branch', t => {
  const f = fixture(t); const before = f.git('rev-parse', 'HEAD');
  const result = f.run(['--pr', '--branch-name', 'review-feature', '-y'], { TEST_PR: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('branch', '--show-current'), 'review-feature');
  assert.equal(f.git('rev-parse', 'HEAD'), before);
  assert.equal(f.git('rev-parse', 'review-feature@{upstream}'), before);
});

test('failed commit hook stops publishing and leaves staged work on new branch', t => {
  const f = fixture(t); const before = f.git('rev-parse', 'HEAD');
  writeFileSync(join(f.cwd, 'file.txt'), 'pending\n');
  writeFileSync(join(f.cwd, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = f.run(['--pr', '--split', '--branch-name', 'hook-branch', '-y'], { TEST_PR: '1' });
  assert.equal(result.status, 1); assert.equal(f.git('rev-parse', 'HEAD'), before);
  assert.equal(f.git('branch', '--show-current'), 'hook-branch');
  assert.notEqual(f.git('diff', '--cached'), ''); assert.equal(existsSync(join(f.dir, 'pushes')), false);
});

test('explicit remote is used when origin is absent', t => {
  const f = fixture(t); f.git('remote', 'rename', 'origin', 'publish');
  const result = f.run(['--push', '--remote', 'publish', '-y']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('config', 'branch.feature.remote'), 'publish');
});

test('invalid flag combinations and ambiguous remotes stop before staging', t => {
  const f = fixture(t); writeFileSync(join(f.cwd, 'file.txt'), 'pending\n');
  for (const args of [['--draft'], ['--base', 'main'], ['--remote', 'origin'], ['--push', '--remote', 'absent']]) {
    const result = f.run([...args, '-y']); assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(f.git('diff', '--cached'), '');
  }
  f.git('config', '--add', 'remote.origin.pushurl', f.remote);
  f.git('config', '--add', 'remote.origin.pushurl', f.remote + '-other');
  const result = f.run(['--push', '-y']); assert.equal(result.status, 1); assert.match(result.stderr, /multiple push URLs/);
});

test('PR editor preserves Markdown headings and editor failure cancels', t => {
  const f = fixture(t);
  const editor = join(f.dir, 'editor.cjs');
  writeFileSync(editor, `require('node:fs').writeFileSync(process.argv[2], 'New title\\n\\n## Summary\\nBody\\n');`);
  const module = resolve('dist/editor.js');
  const source = `import { editMessage } from ${JSON.stringify(module)}; console.log(JSON.stringify(await editMessage('Title\\n\\n## Original', '', true)));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, GIT_EDITOR: `${process.execPath} ${editor}` }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr); assert.match(JSON.parse(result.stdout), /## Summary/);
  writeFileSync(editor, 'process.exit(1);');
  const canceled = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, GIT_EDITOR: `${process.execPath} ${editor}` }, encoding: 'utf8',
  });
  assert.equal(canceled.stdout.trim(), 'null');
});

test('default PR template takes precedence over multiple optional templates', async t => {
  const f = fixture(t); mkdirSync(join(f.cwd, '.github/PULL_REQUEST_TEMPLATE'), { recursive: true });
  for (const name of ['bug.md', 'feature.md']) writeFileSync(join(f.cwd, '.github/PULL_REQUEST_TEMPLATE', name), name);
  const destination = { baseSha: f.git('rev-parse', 'main'), base: 'main' };
  await assert.rejects(prPrompt(f.cwd, destination, 'feature', 200000, false), /multiple PR templates/);
  writeFileSync(join(f.cwd, 'pull_request_template.md'), '## Default template');
  const prompt = await prPrompt(f.cwd, destination, 'feature', 200000, false);
  assert.match(prompt, /## Default template/);
});

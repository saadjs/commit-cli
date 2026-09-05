import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseResponse } from "../dist/parse.js";
import { providerFailure } from "../dist/providers/error.js";

test("response validation preserves optional field fallbacks and rejects invalid subjects", () => {
  assert.deepEqual(
    parseResponse(
      JSON.stringify({
        commits: [
          { subject: " fix ", body: " details ", files: ["a", 1, null, "b"] },
          { subject: "next", body: false, files: "bad" },
        ],
        branch: 12,
      }),
    ),
    {
      commits: [
        { subject: "fix", body: "details", files: ["a", "b"] },
        { subject: "next", body: undefined, files: undefined },
      ],
      branch: undefined,
    },
  );
  for (const entry of [null, 1, "subject", {}, { subject: false }, { subject: " " }]) {
    assert.throws(
      () => parseResponse(JSON.stringify({ commits: [entry] })),
      /commit 1 is missing a subject/,
    );
  }
});

test("provider failures strip terminal colors before deduplicating messages", () => {
  const error = providerFailure("test", "\u001b[31mfailed\u001b[0m\nfailed", 1);
  assert.equal(error.message, "test: failed");
});

test("config schemas preserve merging and reject malformed configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "commit-validation-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  try {
    const { loadConfig } = await import("../dist/config.js");
    const repo = join(root, "repo");
    await mkdir(repo);
    await mkdir(join(root, "commit-cli"));
    const globalPath = join(root, "commit-cli", "config.json");
    const repoPath = join(repo, ".commitrc.json");
    assert.deepEqual((await loadConfig(repo)).config, {});
    await writeFile(
      globalPath,
      JSON.stringify({
        models: { claude: "sonnet" },
        exclude: ["*.lock"],
        split: true,
        timeoutMs: 100,
      }),
    );
    await writeFile(
      repoPath,
      JSON.stringify({
        models: { claude: "opus" },
        exclude: ["*.lock", "generated"],
        split: false,
      }),
    );
    const loaded = await loadConfig(repo);
    assert.deepEqual(loaded.config, {
      models: { claude: "opus" },
      exclude: ["*.lock", "generated"],
      split: false,
      timeoutMs: 100,
    });
    assert.equal(loaded.sources.split, repoPath);
    assert.equal(loaded.sources.timeoutMs, globalPath);
    /** @type {[string, RegExp][]} */
    const invalidConfigs = [
      ["{", /invalid JSON/],
      ["null", /expected a JSON object/],
      ["[]", /expected a JSON object/],
      ['{"splti":true}', /Did you mean "split"/],
      ['{"split":"true"}', /"split" must be true or false/],
      ['{"exclude":[1]}', /"exclude" must be an array/],
      ['{"models":{"claude":1}}', /"models" must be an object/],
      ['{"timeoutMs":0}', /"timeoutMs" must be a positive number/],
      ['{"maxDiffBytes":1e999}', /"maxDiffBytes" must be a positive number/],
      ['{"provider":"missing"}', /unknown provider/],
      ['{"models":{"missing":"model"}}', /unknown provider/],
    ];
    for (const [text, message] of invalidConfigs) {
      await writeFile(repoPath, text);
      await assert.rejects(loadConfig(repo), message);
    }
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

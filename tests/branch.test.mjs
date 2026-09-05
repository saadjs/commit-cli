import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeBranchName, uniqueBranchName } from "../dist/branch.js";
import { parseResponse, parseCommits } from "../dist/parse.js";
import { buildPrompt } from "../dist/prompt.js";

test("generated names are normalized, bounded, and have a usable fallback", () => {
  assert.equal(sanitizeBranchName(" Feature/HELLO__World.. "), "feature-hello-world");
  assert.equal(sanitizeBranchName("A".repeat(80)), "a".repeat(49));
  for (const value of [undefined, "", "💥", "---"])
    assert.match(sanitizeBranchName(value), /^commit-\d+$/);
});
test("collisions include branch directories and keep suffixes within length limit", () => {
  assert.equal(uniqueBranchName("fix", ["fix", "fix-2", "fix-3/topic"]), "fix-4");
  const name = "a".repeat(49);
  assert.equal(uniqueBranchName(name, [name]), "a".repeat(47) + "-2");
});
test("response parsing preserves agent branch and tolerates missing/malformed branch fields", () => {
  for (const [branch, expected] of [
    ["agent-chosen", "agent-chosen"],
    [undefined, undefined],
    [123, undefined],
    [null, undefined],
    [{}, undefined],
  ]) {
    const response = JSON.stringify({
      branch,
      commits: [{ subject: " feat: something ", body: "why" }],
    });
    assert.equal(parseResponse("```json\n" + response + "\n```").branch, expected);
    assert.deepEqual(parseResponse(response).commits, parseCommits(response));
  }
  for (const raw of ["", "{}", '{"commits":[null]}', '{"commits":[{"subject":""}]}'])
    assert.throws(() => parseResponse(raw));
});
test("branch schema and naming instruction are requested only when needed in either mode", () => {
  for (const split of [false, true])
    for (const wantBranch of [false, true]) {
      const prompt = buildPrompt({
        branch: "main",
        files: [],
        stat: "",
        diff: "",
        truncated: false,
        recentSubjects: [],
        split,
        wantBranch,
      });
      const schemaText = prompt.split("Output schema:\n")[1]?.split("\n\n")[0];
      assert.ok(schemaText);
      const schema = JSON.parse(schemaText);
      assert.equal("branch" in schema, wantBranch);
      assert.equal(prompt.includes("lowercase kebab-case"), wantBranch);
      assert.equal("files" in schema.commits[0], split);
    }
});

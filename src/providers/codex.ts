import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "../exec.js";
import { providerFailure } from "./error.js";
import type { Provider } from "./types.js";

export const codex: Provider = {
  name: "codex",
  bin: "codex",
  defaultModel: "gpt-5.6-luna",

  async generate(prompt, { model, cwd, timeoutMs }) {
    // codex streams its log to stdout, so collect the answer from a file instead.
    const outFile = join(tmpdir(), `commit-cli-codex-${randomUUID()}.txt`);
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "-c",
      'model_reasoning_effort="low"',
      "--output-last-message",
      outFile,
    ];
    if (model) args.push("--model", model);

    try {
      const result = await exec(this.bin, args, { cwd, input: prompt, timeoutMs });
      const message = await readFile(outFile, "utf8").catch(() => "");
      if (result.code !== 0 && !message.trim()) {
        throw providerFailure(this.name, result.stderr, result.code, { prefer: /^ERROR/, maxLines: 3 });
      }
      return message.trim();
    } finally {
      await rm(outFile, { force: true });
    }
  },
};

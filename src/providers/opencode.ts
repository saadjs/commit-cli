import { exec } from "../exec.js";
import { providerFailure } from "./error.js";
import type { Provider } from "./types.js";

export const opencode: Provider = {
  name: "opencode",
  bin: "opencode",
  defaultModel: "opencode-go/gpt-5.6-luna",

  async generate(prompt, { model, cwd, timeoutMs }) {
    // Prompt goes over stdin: a large diff as one argv entry exceeds Linux's 128KiB per-argument limit.
    const args = ["run"];
    if (model) args.push("--model", model);

    const result = await exec(this.bin, args, { cwd, input: prompt, timeoutMs });
    if (result.code !== 0) {
      // Drop the "> agent · model" banner opencode prints before any error.
      throw providerFailure(this.name, result.stderr || result.stdout, result.code, { drop: /^>\s/, maxLines: 4 });
    }
    return result.stdout.trim();
  },
};

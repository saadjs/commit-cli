import { exec } from "../exec.js";
import { providerFailure } from "./error.js";
import type { Provider } from "./types.js";

export const claude: Provider = {
  name: "claude",
  bin: "claude",
  defaultModel: "haiku",

  async generate(prompt, { model, cwd, timeoutMs }) {
    const args = ["-p", "--output-format", "text"];
    if (model) args.push("--model", model);

    const result = await exec(this.bin, args, { cwd, input: prompt, timeoutMs });
    if (result.code !== 0) {
      // In print mode claude reports the real problem on stdout; stderr is mostly warnings.
      throw providerFailure(this.name, result.stdout.trim() || result.stderr, result.code, {
        drop: /^Warning:/,
        maxLines: 4,
      });
    }
    return result.stdout.trim();
  },
};

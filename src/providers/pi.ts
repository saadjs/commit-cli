import { exec } from "../exec.js";
import { providerFailure } from "./error.js";
import type { Provider } from "./types.js";

export const pi: Provider = {
  name: "pi",
  bin: "pi",
  defaultModel: "opencode-go/gpt-5.6-luna",

  async generate(prompt, { model, cwd, timeoutMs }) {
    const args = ["--print", "--no-tools", "--no-session", "--no-context-files"];
    if (model) args.push("--model", model);

    const result = await exec(this.bin, args, { cwd, input: prompt, timeoutMs });
    if (result.code !== 0) {
      throw providerFailure(this.name, result.stderr || result.stdout, result.code, { maxLines: 4 });
    }
    return result.stdout.trim();
  },
};

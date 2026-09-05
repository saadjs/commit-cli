import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface ExecOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // Own process group so a timeout can take down the CLI's children (agent CLIs spawn plenty).
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const killTree = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    let killer: NodeJS.Timeout | undefined;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree("SIGTERM");
          killer = setTimeout(() => killTree("SIGKILL"), 2_000);
        }, opts.timeoutMs)
      : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(killer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
  });
}

/** Windows resolves `claude` to `claude.cmd` via PATHEXT; elsewhere the bare name must be executable. */
export function which(bin: string): string | null {
  const exts = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

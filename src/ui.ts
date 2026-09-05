import { createInterface } from "node:readline/promises";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const color = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  cyan: wrap("36"),
};

/** Progress, prompts and diagnostics: stderr. */
export function info(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Output the user asked for (help, version, provider list): stdout. */
export function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${color.yellow("!")} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${color.red("x")} ${message}\n`);
}

/** Single-line spinner on stderr; returns a stop function. */
export function spinner(label: string): () => void {
  if (!process.stderr.isTTY) {
    info(color.dim(label));
    return () => {};
  }
  const frames = ["|", "/", "-", "\\"];
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${color.cyan(frames[i++ % frames.length]!)} ${label}`);
  }, 100);
  return () => {
    clearInterval(timer);
    process.stderr.write("\r\x1b[2K");
  };
}

export async function ask(question: string, valid: string[]): Promise<string> {
  // readline's question() never settles once stdin hits EOF, so refuse up front rather than hang.
  if (!process.stdin.isTTY)
    throw new Error("stdin is not a terminal; use -y to skip the prompt or --dry-run to preview");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (;;) {
      const answer = (await rl.question(question)).trim().toLowerCase();
      if (valid.includes(answer)) return answer;
      if (answer === "" && valid[0]) return valid[0];
    }
  } finally {
    rl.close();
  }
}

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

/** Opens $EDITOR on the message, git-style. Returns null if the author emptied it. */
export async function editMessage(message: string, note: string): Promise<string | null> {
  const editor = process.env.GIT_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR ?? "vi";
  const file = join(tmpdir(), `commit-cli-${randomUUID()}.txt`);
  const header = ["", "# Edit the commit message above. Lines starting with # are ignored.", `# ${note}`, ""].join("\n");

  await writeFile(file, `${message.trim()}\n${header}`, "utf8");
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(editor, [file], { stdio: "inherit", shell: true });
      child.on("error", reject);
      child.on("close", (c) => resolve(c ?? 1));
    });
    if (code !== 0) throw new Error(`editor "${editor}" exited with code ${code}`);

    const edited = stripComments(await readFile(file, "utf8"));
    return edited || null;
  } finally {
    await rm(file, { force: true });
  }
}

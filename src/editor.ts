import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

/** Opens $EDITOR on the message, git-style. Returns null when the author aborted. */
export async function editMessage(message: string, note: string): Promise<string | null> {
  // Blank env vars are treated as unset, the way git does it.
  const editor = [process.env.GIT_EDITOR, process.env.VISUAL, process.env.EDITOR].find((e) => e?.trim()) ?? "vi";
  const dir = await mkdtemp(join(tmpdir(), "commit-cli-"));
  // The COMMIT_EDITMSG name is what makes vim and emacs apply gitcommit highlighting.
  const file = join(dir, "COMMIT_EDITMSG");

  const header = [
    "",
    "# Please enter the commit message for your changes.",
    "# Lines starting with '#' are ignored; an empty message aborts the commit.",
    `# ${note}`,
    "",
  ].join("\n");

  await writeFile(file, `${message.trim()}\n${header}`, "utf8");
  try {
    const code = await new Promise<number>((resolve, reject) => {
      // One shell string, so editors that carry their own flags ("code --wait") still work.
      const child = spawn(`${editor} "${file}"`, { stdio: "inherit", shell: true });
      child.on("error", reject);
      child.on("close", (c) => resolve(c ?? 1));
    });

    if (code !== 0) return null;
    return stripComments(await readFile(file, "utf8")) || null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

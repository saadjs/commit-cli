import type { FileChange } from "./git.js";

export interface PromptInput {
  branch: string;
  files: FileChange[];
  stat: string;
  diff: string;
  truncated: boolean;
  recentSubjects: string[];
  split: boolean;
  wantBranch?: boolean;
  hint?: string;
  instructions?: string;
}

const SCHEMA_SINGLE = `{"commits":[{"subject":"<one line>","body":"<optional, may contain \\n>"}]}`;
const SCHEMA_SPLIT = `{"commits":[{"subject":"<one line>","body":"<optional>","files":["<path>","..."]}]}`;

const RULES = [
  "Follow Conventional Commits: type(optional scope): summary. Types: feat, fix, refactor, perf, docs, test, build, ci, chore, style.",
  "Subject: imperative mood, lower case after the type, no trailing period, 72 characters or fewer.",
  "Body: explain why the change was made and anything non-obvious. Wrap at 72 characters. Omit the body entirely for small, self-evident changes.",
  "Describe only what the diff shows. Never invent issue numbers, co-authors, or trailers.",
];

export function buildPrompt(input: PromptInput): string {
  const sections: string[] = [];

  sections.push(
    input.split
      ? "You are a git expert. Split the staged changes below into the smallest set of coherent commits and write a message for each. Respond with JSON only - no prose, no markdown fences."
      : "You are a git expert. Write one commit message for the staged changes below. Respond with JSON only - no prose, no markdown fences.",
  );

  const schema = input.split ? SCHEMA_SPLIT : SCHEMA_SINGLE;
  sections.push(`Output schema:\n${input.wantBranch ? schema.replace("{", '{"branch":"<new branch name>",') : schema}`);

  const rules = [...RULES];
  if (input.wantBranch) {
    rules.push("Propose a new branch name in the top-level `branch` field, describing the overall changes. Use lowercase kebab-case, under 50 characters. Only propose text; do not run git commands.");
  }
  if (input.split) {
    rules.push(
      "Group by intent, not by directory. Every changed file must appear in exactly one commit's `files` array, using the exact paths listed below.",
      "Order commits so the history reads logically; prefer one commit when the changes are a single unit of work.",
    );
  }
  if (input.instructions) rules.push(input.instructions);
  sections.push(`Rules:\n${rules.map((r) => `- ${r}`).join("\n")}`);

  if (input.recentSubjects.length) {
    sections.push(
      `Recent commit subjects in this repo (match their style):\n${input.recentSubjects.map((s) => `- ${s}`).join("\n")}`,
    );
  }

  if (input.hint) sections.push(`The author says this change is about:\n${input.hint}`);

  sections.push(`Branch: ${input.branch}`);
  sections.push(`Changed files:\n${input.files.map((f) => `${f.status}\t${f.path}`).join("\n")}`);
  sections.push(`Diffstat:\n${input.stat.trim()}`);
  sections.push(
    input.truncated ? `Diff (truncated - rely on the diffstat for the rest):\n${input.diff}` : `Diff:\n${input.diff}`,
  );

  return sections.join("\n\n");
}

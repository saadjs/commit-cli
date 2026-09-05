import { z } from "zod";

export interface ProposedCommit {
  subject: string;
  body?: string;
  files?: string[];
}

/** Pull the first balanced JSON object out of a model response that may include prose or fences. */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced?.[1] ?? raw;

  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in response");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("unterminated JSON object in response");
}

export interface Proposal {
  commits: ProposedCommit[];
  branch?: string;
}

const optionalText = z.string().optional().catch(undefined);
const commitSchema = z.object({
  subject: z.string().trim().min(1),
  body: optionalText.transform((body) => body?.trim() || undefined),
  files: z
    .array(optionalText)
    .transform((files) => files.filter((file) => file !== undefined))
    .optional()
    .catch(undefined),
});
const responseSchema = z.compile(
  z.object({
    commits: z.array(commitSchema).min(1),
    branch: optionalText,
  }),
);

export function parseResponse(raw: string): Proposal {
  if (!raw.trim()) throw new Error("provider returned an empty response");
  const result = responseSchema.safeParse(JSON.parse(extractJson(raw)));
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const index = z.number().safeParse(issue.path[1]);
    if (index.success) throw new Error(`commit ${index.data + 1} is missing a subject`);
    throw new Error('response is missing a non-empty "commits" array');
  }
  return {
    commits: result.data.commits.map((commit) => ({
      subject: commit.subject,
      body: commit.body,
      files: commit.files,
    })),
    branch: result.data.branch,
  };
}

export function parseCommits(raw: string): ProposedCommit[] {
  return parseResponse(raw).commits;
}

export function formatMessage(commit: ProposedCommit): string {
  return commit.body ? `${commit.subject}\n\n${commit.body}\n` : `${commit.subject}\n`;
}

export interface ProposedCommit {
  subject: string;
  body?: string;
  files?: string[];
}

/** Pull the first balanced JSON object out of a model response that may include prose or fences. */
function extractJson(raw: string): string {
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

export function parseResponse(raw: string): Proposal {
  if (!raw.trim()) throw new Error("provider returned an empty response");

  const parsed = JSON.parse(extractJson(raw)) as { commits?: unknown; branch?: unknown };
  if (!Array.isArray(parsed.commits) || parsed.commits.length === 0) {
    throw new Error('response is missing a non-empty "commits" array');
  }

  const commits = parsed.commits.map((entry, i) => {
    const commit = (entry ?? {}) as Partial<ProposedCommit>;
    if (typeof commit.subject !== "string" || !commit.subject.trim()) {
      throw new Error(`commit ${i + 1} is missing a subject`);
    }
    return {
      subject: commit.subject.trim(),
      body: typeof commit.body === "string" && commit.body.trim() ? commit.body.trim() : undefined,
      files: Array.isArray(commit.files) ? commit.files.filter((f): f is string => typeof f === "string") : undefined,
    };
  });
  return { commits, branch: typeof parsed.branch === "string" ? parsed.branch : undefined };
}

export function parseCommits(raw: string): ProposedCommit[] {
  return parseResponse(raw).commits;
}

export function formatMessage(commit: ProposedCommit): string {
  return commit.body ? `${commit.subject}\n\n${commit.body}\n` : `${commit.subject}\n`;
}

/** Normalize agent text only; explicit names are validated by Git without rewriting. */
export function sanitizeBranchName(value: string | undefined): string {
  const name = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 49)
    .replace(/^-+|-+$/g, "");
  return name || `commit-${Date.now()}`;
}

/** Git refs cannot be both a branch and a directory containing other branches. */
export function branchNameTaken(name: string, branches: string[]): boolean {
  return branches.some(
    (branch) => branch === name || branch.startsWith(`${name}/`) || name.startsWith(`${branch}/`),
  );
}

export function uniqueBranchName(name: string, branches: string[]): string {
  let candidate = name;
  for (let suffix = 2; branchNameTaken(candidate, branches); suffix++) {
    const ending = `-${suffix}`;
    candidate = `${name.slice(0, 49 - ending.length).replace(/-+$/, "")}${ending}`;
  }
  return candidate;
}

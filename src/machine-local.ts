// Machine-local paths — files that can never resolve from a fresh checkout
// (a worktree has no .env.local by design), so lint must not existence-check
// them (results would depend on whose machine ran it), the corpus walk must
// not index them, and the server's /raw/ route must never serve them. Two of
// those three are security boundaries, not conveniences.

// PREFIX matches, not an enumeration of spellings. `.env*` covers `.envrc`,
// `.env-prod` and `.env.local` alike — an earlier version listed
// `.env` and `.env.` and would have served `.envrc` at /raw/. Match the
// family, never the spellings.
//
// This is the NON-REMOVABLE floor. docs-wiki.config.json `machineLocal` can
// only ADD patterns on top of it (repo-specific generated files, credential
// stores, …); no configuration subtracts from this list. That asymmetry is
// the point: a config file must never be able to widen what /raw/ serves.
export const MACHINE_LOCAL_FLOOR: readonly RegExp[] = [
  /(^|\/)\.env/,
  /(^|\/)\.dev\.vars/,
  /^\.claude\/worktrees(\/|$)/,
  /^tmp(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.DS_Store$/,
  /\.log$/,
];

/** `patterns` is the resolved config's merged list (floor + extras); callers
 *  thread it from WikiConfig so every consumer applies the same set. */
export function isMachineLocal(
  path: string,
  patterns: readonly RegExp[],
): boolean {
  return patterns.some((re) => re.test(path));
}

// THE resolver — every explicit link and wikilink goes through this one
// function so the CLI, lint, and server can never disagree. Resolution
// order: relative to the source file (GitHub semantics) → repo-root
// relative → unique basename. Ambiguity is an ERROR, never a silent pick:
// in a machine-maintained corpus a wrong-but-quiet resolution is worse
// than a loud one (Obsidian's folder-priority fallback is the anti-pattern
// here, and most repos have several README.md files).

import type { PageId } from "./types.ts";

export interface ResolverContext {
  pages: Set<PageId>;
  /** Lowercased basename (with .md) → page ids sharing it. */
  basenameIndex: Map<string, PageId[]>;
}

export type Resolution =
  | { ok: true; id: PageId }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "ambiguous"; candidates: PageId[] };

/** POSIX-normalize without touching the filesystem: resolve "." and "..". */
export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return ""; // escapes the repo root — never valid
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function dirname(id: PageId): string {
  const i = id.lastIndexOf("/");
  return i === -1 ? "" : id.slice(0, i);
}

function withMd(p: string): string {
  return p.toLowerCase().endsWith(".md") ? p : `${p}.md`;
}

export function resolveTarget(
  rawTarget: string,
  from: PageId,
  ctx: ResolverContext,
): Resolution {
  const decoded = safeDecode(rawTarget.trim());
  if (decoded === "") return { ok: false, reason: "not-found" };

  // Leading slash = repo-root path by convention.
  const rootForm = decoded.startsWith("/") ? decoded.slice(1) : decoded;

  const candidates: string[] = [];
  if (!decoded.startsWith("/")) {
    candidates.push(normalizePath(`${dirname(from)}/${decoded}`)); // GitHub-relative first
  }
  candidates.push(normalizePath(rootForm));

  for (const candidate of candidates) {
    if (candidate === "") continue;
    if (ctx.pages.has(withMd(candidate)))
      return { ok: true, id: withMd(candidate) };
    if (ctx.pages.has(candidate)) return { ok: true, id: candidate };
  }

  // Basename lookup — only for targets with no path separator (wikilink style).
  if (!decoded.includes("/")) {
    const matches = ctx.basenameIndex.get(withMd(decoded).toLowerCase()) ?? [];
    if (matches.length === 1) return { ok: true, id: matches[0] };
    if (matches.length > 1)
      return { ok: false, reason: "ambiguous", candidates: [...matches] };
  }

  return { ok: false, reason: "not-found" };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

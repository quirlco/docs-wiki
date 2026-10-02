// Shared data model for the docs wiki. One index shape serves the
// CLI, the lint gate, and the localhost server — they must never disagree
// about what a link is.

import type { WikiConfig } from "./config.ts";

/** Repo-relative POSIX path of a markdown page, e.g. "docs/security.md". */
export type PageId = string;

export interface Heading {
  depth: number;
  text: string;
  /** GitHub-parity anchor slug — valid on GitHub and in the wiki UI alike. */
  slug: string;
  /** 1-based line number in the source file. */
  line: number;
}

/**
 * Pages under a configured `reportOnlyPaths` prefix are report-only — the
 * high-churn, partly historical corners a host repo names (for example a
 * tasks/** tree) whose findings must never fail anyone's PR. Everything
 * else is enforced; the default config enforces everything.
 */
export type Scope = "enforced" | "report-only";

export type EdgeType =
  /** Explicit `[text](path.md)` markdown link. */
  | "link"
  /** Explicit `[[target]]` wikilink. */
  | "wikilink"
  /** Recognized `ADR-NNNN` identifier. */
  | "mention-adr"
  /** Recognized `B<n>` blocker identifier. */
  | "mention-blocker"
  /** Bare or backticked repo file path in prose. */
  | "mention-path"
  /** A concept page's registered alias appearing in prose. */
  | "mention-alias";

export type TargetKind = "page" | "source-file";

export interface Edge {
  from: PageId;
  /** Resolved target; null = unresolved (red link or dead mention). */
  to: PageId | null;
  type: EdgeType;
  /** The exact source text that produced this edge. */
  raw: string;
  /** 1-based line number in `from` — the FIRST occurrence. */
  line: number;
  /** How many times this reference occurs in `from` (repeats are folded
   *  into one edge; the count is what says how heavily the page leans on
   *  the target). Always ≥ 1. */
  count: number;
  /** Heading slug on the target, when the source specified one. */
  anchor?: string;
  /**
   * "page" edges participate in backlinks; "source-file" edges (paths to
   * .ts/.json/… files) are existence-checked but grow no backlinks.
   */
  targetKind: TargetKind;
  /** Why `to` is null, when it is. */
  unresolved?: "not-found" | "ambiguous";
  /** The competing pages, for ambiguous resolutions. */
  candidates?: PageId[];
}

/**
 * Where a tag came from. Provenance is shown in the UI because the three
 * kinds carry different authority: `derived` is a fact about the file,
 * `declared` is an author's choice, `inherited` is an inference from the
 * mention graph and is the only one that can be wrong.
 */
export type TagSource = "derived" | "declared" | "inherited";

export interface Tag {
  name: string;
  source: TagSource;
}

export interface Page {
  id: PageId;
  /** First H1's text, else the basename. */
  title: string;
  headings: Heading[];
  /** Frontmatter `aliases:` — feeds the mention scanner (concept pages). */
  aliases: string[];
  /** Derived + declared + inherited topics, sorted, deduped by name. */
  tags: Tag[];
  scope: Scope;
  outEdges: Edge[];
}

export interface WikiIndex {
  /** Absolute path of the repo root the index was built from. */
  root: string;
  /** The resolved config the corpus was walked under. Render and server read
   *  kinds / mentionIds / machineLocal from here — one source, no drift. */
  config: WikiConfig;
  pages: Map<PageId, Page>;
  edges: Edge[];
  /** Inverted edges, page targets only. */
  backlinks: Map<PageId, Edge[]>;
  /** "ADR-0007" → "docs/decisions/0007-use-postgres.md". */
  adrIndex: Map<string, PageId>;
  /** Lowercased alias → owning concept page. Duplicate claims are a build error. */
  aliasIndex: Map<string, PageId>;
  /** Aliases claimed by more than one page — surfaces as E005. */
  aliasCollisions: { alias: string; pages: PageId[] }[];
  /** Tag name → pages carrying it, sorted by page id. */
  tagIndex: Map<string, PageId[]>;
  /** Lowercased basename (with .md) → page ids. >1 entry = ambiguous basename. */
  basenameIndex: Map<string, PageId[]>;
  /** Every walked repo file (repo-relative POSIX, markdown included;
   *  machine-local gitignored files excluded) for path checks and /raw/. */
  sourceFiles: Set<string>;
}

export interface LintFinding {
  /** E001 broken link · E002 broken wikilink · E003 ambiguous resolution ·
   *  E004 dead path mention · E005 duplicate alias claim · E006 broken anchor ·
   *  W001 orphan page · W002 long page (length AND section count) ·
   *  W003 skill or persona page malformed — missing Status line / unknown status /
   *  missing required section. */
  code:
    | "E001"
    | "E002"
    | "E003"
    | "E004"
    | "E005"
    | "E006"
    | "W001"
    | "W002"
    | "W003";
  page: PageId;
  line: number;
  message: string;
  /** Enforced findings fail `docs-wiki check`; reported ones are printed only. */
  severity: "enforced" | "reported";
}

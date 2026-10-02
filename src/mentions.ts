// Mention scanner — the auto-linking half of the wiki (Obsidian's "unlinked
// mentions" as first-class edges). The corpus has ~9 real markdown links but
// hundreds of ADR ids, blocker ids, and file paths in prose; recognizing
// them at index time gives the full backlink graph with ZERO edits to the
// high-churn files the concurrent build loop owns. Source files stay
// byte-identical; a future explicit link simply upgrades the edge class.
//
// Precision rules, deliberately conservative:
// - fences never produce mentions (parser already excludes them);
//   backticked inline paths DO count — that is the corpus idiom;
// - blocker ids only link when a matching heading exists in BLOCKERS.md;
// - bare basenames ("TODO.md") only link when globally unique;
// - glob-looking paths (containing *) are skipped, not existence-checked;
// - one edge per (type, target) per page — the first occurrence carries the
//   line number and repeats increment Edge.count, so "how heavily does this
//   page lean on that target" survives the dedupe.

import type { MentionIdToggles } from "./config.ts";
import { isMachineLocal } from "./machine-local.ts";
import { INLINE_LINK, WIKILINK } from "./parser.ts";
import type { ParsedDoc } from "./parser.ts";
import type { Edge, PageId } from "./types.ts";

export interface MentionContext {
  pages: Set<PageId>;
  /** Lowercased basename (with .md) → page ids. */
  basenameIndex: Map<string, PageId[]>;
  /** Every file in the repo, for path existence checks. */
  files: Set<string>;
  /** Every directory, including walk-skipped ones (they still exist). */
  dirs: Set<string>;
  /** First path segments that exist in the repo ("docs", "packages", …). */
  topSegments: Set<string>;
  adrIndex: Map<string, PageId>;
  aliasIndex: Map<string, PageId>;
  /** The blockers page and its `B<n>` heading anchors, when one exists. */
  blockers?: { id: PageId; anchors: Map<string, string> };
  /** The config's merged machine-local patterns (floor + extras). */
  machineLocal: readonly RegExp[];
  /** Which identifier families to recognize (config `mentionIds`). */
  mentionIds: MentionIdToggles;
}

export const ADR_RE = /\bADR-(\d{4})\b/g;
export const BLOCKER_RE = /\bB(\d{1,2})\b/g;
export const PR_RE = /\bPR #(\d+)\b/g;
/** ≥1 slash; charset covers route dirs like `[[...rest]]` and globs. */
export const PATH_RE = /[A-Za-z0-9._[\]-]+(?:\/[A-Za-z0-9._*[\]-]+)+/g;
/** Bare .md basename not preceded by a path character (avoids re-matching
 *  the tail of a full path) and containing no slash of its own. */
export const BARE_MD_RE =
  /(?<![\w/.-])([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.md)\b/g;
export const TRAILING_PUNCT = /[).,;:!?'"]+$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskMatches(text: string, regexes: RegExp[]): string {
  let chars: string[] | null = null;
  for (const re of regexes) {
    for (const m of text.matchAll(re)) {
      chars ??= text.split("");
      for (let i = m.index; i < m.index + m[0].length; i += 1) chars[i] = " ";
    }
  }
  return chars === null ? text : chars.join("");
}

/** Build the combined alias matcher once per index build. Longest-first so
 *  "the widget engine" wins over "widget" at the same position. */
export function buildAliasMatcher(
  aliasIndex: Map<string, PageId>,
): RegExp | null {
  const aliases = [...aliasIndex.keys()].sort((a, b) => b.length - a.length);
  if (aliases.length === 0) return null;
  const body = aliases.map(escapeRegExp).join("|");
  return new RegExp(`(?<![A-Za-z0-9_])(?:${body})(?![A-Za-z0-9_])`, "gi");
}

export function scanMentions(
  from: PageId,
  doc: ParsedDoc,
  ctx: MentionContext,
  aliasMatcher: RegExp | null,
): Edge[] {
  const edges: Edge[] = [];
  const seen = new Map<string, Edge>();

  const push = (edge: Edge): void => {
    if (edge.to === from) return; // a page mentioning itself is not a backlink
    const key = `${edge.type}:${edge.to ?? `dead:${edge.raw}`}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      existing.count += 1; // repeats fold into the first edge
      return;
    }
    seen.set(key, edge);
    edges.push(edge);
  };

  for (const { line, text: rawText } of doc.proseLines) {
    // Explicit link/wikilink syntax already produces typed edges — their
    // targets and label text must not ALSO count as mentions, or every
    // [tenant](tenant.md) would double-emit.
    const text = maskMatches(rawText, [INLINE_LINK, WIKILINK]);

    if (ctx.mentionIds.adr) {
      for (const m of text.matchAll(ADR_RE)) {
        const to = ctx.adrIndex.get(m[0]) ?? null;
        push({
          from,
          to,
          type: "mention-adr",
          raw: m[0],
          line,
          count: 1,
          targetKind: "page",
          ...(to === null ? { unresolved: "not-found" as const } : {}),
        });
      }
    }

    if (ctx.blockers && ctx.mentionIds.blocker) {
      for (const m of text.matchAll(BLOCKER_RE)) {
        const anchor = ctx.blockers.anchors.get(m[0]);
        if (anchor === undefined) continue; // no such blocker heading — not a mention
        push({
          from,
          to: ctx.blockers.id,
          type: "mention-blocker",
          raw: m[0],
          line,
          count: 1,
          anchor,
          targetKind: "page",
        });
      }
    }

    // Later passes must not see path interiors — an alias like "blockers"
    // must not match inside "tasks/BLOCKERS.md".
    const pathSpans: [number, number][] = [];

    for (const m of text.matchAll(PATH_RE)) {
      pathSpans.push([m.index, m.index + m[0].length]);
      const raw = m[0].replace(TRAILING_PUNCT, "");
      if (raw.includes("*")) continue; // glob, not a path
      // `~/.claude/hooks/` is a path in the READER's home directory, not in
      // the repo. PATH_RE can't see the `~/` (it is not in the charset), so
      // the span it hands back starts at `.claude` and the top-segment gate
      // waves it through whenever the repo happens to have a directory of
      // the same name. Existence-checking those would make findings depend
      // on whose machine ran the tool — the same failure the machine-local
      // guard exists to prevent. Real notes are full of them (~/.ssh,
      // ~/.config/tool, ~/.zshrc), so skip the family, don't chase spellings.
      if (text.slice(Math.max(0, m.index - 2), m.index) === "~/") continue;
      if (isMachineLocal(raw, ctx.machineLocal)) continue;
      const top = raw.slice(0, raw.indexOf("/"));
      if (!ctx.topSegments.has(top)) continue; // "example.com/x", "9.9/10", …
      if (raw.toLowerCase().endsWith(".md")) {
        const to = ctx.pages.has(raw) ? raw : null;
        push({
          from,
          to,
          type: "mention-path",
          raw,
          line,
          count: 1,
          targetKind: "page",
          ...(to === null ? { unresolved: "not-found" as const } : {}),
        });
      } else {
        const exists = ctx.files.has(raw) || dirExists(raw, ctx);
        push({
          from,
          to: exists ? raw : null,
          type: "mention-path",
          raw,
          line,
          count: 1,
          targetKind: "source-file",
          ...(exists ? {} : { unresolved: "not-found" as const }),
        });
      }
    }

    let pathMasked = text;
    if (pathSpans.length > 0) {
      const chars = text.split(""); // code units — regex indices are code units
      for (const [s, e] of pathSpans)
        for (let i = s; i < e; i += 1) chars[i] = " ";
      pathMasked = chars.join("");
    }

    for (const m of pathMasked.matchAll(BARE_MD_RE)) {
      const matches = ctx.basenameIndex.get(m[1].toLowerCase()) ?? [];
      if (matches.length !== 1) continue; // ambiguous or unknown — stay silent
      push({
        from,
        to: matches[0],
        type: "mention-path",
        raw: m[1],
        line,
        count: 1,
        targetKind: "page",
      });
    }

    if (aliasMatcher) {
      for (const m of pathMasked.matchAll(aliasMatcher)) {
        const to = ctx.aliasIndex.get(m[0].toLowerCase());
        if (to === undefined) continue;
        push({
          from,
          to,
          type: "mention-alias",
          raw: m[0],
          line,
          count: 1,
          targetKind: "page",
        });
      }
    }
  }

  return edges;
}

function dirExists(path: string, ctx: MentionContext): boolean {
  return ctx.dirs.has(path.endsWith("/") ? path.slice(0, -1) : path);
}

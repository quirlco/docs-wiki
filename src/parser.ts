// Fence- and backtick-aware markdown scanner. This is deliberately NOT a
// full markdown parser: it extracts exactly what the wiki needs — headings,
// explicit links, wikilinks, frontmatter aliases, and the prose lines the
// mention scanner may search — while guaranteeing that code NEVER produces
// link tokens. The corpus contains shell `# comments` inside fences that look
// like H1s, and Next.js route syntax like `/sign-in/[[...rest]]` in inline
// code that looks like a wikilink; both must be inert.

import { Slugger } from "./slug.ts";
import type { Heading } from "./types.ts";

export interface RawLink {
  /** Link text (may be empty for images). */
  text: string;
  /** Target with any #fragment and "title" stripped; "" for pure-anchor links. */
  target: string;
  /** Fragment without the leading #, if present. */
  anchor?: string;
  /** True for `![image](...)` syntax. */
  image: boolean;
  raw: string;
  /** 1-based. */
  line: number;
}

export interface RawWikilink {
  target: string;
  anchor?: string;
  alias?: string;
  raw: string;
  /** 1-based. */
  line: number;
}

export interface ProseLine {
  /** 1-based. */
  line: number;
  /** Raw text, inline code intact (backticked paths are a corpus idiom). */
  text: string;
}

export interface ParsedDoc {
  title: string;
  headings: Heading[];
  aliases: string[];
  /** Frontmatter `tags:` — declared topics (see graph.ts for derived ones). */
  declaredTags: string[];
  /** Frontmatter `description:` (plain or folded `>-` block), whitespace
   *  collapsed; "" when absent. Skills carry their "Use when…" line here. */
  description: string;
  links: RawLink[];
  wikilinks: RawWikilink[];
  /** Lines outside fences and frontmatter — the mention scanner's input. */
  proseLines: ProseLine[];
  /** Total lines in the file, frontmatter and fences included — the number a
   *  reader sees in an editor, which is what the long-page lint is about. */
  lineCount: number;
}

/**
 * Wikilink targets must look like page names or repo paths. Anything else —
 * `[[...rest]]`, `[[0]]` array syntax in code that escaped masking, etc. —
 * is not a wikilink at all. No leading dot, no "..", no backslashes.
 */
export const WIKILINK_TARGET = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;

/** Parse the inside of a [[...]] token into target/anchor/alias. */
export function splitWikilink(inner: string): {
  target: string;
  anchor?: string;
  alias?: string;
} {
  const pipe = inner.indexOf("|");
  const targetPart = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias =
    pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
  const hash = targetPart.indexOf("#");
  const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  const anchor =
    hash === -1 ? undefined : targetPart.slice(hash + 1).trim() || undefined;
  return { target, anchor, alias };
}

export const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
export const INLINE_LINK =
  /(!?)\[([^\]]*)\]\(([^()\s]+(?:\([^()]*\)[^()\s]*)*(?:\s+"[^"]*")?)\)/g;
export const WIKILINK = /\[\[([^[\]]+)\]\]/g;
/** URL schemes (http:, https:, mailto:, …) and protocol-relative — external. */
export const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Inline code spans as [start, endExclusive) code-unit ranges, backticks
 *  included. CommonMark: a span opens with a backtick run and closes at the
 *  next run of exactly the same length; an unmatched run is literal text. */
export function inlineCodeSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    let openLen = 1;
    while (line[i + openLen] === "`") openLen += 1;
    // Find a closing run of exactly openLen backticks.
    let j = i + openLen;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== "`") {
        j += 1;
        continue;
      }
      let runLen = 1;
      while (line[j + runLen] === "`") runLen += 1;
      if (runLen === openLen) {
        close = j;
        break;
      }
      j += runLen;
    }
    if (close === -1) {
      i += openLen; // unmatched — literal backticks
      continue;
    }
    spans.push([i, close + openLen]);
    i = close + openLen;
  }
  return spans;
}

/** Replace inline code spans with spaces, preserving length and positions. */
export function maskInlineCode(line: string): string {
  const spans = inlineCodeSpans(line);
  if (spans.length === 0) return line;
  const chars = line.split("");
  for (const [s, e] of spans) for (let k = s; k < e; k += 1) chars[k] = " ";
  return chars.join("");
}

interface Frontmatter {
  aliases: string[];
  tags: string[];
  description: string;
  /** Number of lines the frontmatter block occupies, including delimiters. */
  lineCount: number;
}

/** The only frontmatter keys the wiki understands; both are string lists. */
const LIST_KEYS = new Set(["aliases", "tags"]);

function splitList(text: string): string[] {
  const body = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  return body
    .split(",")
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter((v) => v !== "");
}

/** Minimal frontmatter reader: `aliases:` and `tags:` (inline `[a, b]` or
 *  block list) — hand-rolled on purpose, no YAML dependency. */
function readFrontmatter(lines: string[]): Frontmatter {
  const none: Frontmatter = {
    aliases: [],
    tags: [],
    description: "",
    lineCount: 0,
  };
  if (lines[0]?.trim() !== "---") return none;
  const values = new Map<string, string[]>([
    ["aliases", []],
    ["tags", []],
  ]);
  let current: string | null = null;
  const description: string[] = [];
  let collecting = false; // inside a description block

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---" || line.trim() === "...") {
      return {
        aliases: values.get("aliases") ?? [],
        tags: values.get("tags") ?? [],
        description: description.join(" ").replace(/\s+/g, " ").trim(),
        lineCount: i + 1,
      };
    }
    if (collecting && /^\s+\S/.test(line)) {
      description.push(line.trim());
      continue;
    }
    const key = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (key) {
      collecting = key[1] === "description";
      if (collecting) {
        const v = key[2].trim();
        if (!/^[>|][+-]?$/.test(v)) description.push(v.replace(/^["']|["']$/g, ""));
      }
      current = LIST_KEYS.has(key[1]) ? key[1] : null;
      if (current !== null && key[2].trim() !== "") {
        values.get(current)?.push(...splitList(key[2]));
        current = null; // inline form is complete on this line
      }
      continue;
    }
    if (current === null) continue;
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item) {
      values.get(current)?.push(...splitList(item[1]));
      continue;
    }
    // Prettier wraps long inline arrays across lines ("[", "a,", "]") —
    // accept those fragments too, or a reformat would silently drop values.
    if (line.trim() !== "") values.get(current)?.push(...splitList(line));
  }
  return none; // unterminated frontmatter — treat the file as having none
}

function splitTarget(rawTarget: string): { target: string; anchor?: string } {
  // Strip an optional trailing "title".
  const withoutTitle = rawTarget.replace(/\s+"[^"]*"$/, "");
  const hash = withoutTitle.indexOf("#");
  if (hash === -1) return { target: withoutTitle };
  return {
    target: withoutTitle.slice(0, hash),
    anchor: withoutTitle.slice(hash + 1) || undefined,
  };
}

export function parseDoc(content: string, fallbackTitle: string): ParsedDoc {
  const lines = content.split("\n");
  const fm = readFrontmatter(lines);

  const headings: Heading[] = [];
  const links: RawLink[] = [];
  const wikilinks: RawWikilink[] = [];
  const proseLines: ProseLine[] = [];
  const slugger = new Slugger();
  let title = "";

  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  for (let idx = fm.lineCount; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const lineNo = idx + 1;

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        // A backtick fence's info string may not contain backticks (CommonMark).
        if (!(marker[0] === "`" && fence[2].includes("`"))) {
          inFence = true;
          fenceChar = marker[0];
          fenceLen = marker.length;
          continue;
        }
      } else if (
        marker[0] === fenceChar &&
        marker.length >= fenceLen &&
        fence[2].trim() === ""
      ) {
        inFence = false;
        continue;
      }
    }
    if (inFence) continue;

    proseLines.push({ line: lineNo, text: line });

    const heading = HEADING.exec(line);
    if (heading) {
      const text = heading[2];
      const h: Heading = {
        depth: heading[1].length,
        text,
        slug: slugger.slug(text),
        line: lineNo,
      };
      headings.push(h);
      if (h.depth === 1 && title === "") title = text;
      continue;
    }

    // Link syntax never counts inside inline code.
    const masked = maskInlineCode(line);

    for (const m of masked.matchAll(INLINE_LINK)) {
      const rawTarget = m[3];
      if (EXTERNAL.test(rawTarget)) continue;
      if (rawTarget.startsWith("#")) {
        links.push({
          text: m[2],
          target: "",
          anchor: rawTarget.slice(1) || undefined,
          image: m[1] === "!",
          raw: m[0],
          line: lineNo,
        });
        continue;
      }
      const { target, anchor } = splitTarget(rawTarget);
      links.push({
        text: m[2],
        target,
        anchor,
        image: m[1] === "!",
        raw: m[0],
        line: lineNo,
      });
    }

    for (const m of masked.matchAll(WIKILINK)) {
      const { target, anchor, alias } = splitWikilink(m[1]);
      if (!WIKILINK_TARGET.test(target) || target.includes("..")) continue;
      wikilinks.push({ target, anchor, alias, raw: m[0], line: lineNo });
    }
  }

  return {
    title: title || fallbackTitle,
    headings,
    aliases: fm.aliases,
    description: fm.description,
    declaredTags: fm.tags,
    links,
    wikilinks,
    proseLines,
    // A file ending in a newline splits to a trailing "", which is not a line
    // anyone would count.
    lineCount: lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length,
  };
}

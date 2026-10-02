// Request-time HTML rendering: marked for markdown, plus line-wise
// linkification of wikilinks and recognized mentions BEFORE marked runs.
// The same fence/code-span machinery the parser uses guarantees fenced code
// never linkifies; backticked inline paths (`docs/security.md`) DO become
// links — wrapped whole, `<a><code>…</code></a>` — because that is how this
// corpus cites files.

import { marked } from "./vendor/marked.mjs";

import { blockersInfo } from "./graph.ts";
import { isMachineLocal } from "./machine-local.ts";
import {
  ADR_RE,
  BARE_MD_RE,
  BLOCKER_RE,
  buildAliasMatcher,
  PATH_RE,
  PR_RE,
  TRAILING_PUNCT,
} from "./mentions.ts";
import {
  EXTERNAL,
  FENCE,
  INLINE_LINK,
  inlineCodeSpans,
  splitWikilink,
  WIKILINK,
  WIKILINK_TARGET,
} from "./parser.ts";
import { normalizePath, resolveTarget } from "./resolver.ts";
import type { ResolverContext } from "./resolver.ts";
import type { Edge, PageId, Tag, WikiIndex } from "./types.ts";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * URL builders for everything the renderer links to. The defaults are the
 * standalone server's routes; a host app embedding the engine (its own
 * /projects/[slug]/docs/... routing, say) overrides any subset.
 */
export interface Hrefs {
  page(id: PageId, anchor?: string): string;
  raw(path: string): string;
  tag(name: string): string;
}

export const DEFAULT_HREFS: Hrefs = {
  page: (id, anchor) =>
    `/page/${id}${anchor !== undefined ? `#${anchor}` : ""}`,
  raw: (path) => `/raw/${path}`,
  tag: (name) => `/tag/${encodeURIComponent(name)}`,
};

export interface RenderContext {
  index: WikiIndex;
  resolver: ResolverContext;
  aliasMatcher: RegExp | null;
  blockers: ReturnType<typeof blockersInfo>;
  /** "https://github.com/user/repo" or null — enables PR #N links. */
  repoUrl: string | null;
  hrefs: Hrefs;
}

export function makeRenderContext(
  index: WikiIndex,
  repoUrl: string | null,
  hrefs?: Partial<Hrefs>,
): RenderContext {
  return {
    index,
    resolver: {
      pages: new Set(index.pages.keys()),
      basenameIndex: index.basenameIndex,
    },
    aliasMatcher: buildAliasMatcher(index.aliasIndex),
    blockers: blockersInfo(index.pages, index.basenameIndex),
    repoUrl,
    hrefs: { ...DEFAULT_HREFS, ...hrefs },
  };
}

interface Rep {
  start: number;
  end: number;
  html: string;
}

function resolveFilePath(
  target: string,
  from: PageId,
  files: Set<string>,
): string | null {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const candidates = target.startsWith("/")
    ? [normalizePath(target.slice(1))]
    : [normalizePath(`${dir}/${target}`), normalizePath(target)];
  return candidates.find((p) => p !== "" && files.has(p)) ?? null;
}

/** Linkify one prose line. Returns markdown-with-inline-HTML. */
function linkifyLine(line: string, from: PageId, ctx: RenderContext): string {
  const spans = inlineCodeSpans(line);
  const taken: [number, number][] = [];
  const reps: Rep[] = [];

  const overlapsTaken = (s: number, e: number): boolean =>
    taken.some(([ts, te]) => s < te && ts < e);
  const overlapsCode = (s: number, e: number): boolean =>
    spans.some(([cs, ce]) => s < ce && cs < e);
  /** The code span whose CONTENT is exactly [s,e) — for whole-span wrapping. */
  const exactSpan = (s: number, e: number): [number, number] | null => {
    for (const [cs, ce] of spans) {
      const [is, ie] = [cs + runLen(line, cs), ce - runLen(line, cs)];
      if (s >= is && e <= ie && line.slice(is, ie).trim() === line.slice(s, e))
        return [cs, ce];
    }
    return null;
  };
  const accept = (s: number, e: number, html: string): void => {
    taken.push([s, e]);
    reps.push({ start: s, end: e, html });
  };

  const pageHref = (id: PageId, anchor?: string): string =>
    ctx.hrefs.page(id, anchor);

  // 1. Explicit markdown links/images: rewrite targets to wiki routes.
  for (const m of line.matchAll(INLINE_LINK)) {
    const [s, e] = [m.index, m.index + m[0].length];
    if (overlapsCode(s, e) || overlapsTaken(s, e)) continue;
    const rawTarget = m[3].replace(/\s+"[^"]*"$/, "");
    if (EXTERNAL.test(rawTarget) || rawTarget.startsWith("#")) {
      taken.push([s, e]); // leave as-is, but block inner mention rewrites
      continue;
    }
    const hash = rawTarget.indexOf("#");
    const target = hash === -1 ? rawTarget : rawTarget.slice(0, hash);
    const anchor =
      hash === -1 ? undefined : rawTarget.slice(hash + 1) || undefined;
    const last = target.split("/").pop() ?? target;
    const isPage = last.toLowerCase().endsWith(".md") || !last.includes(".");
    if (target.endsWith("/")) {
      taken.push([s, e]); // directory link — leave untouched
      continue;
    }
    if (isPage) {
      const r = resolveTarget(target, from, ctx.resolver);
      if (r.ok) accept(s, e, `[${m[2]}](${pageHref(r.id, anchor)})`);
      else
        accept(
          s,
          e,
          `<span class="dead" title="unresolved">${escapeHtml(m[2])}</span>`,
        );
      continue;
    }
    const file = resolveFilePath(target, from, ctx.index.sourceFiles);
    if (file !== null)
      accept(s, e, `${m[1]}[${m[2]}](${ctx.hrefs.raw(file)})`);
    else
      accept(
        s,
        e,
        `<span class="dead" title="missing file">${escapeHtml(m[2])}</span>`,
      );
  }

  // 2. Wikilinks.
  for (const m of line.matchAll(WIKILINK)) {
    const [s, e] = [m.index, m.index + m[0].length];
    if (overlapsCode(s, e) || overlapsTaken(s, e)) continue;
    const { target, anchor, alias } = splitWikilink(m[1]);
    if (!WIKILINK_TARGET.test(target) || target.includes("..")) continue;
    const r = resolveTarget(target, from, ctx.resolver);
    const label = escapeHtml(alias ?? target);
    // escapeHtml on the href: the anchor is document-controlled text going
    // into an attribute — `[[a#x" onmouseover="…]]` must not break out.
    if (r.ok)
      accept(
        s,
        e,
        `<a href="${escapeHtml(pageHref(r.id, anchor))}">${label}</a>`,
      );
    else
      accept(
        s,
        e,
        `<span class="dead" title="unresolved wikilink">${label}</span>`,
      );
  }

  // Helper for mention-style tokens that may sit inside a code span.
  const acceptMention = (
    s: number,
    e: number,
    href: string,
    text: string,
  ): void => {
    if (overlapsTaken(s, e)) return;
    if (!overlapsCode(s, e)) {
      accept(s, e, `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`);
      return;
    }
    const span = exactSpan(s, e);
    if (span === null || overlapsTaken(span[0], span[1])) return;
    accept(
      span[0],
      span[1],
      `<a href="${escapeHtml(href)}"><code>${escapeHtml(text)}</code></a>`,
    );
  };

  // 3. Repo paths (before bare basenames and aliases, mirroring the scanner).
  for (const m of line.matchAll(PATH_RE)) {
    const raw = m[0].replace(TRAILING_PUNCT, "");
    const [s, e] = [m.index, m.index + raw.length];
    if (!raw.includes("*") && !isMachineLocal(raw, ctx.index.config.machineLocal)) {
      if (raw.toLowerCase().endsWith(".md")) {
        if (ctx.index.pages.has(raw)) acceptMention(s, e, pageHref(raw), raw);
      } else if (ctx.index.sourceFiles.has(raw)) {
        acceptMention(s, e, ctx.hrefs.raw(raw), raw);
      }
    }
    // Linked or not, later passes never see a path's interior — an alias
    // like "gateway" must not match inside "apps/gateway" (scanner parity;
    // the scanner masks ALL path spans the same way).
    taken.push([m.index, m.index + m[0].length]);
  }

  // 4. Unique bare .md basenames.
  for (const m of line.matchAll(BARE_MD_RE)) {
    const matches = ctx.index.basenameIndex.get(m[1].toLowerCase()) ?? [];
    if (matches.length !== 1 || matches[0] === from) continue;
    acceptMention(m.index, m.index + m[1].length, pageHref(matches[0]), m[1]);
  }

  // 5. ADR ids, blocker ids, PR numbers, concept aliases — each family
  // linkified only when the config's mentionIds toggle leaves it on, the
  // same gate the scanner applies.
  const mentionIds = ctx.index.config.mentionIds;
  if (mentionIds.adr) {
    for (const m of line.matchAll(ADR_RE)) {
      const to = ctx.index.adrIndex.get(m[0]);
      if (to !== undefined && to !== from)
        acceptMention(m.index, m.index + m[0].length, pageHref(to), m[0]);
    }
  }
  if (ctx.blockers !== undefined && mentionIds.blocker) {
    for (const m of line.matchAll(BLOCKER_RE)) {
      const anchor = ctx.blockers.anchors.get(m[0]);
      if (anchor !== undefined && ctx.blockers.id !== from)
        acceptMention(
          m.index,
          m.index + m[0].length,
          pageHref(ctx.blockers.id, anchor),
          m[0],
        );
    }
  }
  if (ctx.repoUrl !== null && mentionIds.pr) {
    for (const m of line.matchAll(PR_RE)) {
      acceptMention(
        m.index,
        m.index + m[0].length,
        `${ctx.repoUrl}/pull/${m[1]}`,
        m[0],
      );
    }
  }
  if (ctx.aliasMatcher !== null) {
    for (const m of line.matchAll(ctx.aliasMatcher)) {
      const to = ctx.index.aliasIndex.get(m[0].toLowerCase());
      if (to === undefined || to === from) continue;
      const [s, e] = [m.index, m.index + m[0].length];
      if (overlapsCode(s, e)) continue; // aliases are prose, not code
      if (!overlapsTaken(s, e))
        accept(s, e, `<a href="${pageHref(to)}">${escapeHtml(m[0])}</a>`);
    }
  }

  reps.sort((a, b) => b.start - a.start);
  let out = line;
  for (const r of reps) out = out.slice(0, r.start) + r.html + out.slice(r.end);
  return out;
}

function runLen(line: string, at: number): number {
  let n = 0;
  while (line[at + n] === "`") n += 1;
  return n;
}

/** Frontmatter is metadata — drop it from the rendered view. */
function stripFrontmatter(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") return i + 1;
  }
  return 0;
}

export function renderMarkdown(
  content: string,
  from: PageId,
  ctx: RenderContext,
): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  for (let i = stripFrontmatter(lines); i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        if (!(marker[0] === "`" && fence[2].includes("`"))) {
          inFence = true;
          fenceChar = marker[0];
          fenceLen = marker.length;
          out.push(line);
          continue;
        }
      } else if (
        marker[0] === fenceChar &&
        marker.length >= fenceLen &&
        fence[2].trim() === ""
      ) {
        inFence = false;
        out.push(line);
        continue;
      }
    }
    out.push(inFence ? line : linkifyLine(line, from, ctx));
  }

  return String(marked.parse(out.join("\n"), { async: false }));
}

/** One row per referring PAGE, not per edge: a hub page can be mentioned 60
 *  times from 30 files, and a flat edge list is unreadable in a side pane. */
interface Referrer {
  from: PageId;
  title: string;
  lines: number[];
  /** Total occurrences, not edges — repeats are folded into Edge.count. */
  count: number;
  /** Distinct mention texts, for the tooltip ("tenant", "tenant.md", …). */
  raws: Set<string>;
}

function groupReferrers(ctx: RenderContext, edges: Edge[]): Referrer[] {
  const byPage = new Map<PageId, Referrer>();
  for (const e of edges) {
    let r = byPage.get(e.from);
    if (r === undefined) {
      r = {
        from: e.from,
        title: ctx.index.pages.get(e.from)?.title ?? e.from,
        lines: [],
        count: 0,
        raws: new Set(),
      };
      byPage.set(e.from, r);
    }
    r.lines.push(e.line);
    r.count += e.count;
    if (e.type !== "link" && e.type !== "wikilink") r.raws.add(e.raw);
  }
  return [...byPage.values()].sort(
    (a, b) => b.count - a.count || a.title.localeCompare(b.title),
  );
}

export function backlinksPanelHtml(ctx: RenderContext, id: PageId): string {
  const edges = ctx.index.backlinks.get(id) ?? [];
  const explicit = groupReferrers(
    ctx,
    edges.filter((e) => e.type === "link" || e.type === "wikilink"),
  );
  const mentions = groupReferrers(
    ctx,
    edges.filter((e) => e.type !== "link" && e.type !== "wikilink"),
  );

  const row = (r: Referrer): string => {
    const first = Math.min(...r.lines);
    const tip =
      r.raws.size > 0 ? [...r.raws].slice(0, 6).join(", ") : "explicit link";
    return (
      `<li title="${escapeHtml(tip)}">` +
      `<a href="${ctx.hrefs.page(r.from)}">${escapeHtml(r.title)}</a>` +
      `<span class="meta"><code>${escapeHtml(r.from)}</code>:${first}` +
      (r.count > 1 ? ` <b>×${r.count}</b>` : "") +
      `</span></li>`
    );
  };
  const section = (label: string, rows: Referrer[]): string =>
    rows.length === 0
      ? ""
      : `<h3>${label} <span class="count">${rows.length}</span></h3>` +
        `<ul>${rows.map(row).join("")}</ul>`;

  const total = explicit.length + mentions.length;
  const list =
    total === 0
      ? "<p class='meta'>Nothing references this page — it is an orphan.</p>"
      : section("Linked from", explicit) + section("Mentioned in", mentions);

  // Two views of the same relationships: the list answers "which docs do I
  // need to update", the graph answers "how is this doc situated".
  return (
    `<aside id="backlinks" data-page="${escapeHtml(id)}"><div class="pane-inner">` +
    `<div class="pane-head">` +
    `<h2>Backlinks <span class="count">${total}</span></h2>` +
    `<div class="tabs" role="tablist" aria-label="Backlinks view">` +
    `<button role="tab" id="tab-list" aria-controls="panel-list" aria-selected="true" class="on">List</button>` +
    `<button role="tab" id="tab-graph" aria-controls="panel-graph" aria-selected="false">Graph</button>` +
    `</div></div>` +
    `<div id="panel-list" role="tabpanel" aria-labelledby="tab-list">${list}</div>` +
    `<div id="panel-graph" role="tabpanel" aria-labelledby="tab-graph" hidden>` +
    `<div class="canvas-wrap">` +
    `<canvas id="pane-graph"></canvas>` +
    `<button id="graph-expand" type="button" title="Open larger (f)" aria-label="Open the graph larger">⤢</button>` +
    `</div>` +
    `<div class="graph-legend" id="pane-graph-legend"></div>` +
    `<p class="meta pane-graph-hint">click a node to open it · drag to pan · wheel to zoom</p>` +
    `</div>` +
    `</div>` +
    // A native <dialog>: Escape-to-close, backdrop and focus handling come
    // from the platform rather than from hand-rolled key listeners.
    `<dialog id="graph-modal" aria-label="Backlinks graph, enlarged">` +
    `<div class="modal-head">` +
    `<strong>${escapeHtml(ctx.index.pages.get(id)?.title ?? id)}</strong>` +
    `<span class="meta">its links and referrers</span>` +
    `<button id="graph-modal-close" type="button" aria-label="Close">✕</button>` +
    `</div>` +
    `<canvas id="pane-graph-full"></canvas>` +
    `<div class="graph-legend" id="pane-graph-full-legend"></div>` +
    `</dialog>` +
    `</aside>`
  );
}

export function tagChipsHtml(tags: Tag[], hrefs: Hrefs = DEFAULT_HREFS): string {
  if (tags.length === 0) return "";
  return (
    `<div class="chips">` +
    tags
      .map(
        (t) =>
          `<a class="chip ${t.source}" href="${escapeHtml(hrefs.tag(t.name))}" ` +
          `title="${t.source} tag">${escapeHtml(t.name)}</a>`,
      )
      .join("") +
    `</div>`
  );
}

/** The complete table of contents, grouped by a chosen facet. Every document
 *  in the corpus appears exactly once — this is the page that guarantees
 *  nothing is undiscoverable. */
export function tocHtml(
  index: WikiIndex,
  groupBy: string,
  hrefs: Hrefs = DEFAULT_HREFS,
): string {
  const pages = [...index.pages.values()];
  // The SAME rule list that derived the tags (config `kinds`) — grouping and
  // derivation cannot drift apart, which is the drift bug this replaces.
  const kindTags = new Set(index.config.kinds.map((k) => k.tag));
  const groupsOf = (p: (typeof pages)[number]): string[] => {
    if (groupBy === "folder") {
      return [
        p.id.includes("/")
          ? p.id.slice(0, p.id.lastIndexOf("/"))
          : "(repo root)",
      ];
    }
    if (groupBy === "topic") {
      const topics = p.tags.filter(
        (t) => !kindTags.has(t.name) && !t.name.startsWith("status:"),
      );
      return topics.length > 0 ? topics.map((t) => t.name) : ["(untagged)"];
    }
    const kind = p.tags.find((t) => kindTags.has(t.name));
    return [kind?.name ?? "(other)"];
  };

  const buckets = new Map<string, typeof pages>();
  for (const p of pages) {
    for (const g of groupsOf(p)) buckets.set(g, [...(buckets.get(g) ?? []), p]);
  }
  const sorted = [...buckets.entries()].sort(
    ([a, pa], [b, pb]) =>
      (a.startsWith("(") ? 1 : 0) - (b.startsWith("(") ? 1 : 0) ||
      pb.length - pa.length ||
      a.localeCompare(b),
  );

  const facet = (name: string, label: string): string =>
    `<a class="facet${groupBy === name ? " on" : ""}" href="/?by=${name}">${label}</a>`;

  const body = sorted
    .map(([group, items]) => {
      const rows = items
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(
          (p) =>
            `<li><a href="${hrefs.page(p.id)}">${escapeHtml(p.title)}</a>` +
            `<span class="meta"><code>${escapeHtml(p.id)}</code></span></li>`,
        )
        .join("");
      return (
        `<section class="toc-group"><h2>${escapeHtml(group)}` +
        `<span class="count">${items.length}</span></h2><ul>${rows}</ul></section>`
      );
    })
    .join("");

  return (
    `<div class="pagehead"><h1 class="title">All documents</h1>` +
    `<p class="meta">${index.pages.size} pages · group by ` +
    `${facet("kind", "kind")}${facet("topic", "topic")}${facet("folder", "folder")}</p></div>` +
    `<div class="toc">${body}</div>`
  );
}

export interface ShellOptions {
  /** Rendered into a sticky right-hand pane beside the main column. */
  sidebar?: string;
  /** Full-bleed layout (the graph page wants the whole viewport). */
  wide?: boolean;
}

export function shellHtml(
  title: string,
  body: string,
  opts: ShellOptions = {},
): string {
  const main = opts.sidebar
    ? `<main class="with-pane">${body}${opts.sidebar}</main>`
    : `<main${opts.wide ? ' class="wide"' : ""}>${body}</main>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · wiki</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header>
<nav>
<a href="/" class="brand">📚 wiki</a>
<a href="/graph">graph</a>
<a href="/tags">tags</a>
<a href="/orphans">orphans</a>
</nav>
<div class="search"><input id="search" type="search" placeholder="Search docs… ( / )" autocomplete="off"><div id="search-results" hidden></div></div>
</header>
${main}
<script type="module" src="/assets/app.mjs"></script>
</body>
</html>`;
}

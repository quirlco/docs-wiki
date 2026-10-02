// Index builder: turns a walked corpus into the one WikiIndex that the CLI,
// lint, and server all consume.

import type { Corpus } from "./corpus.ts";
import { scopeFor } from "./corpus.ts";
import { buildAliasMatcher, scanMentions } from "./mentions.ts";
import type { MentionContext } from "./mentions.ts";
import { normalizePath, resolveTarget } from "./resolver.ts";
import type { ResolverContext } from "./resolver.ts";
import { buildTagIndex, computeTags, isConceptPage } from "./tags.ts";
import type { Edge, Page, PageId, WikiIndex } from "./types.ts";

const ADR_PAGE = /(^|\/)decisions\/(\d{4})-[^/]+\.md$/;
const BLOCKER_HEADING = /^B(\d{1,3})\b/;

/** The blockers page (unique basename BLOCKERS.md) and its B<n> heading
 *  anchors, when the corpus has one. Shared by the indexer and renderer. */
export function blockersInfo(
  pages: Map<PageId, Page>,
  basenameIndex: Map<string, PageId[]>,
): { id: PageId; anchors: Map<string, string> } | undefined {
  const blockerPages = basenameIndex.get("blockers.md") ?? [];
  if (blockerPages.length !== 1) return undefined;
  return {
    id: blockerPages[0],
    anchors: new Map(
      (pages.get(blockerPages[0])?.headings ?? [])
        .filter((h) => BLOCKER_HEADING.test(h.text))
        .map((h) => {
          const id = BLOCKER_HEADING.exec(h.text);
          return [`B${id?.[1] ?? ""}`, h.slug] as const;
        }),
    ),
  };
}

export function buildIndex(corpus: Corpus): WikiIndex {
  const pages = new Map<PageId, Page>();
  const basenameIndex = new Map<string, PageId[]>();
  const adrIndex = new Map<string, PageId>();
  const aliasIndex = new Map<string, PageId>();
  const aliasCollisions: { alias: string; pages: PageId[] }[] = [];

  const ids = [...corpus.docs.keys()].sort();
  for (const id of ids) {
    const doc = corpus.docs.get(id);
    if (doc === undefined) continue;
    pages.set(id, {
      id,
      title: doc.title,
      headings: doc.headings,
      aliases: doc.aliases,
      tags: [], // filled once edges exist — inheritance reads the graph
      scope: scopeFor(id, corpus.config),
      outEdges: [],
    });

    const base = (id.split("/").pop() ?? id).toLowerCase();
    basenameIndex.set(base, [...(basenameIndex.get(base) ?? []), id]);

    const adr = ADR_PAGE.exec(id);
    if (adr && !adrIndex.has(`ADR-${adr[2]}`))
      adrIndex.set(`ADR-${adr[2]}`, id);

    for (const alias of doc.aliases) {
      const key = alias.toLowerCase();
      const owner = aliasIndex.get(key);
      if (owner === undefined) {
        aliasIndex.set(key, id);
        continue;
      }
      const existing = aliasCollisions.find((c) => c.alias === key);
      if (existing) existing.pages.push(id);
      else aliasCollisions.push({ alias: key, pages: [owner, id] });
    }
  }

  const blockers = blockersInfo(pages, basenameIndex);

  const resolverCtx: ResolverContext = {
    pages: new Set(pages.keys()),
    basenameIndex,
  };
  const topSegments = new Set<string>();
  for (const f of corpus.files) {
    const slash = f.indexOf("/");
    if (slash !== -1) topSegments.add(f.slice(0, slash));
  }
  for (const d of corpus.dirs) {
    if (!d.includes("/")) topSegments.add(d);
  }
  const mentionCtx: MentionContext = {
    pages: resolverCtx.pages,
    basenameIndex,
    files: corpus.files,
    dirs: corpus.dirs,
    topSegments,
    adrIndex,
    aliasIndex,
    blockers,
    machineLocal: corpus.config.machineLocal,
    mentionIds: corpus.config.mentionIds,
  };
  const aliasMatcher = buildAliasMatcher(aliasIndex);

  const edges: Edge[] = [];
  for (const id of ids) {
    const doc = corpus.docs.get(id);
    const page = pages.get(id);
    if (doc === undefined || page === undefined) continue;

    for (const link of doc.links) {
      if (link.target === "") continue; // intra-doc anchor — lint checks it from ParsedDoc
      const edge = resolveExplicit(
        id,
        link.target,
        link.raw,
        link.line,
        link.anchor,
        corpus,
      );
      if (edge) page.outEdges.push(edge);
    }

    for (const wl of doc.wikilinks) {
      const r = resolveTarget(wl.target, id, resolverCtx);
      page.outEdges.push({
        from: id,
        to: r.ok ? r.id : null,
        type: "wikilink",
        raw: wl.raw,
        line: wl.line,
        count: 1,
        anchor: wl.anchor,
        targetKind: "page",
        ...(r.ok ? {} : { unresolved: r.reason }),
        ...(!r.ok && r.reason === "ambiguous"
          ? { candidates: r.candidates }
          : {}),
      });
    }

    page.outEdges.push(...scanMentions(id, doc, mentionCtx, aliasMatcher));
    edges.push(...page.outEdges);
  }

  const backlinks = new Map<PageId, Edge[]>();
  for (const edge of edges) {
    if (edge.targetKind !== "page" || edge.to === null || edge.to === edge.from)
      continue;
    backlinks.set(edge.to, [...(backlinks.get(edge.to) ?? []), edge]);
  }

  // Tags last: inheritance walks the edges built above.
  const tagsByPage = computeTags(
    ids.flatMap((id) => {
      const doc = corpus.docs.get(id);
      const page = pages.get(id);
      return doc && page ? [{ id, doc, edges: page.outEdges }] : [];
    }),
    isConceptPage,
    corpus.config.kinds,
  );
  for (const [id, tags] of tagsByPage) {
    const page = pages.get(id);
    if (page) page.tags = tags;
  }

  return {
    root: corpus.root,
    config: corpus.config,
    pages,
    edges,
    backlinks,
    adrIndex,
    aliasIndex,
    aliasCollisions,
    tagIndex: buildTagIndex(pages),
    basenameIndex,
    sourceFiles: corpus.files,
  };

  function resolveExplicit(
    from: PageId,
    target: string,
    raw: string,
    line: number,
    anchor: string | undefined,
    c: Corpus,
  ): Edge | null {
    // Directory links ("docs/decisions/") — existence-check the prefix.
    if (target.endsWith("/")) {
      const dir = from.includes("/")
        ? from.slice(0, from.lastIndexOf("/"))
        : "";
      const candidates = target.startsWith("/")
        ? [normalizePath(target.slice(1))]
        : [normalizePath(`${dir}/${target}`), normalizePath(target)];
      const found = candidates.find((p) => p !== "" && c.dirs.has(p));
      return {
        from,
        to: found ?? null,
        type: "link",
        raw,
        line,
        count: 1,
        targetKind: "source-file",
        ...(found ? {} : { unresolved: "not-found" as const }),
      };
    }

    const lastSegment = target.split("/").pop() ?? target;
    const looksLikePage =
      lastSegment.toLowerCase().endsWith(".md") || !lastSegment.includes(".");

    if (looksLikePage) {
      const r = resolveTarget(target, from, {
        pages: resolverCtx.pages,
        basenameIndex,
      });
      return {
        from,
        to: r.ok ? r.id : null,
        type: "link",
        raw,
        line,
        count: 1,
        anchor,
        targetKind: "page",
        ...(r.ok ? {} : { unresolved: r.reason }),
        ...(!r.ok && r.reason === "ambiguous"
          ? { candidates: r.candidates }
          : {}),
      };
    }

    // Source file (code, image, …): relative to the source page, then root.
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    const candidates = [
      normalizePath(`${dir}/${target}`),
      normalizePath(target.startsWith("/") ? target.slice(1) : target),
    ];
    const found = candidates.find((p) => p !== "" && c.files.has(p));
    return {
      from,
      to: found ?? null,
      type: "link",
      raw,
      line,
      count: 1,
      targetKind: "source-file",
      ...(found ? {} : { unresolved: "not-found" as const }),
    };
  }
}

/** Pages nothing links or mentions — candidates for indexing or deletion. */
export function computeOrphans(index: WikiIndex): PageId[] {
  return [...index.pages.keys()].filter(
    (id) => (index.backlinks.get(id) ?? []).length === 0,
  );
}

export interface GraphJson {
  /** Every group in the WHOLE corpus, sorted — not just the ones in this
   *  view. Clients colour by index into this list, so a group keeps the same
   *  colour in the corpus graph and in a single page's pane. */
  groups: string[];
  nodes: {
    id: string;
    title: string;
    group: string;
    deg: number;
    focus?: boolean;
  }[];
  links: { source: string; target: string; explicit: boolean }[];
}

/**
 * Nodes and de-duplicated edges for the canvas clients (public/graph.mjs,
 * public/pane-graph.mjs). With `focus`, returns only that page's
 * neighbourhood (itself + everything it references or is referenced by) and
 * the edges among those nodes — the pane's graph tab. Serialize this as the
 * payload behind whatever URL you hand mountGraph/mountPaneGraph.
 */
export function graphJson(index: WikiIndex, focus?: string): GraphJson {
  const agg = new Map<
    string,
    { source: string; target: string; explicit: boolean }
  >();
  for (const e of index.edges) {
    if (e.targetKind !== "page" || e.to === null || e.to === e.from) continue;
    const key = `${e.from}→${e.to}`;
    const explicit = e.type === "link" || e.type === "wikilink";
    const existing = agg.get(key);
    if (existing === undefined)
      agg.set(key, { source: e.from, target: e.to, explicit });
    else existing.explicit = existing.explicit || explicit;
  }

  let links = [...agg.values()];
  let pageIds = [...index.pages.keys()];

  if (focus !== undefined) {
    // The EGO network: edges incident to the focus only. Including
    // neighbour-to-neighbour edges as well turns a hub's pane into a blob
    // (tenant.md: 54 neighbours, 588 edges among them) and answers a
    // question nobody asked — the pane exists to show what references THIS
    // page, which is exactly the incident set.
    links = links.filter((l) => l.source === focus || l.target === focus);
    const near = new Set<string>([focus]);
    for (const l of links) {
      near.add(l.source);
      near.add(l.target);
    }
    pageIds = pageIds.filter((id) => near.has(id));
  }

  // Degree is computed over the RETURNED links, so node sizes reflect the
  // view you are looking at rather than the whole corpus.
  const deg = new Map<string, number>();
  for (const l of links) {
    deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
    deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
  }

  const groupOf = (id: string): string =>
    id.includes("/") ? id.slice(0, id.indexOf("/")) : "root";

  return {
    groups: [...new Set([...index.pages.keys()].map(groupOf))].sort(),
    nodes: pageIds.map((id) => {
      const p = index.pages.get(id);
      return {
        id,
        title: p?.title ?? id,
        group: groupOf(id),
        deg: deg.get(id) ?? 0,
        ...(focus !== undefined && id === focus ? { focus: true } : {}),
      };
    }),
    links,
  };
}

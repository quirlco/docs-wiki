// Localhost wiki browser. INTERNAL ONLY, enforced structurally:
// - binds 127.0.0.1, hard-coded — there is no flag to widen it;
// - /page/* serves only ids present in the index (membership routing —
//   path traversal has nothing to traverse to);
// - /raw/* serves only files the corpus walk recorded, same property;
// - re-reads the working tree per request (1s index cache), so the browser
//   always shows current docs — no build step, no dist/ output, nothing
//   deployable.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.ts";
import type { WikiConfig } from "./config.ts";
import { walkCorpus } from "./corpus.ts";
import type { Corpus } from "./corpus.ts";
import { buildIndex, computeOrphans, graphJson } from "./graph.ts";
import { isMachineLocal } from "./machine-local.ts";
import {
  backlinksPanelHtml,
  escapeHtml,
  makeRenderContext,
  renderMarkdown,
  shellHtml,
  tagChipsHtml,
  tocHtml,
} from "./render.ts";
import type { RenderContext } from "./render.ts";
import { buildSearchIndex, parseQuery, search } from "./search.ts";
import type { SearchHit, SearchIndex } from "./search.ts";
import type { WikiIndex } from "./types.ts";

export interface ServeOptions {
  root: string;
  port: number;
  config?: WikiConfig;
}

export interface RunningServer {
  server: http.Server;
  url: string;
}

// dirname+join, not new URL(rel, import.meta.url) — bundler-safe (see corpus.ts note)
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
// A Map, deliberately: an object literal would answer for "toString" /
// "__proto__" via the prototype chain and turn the allowlist into a sieve.
const ASSETS = new Map<string, string>([
  ["style.css", "text/css; charset=utf-8"],
  ["app.mjs", "text/javascript; charset=utf-8"],
  ["graph.mjs", "text/javascript; charset=utf-8"], // imported by graph-auto.mjs
  ["graph-auto.mjs", "text/javascript; charset=utf-8"], // the /graph page's entry
  ["layout.mjs", "text/javascript; charset=utf-8"], // imported by graph.mjs
  ["pane-graph.mjs", "text/javascript; charset=utf-8"], // lazy-imported by app.mjs
]);
const RAW_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".html": "text/plain; charset=utf-8", // view source, never execute
};

interface State {
  at: number;
  corpus: Corpus;
  index: WikiIndex;
  searchIndex: SearchIndex;
  render: RenderContext;
}

function detectRepoUrl(root: string): string | null {
  try {
    const raw = execFileSync(
      "git",
      ["-C", root, "config", "--get", "remote.origin.url"],
      {
        encoding: "utf8",
      },
    ).trim();
    const m =
      /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/.exec(
        raw,
      );
    return m ? `https://github.com/${m[1]}` : null;
  } catch {
    return null;
  }
}

export async function startWikiServer(
  root: string,
  port: number,
  config: WikiConfig = loadConfig(root),
): Promise<RunningServer> {
  const repoUrl = detectRepoUrl(root);
  let state: State | null = null;

  const getState = (): State => {
    if (state !== null && Date.now() - state.at < 1000) return state;
    const corpus = walkCorpus(root, config);
    const index = buildIndex(corpus);
    state = {
      at: Date.now(),
      corpus,
      index,
      searchIndex: buildSearchIndex(corpus),
      render: makeRenderContext(index, repoUrl),
    };
    return state;
  };

  // DNS-rebinding guard: a page on evil.example whose DNS is rebound to
  // 127.0.0.1 becomes same-origin with this server; the loopback bind alone
  // cannot stop that. Populated with the real port once listening.
  const allowedHosts = new Set<string>();

  const server = http.createServer((req, res) => {
    try {
      const host = (req.headers.host ?? "").toLowerCase();
      if (!allowedHosts.has(host)) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("forbidden: unexpected Host header");
        return;
      }
      handle(req, res);
    } catch {
      // Never echo error details — messages can carry absolute paths.
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("internal error");
    }
  });

  function send(
    res: http.ServerResponse,
    status: number,
    type: string,
    body: string | Buffer,
  ) {
    res.writeHead(status, { "content-type": type });
    res.end(body);
  }

  function notFound(res: http.ServerResponse, what: string) {
    send(
      res,
      404,
      "text/html; charset=utf-8",
      shellHtml(
        "not found",
        `<h1>404</h1><p>${escapeHtml(what)} is not a page in the corpus.</p>`,
      ),
    );
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return notFound(res, "malformed path");
    }

    // Home is the complete table of contents — every document, grouped by a
    // facet you choose. The curated entry page is featured at the top rather
    // than being the landing page, so nothing in the corpus is undiscoverable.
    if (path === "/") {
      const s = getState();
      const by = url.searchParams.get("by") ?? "kind";
      const groupBy = ["kind", "topic", "folder"].includes(by) ? by : "kind";
      // The corpus's entry page (config `entryPage`, or the first default
      // candidate present), featured at the top rather than being the landing
      // page. None present is fine — the banner is simply omitted.
      const entryId = config.entryPages.find((id) => s.index.pages.has(id));
      const curated =
        entryId === undefined ? undefined : s.index.pages.get(entryId);
      const featured =
        entryId === undefined || curated === undefined
          ? ""
          : `<p class="featured">Start here: ` +
            `<a href="/page/${entryId}">${escapeHtml(curated.title)}</a>` +
            ` — the corpus's curated entry page.</p>`;
      send(
        res,
        200,
        "text/html; charset=utf-8",
        shellHtml("all documents", featured + tocHtml(s.index, groupBy)),
      );
      return;
    }

    if (path === "/tags") {
      const s = getState();
      const rows = [...s.index.tagIndex.entries()]
        .sort(([a, pa], [b, pb]) => pb.length - pa.length || a.localeCompare(b))
        .map(
          ([tag, ids]) =>
            `<li><a class="chip" href="/tag/${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>` +
            `<span class="count">${ids.length}</span></li>`,
        )
        .join("");
      send(
        res,
        200,
        "text/html; charset=utf-8",
        shellHtml(
          "tags",
          `<div class="pagehead"><h1 class="title">Tags</h1>` +
            `<p class="meta">${s.index.tagIndex.size} tags across ${s.index.pages.size} pages · ` +
            `derived from file shape, declared in frontmatter, or inherited from a concept</p></div>` +
            `<ul class="tag-list">${rows}</ul>`,
        ),
      );
      return;
    }

    if (path.startsWith("/tag/")) {
      const tag = path.slice("/tag/".length).toLowerCase();
      const s = getState();
      const ids = s.index.tagIndex.get(tag);
      if (ids === undefined) return notFound(res, `tag "${tag}"`);
      const rows = ids
        .map((id) => {
          const p = s.index.pages.get(id);
          const source =
            p?.tags.find((t) => t.name === tag)?.source ?? "derived";
          return (
            `<li><a href="/page/${id}">${escapeHtml(p?.title ?? id)}</a>` +
            `<span class="meta"><code>${escapeHtml(id)}</code> · ${source}</span></li>`
          );
        })
        .join("");
      send(
        res,
        200,
        "text/html; charset=utf-8",
        shellHtml(
          `tag: ${tag}`,
          `<div class="pagehead"><h1 class="title">${escapeHtml(tag)}</h1>` +
            `<p class="meta">${ids.length} pages · <a href="/tags">all tags</a></p></div>` +
            `<ul class="toc-list">${rows}</ul>`,
        ),
      );
      return;
    }

    if (path.startsWith("/page/")) {
      const id = path.slice("/page/".length);
      const s = getState();
      const page = s.index.pages.get(id);
      if (page === undefined) return notFound(res, id);
      let content: string;
      try {
        content = readFileSync(join(root, id), "utf8");
      } catch {
        return notFound(res, id); // deleted between walk and request
      }
      const article = renderMarkdown(content, id, s.render);
      const inbound = s.index.backlinks.get(id) ?? [];
      // The article's own H1 is the visible title — no duplicate heading.
      const header =
        `<div class="pagehead">` +
        `<p class="meta"><code>${escapeHtml(id)}</code> · ` +
        `<a href="#backlinks">${inbound.length} backlink edge(s)</a>` +
        (page.aliases.length > 0
          ? ` · aliases: ${page.aliases.map((a) => `<code>${escapeHtml(a)}</code>`).join(" ")}`
          : "") +
        `</p>${tagChipsHtml(page.tags)}</div>`;
      const body = `<div class="doc">${header}<article>${article}</article></div>`;
      send(
        res,
        200,
        "text/html; charset=utf-8",
        shellHtml(page.title, body, {
          sidebar: backlinksPanelHtml(s.render, id),
        }),
      );
      return;
    }

    if (path.startsWith("/raw/")) {
      const id = path.slice("/raw/".length);
      const s = getState();
      // Membership in the walked set is the primary guard (the walk already
      // excludes machine-local files); the isMachineLocal check is defense
      // in depth for the credential class specifically.
      if (isMachineLocal(id, config.machineLocal) || !s.corpus.files.has(id))
        return notFound(res, id);
      const type = RAW_TYPES[extname(id)] ?? "text/plain; charset=utf-8";
      try {
        send(res, 200, type, readFileSync(join(root, id)));
      } catch {
        return notFound(res, id);
      }
      return;
    }

    if (path === "/api/search") {
      const q = url.searchParams.get("q") ?? "";
      const s = getState();
      send(res, 200, "application/json", JSON.stringify(runSearch(s, q, 15)));
      return;
    }

    if (path === "/api/graph.json") {
      const s = getState();
      // ?page=<id> narrows to that page's neighbourhood — the graph tab in
      // the backlinks pane. Unknown ids 404 rather than silently returning
      // the whole corpus, which would look like a rendering bug.
      const focus = url.searchParams.get("page");
      if (focus !== null && !s.index.pages.has(focus))
        return notFound(res, focus);
      send(
        res,
        200,
        "application/json",
        JSON.stringify(graphJson(s.index, focus ?? undefined)),
      );
      return;
    }

    if (path === "/graph") {
      const body =
        `<div class="graph-head"><h1 class="title">Graph</h1>` +
        `<p class="meta">drag to pan · wheel to zoom · click a node to open it · ` +
        `hover to isolate · solid edges are explicit links, faint ones are mentions</p></div>` +
        `<canvas id="graph"></canvas>` +
        `<div id="graph-legend"></div>` +
        `<script type="module" src="/assets/graph-auto.mjs"></script>`;
      send(
        res,
        200,
        "text/html; charset=utf-8",
        shellHtml("graph", body, { wide: true }),
      );
      return;
    }

    if (path === "/orphans") {
      const s = getState();
      const orphans = computeOrphans(s.index);
      const list =
        orphans.length === 0
          ? "<p>No orphans — everything is referenced.</p>"
          : `<ul>${orphans
              .map(
                (id) => `<li><a href="/page/${id}">${escapeHtml(id)}</a></li>`,
              )
              .join("")}</ul>`;
      send(
        res,
        200,
        "text/html; charset=utf-8",
        shellHtml("orphans", `<h1 class="title">Orphan pages</h1>${list}`),
      );
      return;
    }

    if (path.startsWith("/assets/")) {
      const name = path.slice("/assets/".length);
      const type = ASSETS.get(name);
      if (type === undefined) return notFound(res, name);
      send(res, 200, type, readFileSync(join(ASSET_DIR, name)));
      return;
    }

    notFound(res, path);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address !== null ? address.port : port;
  for (const h of ["127.0.0.1", "localhost", "[::1]"]) {
    allowedHosts.add(h);
    allowedHosts.add(`${h}:${actualPort}`);
  }
  return { server, url: `http://127.0.0.1:${actualPort}` };
}

/** Text search plus `tag:` filtering; a bare `tag:x` lists everything
 *  carrying the tag, which is what the search box should do for it. */
function runSearch(s: State, query: string, limit: number): SearchHit[] {
  const { tags, text } = parseQuery(query);
  const matchesTags = (id: string): boolean =>
    tags.every((t) => (s.index.tagIndex.get(t) ?? []).includes(id));

  if (text.trim() === "") {
    if (tags.length === 0) return [];
    return [...s.index.pages.values()]
      .filter((p) => matchesTags(p.id))
      .slice(0, limit)
      .map((p) => ({ id: p.id, title: p.title, score: 1 }));
  }
  return search(s.searchIndex, text, limit + 40)
    .filter((hit) => matchesTags(hit.id))
    .slice(0, limit);
}

export async function serveWiki(opts: ServeOptions): Promise<never> {
  const { url } = await startWikiServer(opts.root, opts.port, opts.config);
  console.log(`docs-wiki serving ${url} (Ctrl-C to stop)`);
  return new Promise<never>(() => {
    // The server holds the event loop open; this promise never settles.
  });
}

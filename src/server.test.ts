import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startWikiServer } from "./server.ts";
import type { RunningServer } from "./server.ts";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/corpus/", import.meta.url),
);

/** fetch() normalizes ../ away — send the raw path to test the server's own
 *  handling of hostile paths (and forge Host headers). */
function rawGet(
  base: string,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname, port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("wiki server (fixture corpus)", () => {
  let running: RunningServer;

  beforeAll(async () => {
    running = await startWikiServer(fixtureRoot, 0);
  });
  afterAll(() => running.server.close());

  it("binds 127.0.0.1 on an ephemeral port", () => {
    const addr = running.server.address();
    expect(typeof addr === "object" && addr !== null && addr.address).toBe(
      "127.0.0.1",
    );
  });

  it("lists pages at / when the corpus has no wiki index page", async () => {
    const res = await fetch(running.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("sub/alpha.md");
  });

  it("lists EVERY page in the table of contents, regrouped by topic and folder", async () => {
    const html = await (await fetch(running.url)).text();
    expect(html).toContain("All documents");
    const { walkCorpus } = await import("./corpus.ts");
    const { buildIndex } = await import("./graph.ts");
    const ids = [...buildIndex(walkCorpus(fixtureRoot)).pages.keys()];
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      expect(
        html.includes(`href="/page/${id}"`),
        `${id} missing from the TOC`,
      ).toBe(true);
    }
    const byTopic = await (await fetch(`${running.url}/?by=topic`)).text();
    expect(byTopic).toContain("concept");
    const byFolder = await (await fetch(`${running.url}/?by=folder`)).text();
    expect(byFolder).toContain("concepts");
    // An unknown facet falls back rather than 500ing.
    expect((await fetch(`${running.url}/?by=nonsense`)).status).toBe(200);
  });

  it("browses tags and filters search by tag:", async () => {
    const tags = await (await fetch(`${running.url}/tags`)).text();
    expect(tags).toContain('href="/tag/concept"');
    const conceptPage = await fetch(`${running.url}/tag/concept`);
    expect(conceptPage.status).toBe(200);
    expect(await conceptPage.text()).toContain("widget.md");
    expect((await fetch(`${running.url}/tag/no-such-tag`)).status).toBe(404);
    const hits = (await (
      await fetch(
        `${running.url}/api/search?q=${encodeURIComponent("tag:concept widget")}`,
      )
    ).json()) as { id: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.id.includes("concepts/"))).toBe(true);
  });

  it("renders a page with rewritten links and a backlinks panel", async () => {
    const res = await fetch(`${running.url}/page/sub/alpha.md`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Alpha</h1>"); // the article's own H1, not duplicated
    expect(html).toContain('href="/page/index.md"'); // [index](../index.md) rewritten
    expect(html).toContain('id="backlinks"');
    expect(html).toContain("Fixture Index"); // referrer title in the panel
    // Fenced shell comment must be inside a code block, not a heading.
    expect(html).toContain("# not a heading");
    expect(html).not.toContain("<h1># not a heading</h1>");
    // Backticked path mention became a link wrapping the code span.
    expect(html).toContain('href="/raw/assets/real.css"');
  });

  it("marks unresolved references dead and links resolved wikilinks", async () => {
    const html = await (await fetch(`${running.url}/page/index.md`)).text();
    expect(html).toContain('href="/page/sub/alpha.md"'); // [[alpha]]
    expect(html).toContain('class="dead"'); // [[nonexistent-page]], [missing](missing.md)
  });

  it("404s for pages outside the index — traversal has nothing to reach", async () => {
    expect((await fetch(`${running.url}/page/missing.md`)).status).toBe(404);
    const traversal = await rawGet(
      running.url,
      "/page/..%2F..%2F..%2Fetc%2Fpasswd",
    );
    expect(traversal.status).toBe(404);
    const rawTraversal = await rawGet(running.url, "/raw/..%2F..%2Fserver.ts");
    expect(rawTraversal.status).toBe(404);
  });

  it("serves raw source files that the corpus walk recorded", async () => {
    const res = await fetch(`${running.url}/raw/assets/real.css`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("rebeccapurple");
  });

  it("serves search results and the graph JSON", async () => {
    const hits = (await (
      await fetch(`${running.url}/api/search?q=widget`)
    ).json()) as {
      id: string;
    }[];
    expect(hits.map((h) => h.id)).toContain("concepts/widget.md");

    const graph = (await (
      await fetch(`${running.url}/api/graph.json`)
    ).json()) as {
      nodes: { id: string }[];
      links: { source: string; target: string; explicit: boolean }[];
    };
    expect(graph.nodes.map((n) => n.id)).toContain("sub/alpha.md");
    expect(
      graph.links.some(
        (l) => l.source === "index.md" && l.target === "sub/alpha.md",
      ),
    ).toBe(true);
  });

  it("serves every asset the pages actually import", async () => {
    // A module missing from the allowlist 404s and the page silently renders
    // blank — which is exactly how the graph broke once.
    for (const name of [
      "style.css",
      "app.mjs",
      "graph.mjs",
      "graph-auto.mjs",
      "layout.mjs",
      "pane-graph.mjs",
    ]) {
      const res = await fetch(`${running.url}/assets/${name}`);
      expect(res.status, name).toBe(200);
    }
    // Walk the real import statements rather than trusting the list above:
    // relative `from "./x.mjs"` and the lazy `import("/assets/x.mjs")`.
    for (const entry of [
      "graph-auto.mjs",
      "graph.mjs",
      "app.mjs",
      "pane-graph.mjs",
    ]) {
      const src = await (await fetch(`${running.url}/assets/${entry}`)).text();
      for (const m of src.matchAll(/from\s+"\.\/([\w.-]+)"/g)) {
        expect(
          (await fetch(`${running.url}/assets/${m[1]}`)).status,
          `${entry} → ${m[1]}`,
        ).toBe(200);
      }
      for (const m of src.matchAll(/import\(\s*"\/assets\/([\w.-]+)"\s*\)/g)) {
        expect(
          (await fetch(`${running.url}/assets/${m[1]}`)).status,
          `${entry} → ${m[1]}`,
        ).toBe(200);
      }
    }
  });

  it("serves a page's ego network at /api/graph.json?page=", async () => {
    const full = (await (
      await fetch(`${running.url}/api/graph.json`)
    ).json()) as {
      nodes: unknown[];
      links: { source: string; target: string }[];
    };
    const ego = (await (
      await fetch(`${running.url}/api/graph.json?page=sub/alpha.md`)
    ).json()) as {
      nodes: { id: string; focus?: boolean }[];
      links: { source: string; target: string }[];
    };

    // Every edge touches the focus — neighbour-to-neighbour edges would turn
    // a hub's pane into a blob.
    expect(ego.links.length).toBeGreaterThan(0);
    for (const l of ego.links) {
      expect(l.source === "sub/alpha.md" || l.target === "sub/alpha.md").toBe(
        true,
      );
    }
    expect(ego.links.length).toBeLessThanOrEqual(full.links.length);
    expect(ego.nodes.filter((n) => n.focus).map((n) => n.id)).toEqual([
      "sub/alpha.md",
    ]);
    // Every node in the view is an endpoint of a returned edge.
    const endpoints = new Set(ego.links.flatMap((l) => [l.source, l.target]));
    for (const n of ego.nodes) expect(endpoints.has(n.id), n.id).toBe(true);
  });

  it("sends the CORPUS-wide group list so colours agree across views", async () => {
    const full = (await (
      await fetch(`${running.url}/api/graph.json`)
    ).json()) as {
      groups: string[];
      nodes: { group: string }[];
    };
    const ego = (await (
      await fetch(`${running.url}/api/graph.json?page=sub/alpha.md`)
    ).json()) as { groups: string[]; nodes: { group: string }[] };

    // Identical in both payloads — clients colour by index into this list, so
    // if the ego view sent only its OWN groups, "docs" would be one colour on
    // the corpus graph and another in a page's pane.
    expect(ego.groups).toEqual(full.groups);
    expect(ego.groups.length).toBeGreaterThan(0);
    expect([...ego.groups].sort()).toEqual(ego.groups); // sorted = stable order
    // Every node's group is in the list, or its colour index would be -1.
    for (const n of [...full.nodes, ...ego.nodes]) {
      expect(ego.groups.includes(n.group), n.group).toBe(true);
    }
  });

  it("gives both graphs a legend container", async () => {
    const html = await (await fetch(`${running.url}/page/sub/alpha.md`)).text();
    expect(html).toContain('id="pane-graph-legend"');
    expect(html).toContain('id="pane-graph-full-legend"');
  });

  it("404s an ego network for a page that is not in the corpus", async () => {
    expect(
      (await fetch(`${running.url}/api/graph.json?page=nope.md`)).status,
    ).toBe(404);
  });

  it("serves only allowlisted assets — including against prototype-chain keys", async () => {
    const css = await fetch(`${running.url}/assets/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect((await rawGet(running.url, "/assets/..%2Fserver.ts")).status).toBe(
      404,
    );
    for (const key of ["toString", "__proto__", "constructor"]) {
      expect((await rawGet(running.url, `/assets/${key}`)).status, key).toBe(
        404,
      );
    }
  });

  it("rejects forged Host headers (DNS-rebinding guard)", async () => {
    const forged = await rawGet(running.url, "/", { host: "evil.example.com" });
    expect(forged.status).toBe(403);
    const legit = await rawGet(running.url, "/orphans", {
      host: new URL(running.url).host,
    });
    expect(legit.status).toBe(200);
  });

  it("404s malformed percent-encoding without echoing internals", async () => {
    const r = await rawGet(running.url, "/page/%zz");
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("URI");
    expect(r.body).not.toContain(fixtureRoot);
  });

  it("serves the graph and orphans pages", async () => {
    const graph = await fetch(`${running.url}/graph`);
    expect(graph.status).toBe(200);
    const html = await graph.text();
    expect(html).toContain('id="graph"'); // canvas the layout draws into
    expect(html).toContain('id="graph-legend"'); // group colour key
    expect(html).toContain('src="/assets/graph-auto.mjs"');
    expect(html).toContain('<main class="wide"'); // full-bleed, not the doc column

    const orphans = await (await fetch(`${running.url}/orphans`)).text();
    expect(orphans).toContain("orphan.md");
  });

  it("puts backlinks in a side pane, grouped by referring page", async () => {
    const html = await (await fetch(`${running.url}/page/sub/alpha.md`)).text();
    expect(html).toContain('<main class="with-pane">');
    // The pane follows the article in source order (it is a reading aid, and
    // screen readers should reach the document first).
    expect(html.indexOf("<article>")).toBeLessThan(
      html.indexOf('id="backlinks"'),
    );
    expect(html).toContain("Linked from");
  });

  it("offers an enlarged view of the pane graph", async () => {
    const html = await (await fetch(`${running.url}/page/sub/alpha.md`)).text();
    expect(html).toContain('id="graph-expand"');
    // A native <dialog>: Escape and backdrop dismissal come from the
    // platform. If this ever becomes a <div>, that behaviour must be
    // hand-rolled and this assertion should be what stops it silently.
    expect(html).toMatch(/<dialog id="graph-modal"[^>]*>/);
    expect(html).toContain('id="pane-graph-full"');
    expect(html).toContain('id="graph-modal-close"');
    // The enlarged canvas is a SECOND canvas, not the pane's one relocated.
    expect(html).toContain('id="pane-graph"');
    expect(html.indexOf('id="pane-graph"')).toBeLessThan(
      html.indexOf('id="pane-graph-full"'),
    );
  });

  it("offers list and graph tabs over the same relationships", async () => {
    const html = await (await fetch(`${running.url}/page/sub/alpha.md`)).text();
    expect(html).toContain('data-page="sub/alpha.md"'); // what the tab graph queries
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="tab-list"');
    expect(html).toContain('id="tab-graph"');
    expect(html).toContain('id="pane-graph"');
    // The list is the default view; the graph panel starts hidden.
    expect(html).toMatch(/id="tab-list"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="panel-graph"[^>]*hidden/);
  });

  it("never serves machine-local credential files at /raw/", async () => {
    // Asserting 404 for these against the REPO root is decorative: a worktree
    // and CI have no .env.local, so it would pass for a file that simply does
    // not exist. This asserts it where the files really do exist, and proves
    // the server would otherwise have served them by fetching a sibling.
    const tmp = mkdtempSync(join(tmpdir(), "docs-wiki-raw-"));
    try {
      mkdirSync(join(tmp, "apps/web"), { recursive: true });
      writeFileSync(join(tmp, "README.md"), "# Root\n\nSee `notes.txt`.\n");
      writeFileSync(join(tmp, "notes.txt"), "not a secret\n");
      writeFileSync(join(tmp, ".env.local"), "DATABASE_URL=postgres://real\n");
      writeFileSync(join(tmp, ".envrc"), "export AWS_SECRET=hunter2\n");
      writeFileSync(join(tmp, "apps/web/.env.local"), "API_SECRET=not-a-real-secret\n");
      writeFileSync(join(tmp, ".dev.vars"), "DEMO_API_KEY=zzz\n");

      const srv = await startWikiServer(tmp, 0);
      try {
        // The control: an ordinary file in the same root IS served, so a 404
        // below is the guard working, not the route being broken.
        const ok = await fetch(`${srv.url}/raw/notes.txt`);
        expect(ok.status).toBe(200);
        expect(await ok.text()).toContain("not a secret");

        for (const p of [
          "/raw/.env.local",
          "/raw/.envrc",
          "/raw/apps/web/.env.local",
          "/raw/.dev.vars",
        ]) {
          const res = await fetch(`${srv.url}${p}`);
          expect(res.status, p).toBe(404);
          expect(await res.text(), p).not.toContain("SECRET");
        }
      } finally {
        srv.server.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

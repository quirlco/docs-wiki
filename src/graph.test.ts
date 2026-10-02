import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkCorpus } from "./corpus.ts";
import { buildIndex, computeOrphans } from "./graph.ts";
import { memCorpus } from "./test-helpers.ts";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/corpus/", import.meta.url),
);
const index = buildIndex(walkCorpus(fixtureRoot));

describe("buildIndex on the fixture corpus", () => {
  it("enforces every page — this fixture exempts nothing, not even tasks/**", () => {
    // Some repos exempt a high-churn tasks/ tree. This fixture has no such
    // corner, so scopeFor is a constant here. Pin it: a re-introduced exemption would
    // silently let broken links through the gate the docs contract names.
    for (const [id, page] of index.pages) {
      expect(page.scope, id).toBe("enforced");
    }
    expect(index.pages.get("tasks/BLOCKERS.md")?.scope).toBe("enforced");
  });

  it("inverts backlinks with edge types preserved", () => {
    const bl = index.backlinks.get("sub/alpha.md") ?? [];
    const froms = new Set(bl.map((e) => e.from));
    expect(froms.has("index.md")).toBe(true); // explicit link + wikilinks
    expect(froms.has("concepts/widget.md")).toBe(true); // explicit link
    expect(bl.some((e) => e.type === "link")).toBe(true);
    expect(bl.some((e) => e.type === "wikilink")).toBe(true);
  });

  it("resolves root-style and relative links to the same target", () => {
    const out = index.pages.get("index.md")?.outEdges ?? [];
    const toAlpha = out.filter(
      (e) => e.type === "link" && e.to === "sub/alpha.md",
    );
    expect(toAlpha.length).toBeGreaterThanOrEqual(3); // plain, leading-slash, anchored
    expect(toAlpha.some((e) => e.anchor === "section-one")).toBe(true);
  });

  it("marks the ambiguous wikilink with both candidates", () => {
    const out = index.pages.get("index.md")?.outEdges ?? [];
    const notes = out.find((e) => e.raw === "[[notes]]");
    expect(notes).toMatchObject({ to: null, unresolved: "ambiguous" });
    expect(notes?.candidates?.sort()).toEqual([
      "other/notes.md",
      "sub/notes.md",
    ]);
  });

  it("marks the broken link and broken wikilink unresolved", () => {
    const out = index.pages.get("index.md")?.outEdges ?? [];
    expect(out.find((e) => e.raw === "[missing](missing.md)")).toMatchObject({
      to: null,
      unresolved: "not-found",
    });
    expect(out.find((e) => e.raw === "[[nonexistent-page]]")).toMatchObject({
      to: null,
      unresolved: "not-found",
    });
  });

  it("maps ADR ids to decision pages", () => {
    expect(index.adrIndex.get("ADR-0007")).toBe(
      "decisions/0007-fixture-decision.md",
    );
  });

  it("links blocker mentions to the BLOCKERS heading anchor", () => {
    const out = index.pages.get("index.md")?.outEdges ?? [];
    const b7 = out.find((e) => e.type === "mention-blocker");
    expect(b7).toMatchObject({
      to: "tasks/BLOCKERS.md",
      anchor: "b7--fixture-blocker",
    });
  });

  it("registers concept aliases without collisions", () => {
    expect(index.aliasIndex.get("the widget engine")).toBe(
      "concepts/widget.md",
    );
    expect(index.aliasCollisions).toEqual([]);
  });

  it("existence-checks path mentions from alpha.md", () => {
    const out = index.pages.get("sub/alpha.md")?.outEdges ?? [];
    const paths = out.filter((e) => e.type === "mention-path");
    expect(paths.find((e) => e.raw === "assets/real.css")).toMatchObject({
      to: "assets/real.css",
      targetKind: "source-file",
    });
    expect(paths.find((e) => e.raw === "sub/nope.ts")).toMatchObject({
      to: null,
      unresolved: "not-found",
    });
  });

  it("computes orphans (nothing in, regardless of out)", () => {
    const orphans = computeOrphans(index);
    expect(orphans).toContain("orphan.md");
    expect(orphans).toContain("fence-eof.md");
    for (const linked of [
      "sub/alpha.md",
      "tasks/BLOCKERS.md",
      "concepts/widget.md",
    ]) {
      expect(orphans).not.toContain(linked);
    }
  });
});

describe("buildIndex edge cases (in-memory)", () => {
  it("records duplicate alias claims as collisions", () => {
    const idx = buildIndex(
      memCorpus({
        "a.md": "---\naliases: [thing]\n---\n# A\n",
        "b.md": "---\naliases: [Thing]\n---\n# B\n",
      }),
    );
    expect(idx.aliasCollisions).toEqual([
      { alias: "thing", pages: ["a.md", "b.md"] },
    ]);
  });

  it("existence-checks directory links by prefix", () => {
    const idx = buildIndex(
      memCorpus({
        "README.md":
          "# R\n\n[decisions](docs/decisions/) and [gone](docs/missing/)\n",
        "docs/decisions/0001-x.md": "# ADR-0001: X\n",
      }),
    );
    const out = idx.pages.get("README.md")?.outEdges ?? [];
    expect(out.find((e) => e.raw.includes("docs/decisions/"))).toMatchObject({
      to: "docs/decisions",
      targetKind: "source-file",
    });
    expect(out.find((e) => e.raw.includes("docs/missing/"))).toMatchObject({
      to: null,
      unresolved: "not-found",
    });
  });

  it("resolves source-file links relative to the page, then the root", () => {
    const idx = buildIndex(
      memCorpus({
        "docs/a.md":
          "# A\n\n![logo](../assets/logo.svg) [code](packages/core/src/x.ts)\n",
        "assets/logo.svg": "",
        "packages/core/src/x.ts": "",
      }),
    );
    const out = idx.pages.get("docs/a.md")?.outEdges ?? [];
    expect(out.find((e) => e.raw.includes("logo"))).toMatchObject({
      to: "assets/logo.svg",
    });
    expect(out.find((e) => e.raw.includes("x.ts"))).toMatchObject({
      to: "packages/core/src/x.ts",
    });
  });
});

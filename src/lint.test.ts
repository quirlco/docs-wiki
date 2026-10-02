import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkCorpus } from "./corpus.ts";
import { buildIndex } from "./graph.ts";
import { hasEnforced, lintIndex } from "./lint.ts";
import { resolveConfig } from "./config.ts";
import { memCorpus } from "./test-helpers.ts";
import type { WikiConfig } from "./config.ts";
import type { Corpus } from "./corpus.ts";
import type { LintFinding } from "./types.ts";

function lint(corpus: Corpus): LintFinding[] {
  return lintIndex(corpus, buildIndex(corpus));
}

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/corpus/", import.meta.url),
);
const findings = lint(walkCorpus(fixtureRoot));
const byCode = (code: string) => findings.filter((f) => f.code === code);

describe("lintIndex on the fixture corpus", () => {
  it("finds the broken explicit link (E001, enforced)", () => {
    const e = byCode("E001");
    expect(
      e.some((f) => f.page === "index.md" && f.message.includes("missing.md")),
    ).toBe(true);
    expect(e.find((f) => f.page === "index.md")?.severity).toBe("enforced");
  });

  it("finds the broken wikilink (E002) and the ambiguous one (E003)", () => {
    expect(
      byCode("E002").some((f) => f.message.includes("[[nonexistent-page]]")),
    ).toBe(true);
    const e3 = byCode("E003");
    expect(e3).toHaveLength(1);
    expect(e3[0].message).toContain("other/notes.md");
    expect(e3[0].message).toContain("sub/notes.md");
  });

  it("reports dead mentions (E004) as report-only everywhere", () => {
    const e4 = byCode("E004");
    expect(e4.some((f) => f.message.includes("sub/nope.ts"))).toBe(true);
    expect(e4.some((f) => f.message.includes("ADR-0099"))).toBe(true);
    expect(e4.every((f) => f.severity === "reported")).toBe(true);
  });

  it("finds the broken intra-doc anchor (E006)", () => {
    expect(
      byCode("E006").some((f) => f.message.includes("#does-not-exist")),
    ).toBe(true);
  });

  it("enforces a broken link wherever it lives, tasks/** included", () => {
    // The counterpart of graph.test.ts's scope invariant, at the severity
    // layer: a broken link is enforced by WHAT it is, never by WHERE it sits.
    const blockers = findings.filter(
      (f) => f.page === "tasks/BLOCKERS.md" && f.code === "E001",
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0].severity).toBe("enforced");
  });

  it("lists orphans as W001, report-only", () => {
    const w = byCode("W001");
    expect(w.some((f) => f.page === "orphan.md")).toBe(true);
    expect(w.every((f) => f.severity === "reported")).toBe(true);
  });

  it("has enforced findings overall (the fixture corpus is deliberately broken)", () => {
    expect(hasEnforced(findings)).toBe(true);
  });
});

describe("lintIndex on clean and colliding corpora", () => {
  it("returns zero findings for a fully-linked clean corpus", () => {
    const clean = lint(
      memCorpus({
        "a.md": "# A\n\nSee [b](b.md).\n",
        "b.md": "# B\n\nBack to [[a]].\n",
      }),
    );
    expect(clean).toEqual([]);
  });

  it("raises E005 (enforced) on duplicate alias claims", () => {
    const collided = lint(
      memCorpus({
        "a.md": "---\naliases: [thing]\n---\n# A\n\n[b](b.md)\n",
        "b.md": "---\naliases: [thing]\n---\n# B\n\n[a](a.md)\n",
      }),
    );
    const e5 = collided.filter((f) => f.code === "E005");
    expect(e5).toHaveLength(1);
    expect(e5[0].severity).toBe("enforced");
  });

  it("validates anchors on resolved links (E006) against target headings", () => {
    const bad = lint(
      memCorpus({
        "a.md": "# A\n\n[b](b.md#nope)\n",
        "b.md": "# B\n\n[a](a.md)\n\n## Real Section\n",
      }),
    );
    expect(bad.filter((f) => f.code === "E006")).toHaveLength(1);
    const good = lint(
      memCorpus({
        "a.md": "# A\n\n[b](b.md#real-section)\n",
        "b.md": "# B\n\n[a](a.md)\n\n## Real Section\n",
      }),
    );
    expect(good.filter((f) => f.code === "E006")).toHaveLength(0);
  });
});

describe("W003 skill or persona page malformed", () => {
  it("reports a malformed skill — report-only, pointing at the guide", () => {
    const findings = lint(
      memCorpus({
        "docs/skills/bad.md": "# bad\n\nNo status, no moves.\n\n## When\n\n- x\n",
      }),
    );
    const w3 = findings.filter((f) => f.code === "W003");
    expect(w3).toHaveLength(1);
    expect(w3[0].severity).toBe("reported");
    expect(w3[0].line).toBe(1); // the H1's line
    expect(w3[0].message).toContain('missing "Moves" section');
    expect(w3[0].message).toContain("missing Status line");
    expect(w3[0].message).toContain("docs-wiki guide");
    // never enforced: a malformed draft must not block the PR fixing it
    expect(hasEnforced(findings)).toBe(false);
  });

  it("names an off-vocabulary status", () => {
    const findings = lint(
      memCorpus({
        "docs/personas/p.md":
          "# p\n\nStatus: experimental\n\n## When to adopt\n\n- x\n\n## Stance\n\n- y\n",
      }),
    );
    const w3 = findings.filter((f) => f.code === "W003");
    expect(w3).toHaveLength(1);
    expect(w3[0].message).toContain('unknown status "experimental"');
  });

  it("is silent on a conforming corpus", () => {
    const findings = lint(
      memCorpus({
        "docs/skills/good.md":
          "# good\n\nStatus: active\n\n## When\n\n- x\n\n## Moves\n\n1. y\n",
      }),
    );
    expect(findings.filter((f) => f.code === "W003")).toEqual([]);
  });

  it("is off entirely when the skills layer is disabled", () => {
    const findings = lint(
      memCorpus(
        { "docs/skills/bad.md": "# bad\n" },
        resolveConfig({ skills: false }),
      ),
    );
    expect(findings.filter((f) => f.code === "W003")).toEqual([]);
  });
});

describe("W002 long page", () => {
  // Both signals have to agree. Length alone would flag a thorough ADR about
  // one decision, and section count alone would flag a well-structured short
  // page — neither is the thing worth asking about.
  const page = (lines: number, sections: number) =>
    [
      "# Title",
      ...Array.from({ length: sections }, (_, i) => `## Section ${i + 1}`),
      ...Array.from({ length: Math.max(0, lines - sections - 1) }, () => "body"),
      "",
    ].join("\n");

  const w002 = (files: Record<string, string>, config?: WikiConfig) =>
    lint(config ? memCorpus(files, config) : memCorpus(files)).filter(
      (f) => f.code === "W002",
    );

  it("fires when a page is both long and many-sectioned", () => {
    const found = w002({ "a.md": page(500, 8) });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("reported");
    expect(found[0].message).toMatch(/long page — 500 lines across 8 sections/);
  });

  it("leaves a long page about ONE subject alone", () => {
    // A 600-line ADR is fine. This is the case a naive line cap gets wrong.
    expect(w002({ "a.md": page(600, 3) })).toHaveLength(0);
  });

  it("leaves a short, well-structured page alone", () => {
    expect(w002({ "a.md": page(120, 9) })).toHaveLength(0);
  });

  it("counts H2s, not every heading", () => {
    const deep = [
      "# Title",
      "## One",
      ...Array.from({ length: 8 }, (_, i) => `### Sub ${i}`),
      ...Array.from({ length: 500 }, () => "body"),
      "",
    ].join("\n");
    expect(w002({ "a.md": deep })).toHaveLength(0);
  });

  it("is never enforced, whatever the page's scope", () => {
    const found = lint(memCorpus({ "a.md": page(500, 8) }));
    expect(hasEnforced(found)).toBe(false);
  });

  it("honours configured thresholds", () => {
    const strict = resolveConfig({ longPage: { lines: 50, sections: 2 } });
    expect(w002({ "a.md": page(100, 4) }, strict)).toHaveLength(1);
  });

  it("can be turned off entirely", () => {
    expect(w002({ "a.md": page(500, 8) }, resolveConfig({ longPage: false }))).toHaveLength(0);
    expect(
      w002({ "a.md": page(500, 8) }, resolveConfig({ longPage: { enabled: false } })),
    ).toHaveLength(0);
  });
});

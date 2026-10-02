import { describe, expect, it } from "vitest";

import { buildIndex } from "./graph.ts";
import { memCorpus } from "./test-helpers.ts";
import type { Edge } from "./types.ts";

function edgesFrom(files: Record<string, string>, page: string): Edge[] {
  const index = buildIndex(memCorpus(files));
  return index.pages.get(page)?.outEdges ?? [];
}

describe("mention-adr", () => {
  it("matches exactly four digits, word-bounded", () => {
    const edges = edgesFrom(
      {
        "docs/decisions/0007-x.md": "# ADR-0007: X\n",
        "note.md": "See ADR-0007 but never ADR-00071 or XADR-0007.\n",
      },
      "note.md",
    );
    const adr = edges.filter((e) => e.type === "mention-adr");
    expect(adr).toHaveLength(1);
    expect(adr[0]).toMatchObject({
      to: "docs/decisions/0007-x.md",
      raw: "ADR-0007",
    });
  });

  it("records unknown ADR ids as unresolved mentions", () => {
    const edges = edgesFrom(
      {
        "docs/decisions/0007-x.md": "# ADR-0007: X\n",
        "note.md": "ADR-0099 never existed.\n",
      },
      "note.md",
    );
    const dead = edges.filter((e) => e.type === "mention-adr");
    expect(dead[0]).toMatchObject({ to: null, unresolved: "not-found" });
  });

  it("never emits a self-mention (an ADR cites its own id in its title)", () => {
    const edges = edgesFrom(
      {
        "docs/decisions/0007-x.md":
          "# ADR-0007: X\n\nADR-0007 supersedes nothing.\n",
      },
      "docs/decisions/0007-x.md",
    );
    expect(edges.filter((e) => e.type === "mention-adr")).toHaveLength(0);
  });
});

describe("mention-blocker", () => {
  const files = {
    "tasks/BLOCKERS.md": "# Blockers\n\n### B7 — Something\n\ntext\n",
    "note.md": "B2B business. B7 works. B99 has no heading. B7x is a typo.\n",
  };

  it("links only ids with a matching heading, word-bounded, with an anchor", () => {
    const blocker = edgesFrom(files, "note.md").filter(
      (e) => e.type === "mention-blocker",
    );
    expect(blocker).toHaveLength(1);
    expect(blocker[0]).toMatchObject({
      to: "tasks/BLOCKERS.md",
      raw: "B7",
      anchor: "b7--something",
    });
  });

  it("emits nothing when the corpus has no BLOCKERS.md", () => {
    const edges = edgesFrom({ "note.md": "B7 exists nowhere.\n" }, "note.md");
    expect(edges.filter((e) => e.type === "mention-blocker")).toHaveLength(0);
  });
});

describe("mention-path", () => {
  const base = {
    "docs/guide.md": "# Guide\n",
    "packages/core/src/tenant.ts": "",
    "tasks/TODO.md": "# TODO\n",
    "a/README.md": "# A\n",
    "b/README.md": "# B\n",
  };

  it("resolves existing .md paths and existing source paths", () => {
    const edges = edgesFrom(
      {
        ...base,
        "note.md": "See docs/guide.md and packages/core/src/tenant.ts today.\n",
      },
      "note.md",
    );
    const paths = edges.filter((e) => e.type === "mention-path");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ to: "docs/guide.md", targetKind: "page" });
    expect(paths[1]).toMatchObject({
      to: "packages/core/src/tenant.ts",
      targetKind: "source-file",
    });
  });

  it("strips trailing punctuation and :line suffixes", () => {
    const edges = edgesFrom(
      {
        ...base,
        "note.md":
          "(see docs/guide.md). And packages/core/src/tenant.ts:251!\n",
      },
      "note.md",
    );
    const raws = edges
      .filter((e) => e.type === "mention-path")
      .map((e) => e.raw);
    expect(raws).toEqual(["docs/guide.md", "packages/core/src/tenant.ts"]);
  });

  it("marks nonexistent paths unresolved (the E004 feed)", () => {
    const edges = edgesFrom(
      { ...base, "note.md": "docs/gone.md and packages/nope.ts\n" },
      "note.md",
    );
    const dead = edges.filter((e) => e.type === "mention-path");
    expect(
      dead.every((e) => e.to === null && e.unresolved === "not-found"),
    ).toBe(true);
    expect(dead).toHaveLength(2);
  });

  it("skips globs, URLs, and version-number lookalikes", () => {
    const edges = edgesFrom(
      {
        ...base,
        "note.md":
          "Glob apps/web/migrations/*.sql, URL https://example.com/docs/x.md, score 9.9/10.\n",
      },
      "note.md",
    );
    expect(edges.filter((e) => e.type === "mention-path")).toHaveLength(0);
  });

  it("resolves unique bare basenames and stays silent on ambiguous ones", () => {
    const edges = edgesFrom(
      { ...base, "note.md": "Update TODO.md but README.md is ambiguous.\n" },
      "note.md",
    );
    const paths = edges.filter((e) => e.type === "mention-path");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ to: "tasks/TODO.md", raw: "TODO.md" });
  });

  it("never double-counts explicit link targets or labels as mentions", () => {
    const edges = edgesFrom(
      {
        ...base,
        "concepts/guide.md": "---\naliases: [guide]\n---\n# Guide concept\n",
        "note.md": "# N\n\nA [guide link](docs/guide.md) and [[TODO]] here.\n",
      },
      "note.md",
    );
    expect(edges.filter((e) => e.type.startsWith("mention"))).toHaveLength(0);
    expect(
      edges.filter((e) => e.type === "link" || e.type === "wikilink"),
    ).toHaveLength(2);
  });

  it("does not re-match the basename tail of a full path", () => {
    const edges = edgesFrom(
      { ...base, "note.md": "docs/guide.md once.\n" },
      "note.md",
    );
    expect(edges.filter((e) => e.type === "mention-path")).toHaveLength(1);
  });

  it("never existence-checks machine-local gitignored paths", () => {
    const edges = edgesFrom(
      {
        ...base,
        "note.md":
          "Set apps/web/.env.local and .dev.vars; agents run in " +
          ".claude/worktrees/agent-abc123 with node_modules/x/y.js around.\n",
      },
      "note.md",
    );
    expect(edges.filter((e) => e.type === "mention-path")).toHaveLength(0);
  });

  it("produces no mentions from fenced content", () => {
    const edges = edgesFrom(
      {
        ...base,
        "note.md": "# N\n\n```\ndocs/guide.md ADR-0007 B7 tasks/TODO.md\n```\n",
      },
      "note.md",
    );
    expect(edges).toHaveLength(0);
  });
});

describe("mention-alias", () => {
  const files = {
    "concepts/widget.md":
      "---\naliases: [widget, the widget engine]\n---\n\n# Widget\n",
    "note.md":
      "# N\n\nThe widget engine is neat. A widget indeed. Widgetry is not a word match.\n",
  };

  it("matches longest-first, case-insensitively, one edge per target", () => {
    const alias = edgesFrom(files, "note.md").filter(
      (e) => e.type === "mention-alias",
    );
    expect(alias).toHaveLength(1);
    expect(alias[0].to).toBe("concepts/widget.md");
    // Longest alternative won at the shared position.
    expect(alias[0].raw.toLowerCase()).toBe("the widget engine");
  });

  it("never matches an alias inside a file path", () => {
    const alias = edgesFrom(
      {
        "concepts/blockers.md":
          "---\naliases: [blockers]\n---\n\n# Blockers concept\n",
        "tasks/BLOCKERS.md": "# B\n",
        "note.md": "# N\n\nCheck tasks/BLOCKERS.md for details.\n",
        "other.md": "# O\n\nOpen blockers gate the work.\n",
      },
      "note.md",
    ).filter((e) => e.type === "mention-alias");
    expect(alias).toHaveLength(0); // the path line must not alias-match

    const prose = edgesFrom(
      {
        "concepts/blockers.md":
          "---\naliases: [blockers]\n---\n\n# Blockers concept\n",
        "tasks/BLOCKERS.md": "# B\n",
        "other.md": "# O\n\nOpen blockers gate the work.\n",
      },
      "other.md",
    ).filter((e) => e.type === "mention-alias");
    expect(prose).toHaveLength(1); // plain prose still matches
  });

  it("never emits a self-mention from the concept page itself", () => {
    const alias = edgesFrom(
      {
        ...files,
        "concepts/widget.md":
          files["concepts/widget.md"] + "\nA widget is a widget.\n",
      },
      "concepts/widget.md",
    ).filter((e) => e.type === "mention-alias");
    expect(alias).toHaveLength(0);
  });
});

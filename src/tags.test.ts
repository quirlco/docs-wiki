import { describe, expect, it } from "vitest";

import { buildIndex } from "./graph.ts";
import { memCorpus } from "./test-helpers.ts";
import type { Tag } from "./types.ts";

const names = (tags: Tag[]): string[] => tags.map((t) => t.name);
const sourceOf = (tags: Tag[], name: string): string | undefined =>
  tags.find((t) => t.name === name)?.source;

describe("derived tags (default kinds — the built-in taxonomy)", () => {
  const index = buildIndex(
    memCorpus({
      "docs/decisions/0007-fixture.md":
        "# ADR-0007\n\nDate: 2026-01-01 · Status: accepted\n",
      "docs/runbooks/deploy.md": "# Deploy\n",
      "docs/concepts/Sync-Protocol.md": "# Sync\n",
      "docs/design/Layout.md": "# Layout\n",
      "tasks/done/M1.md": "# M1\n",
      "tasks/TODO.md": "# TODO\n",
      "docs/Stray.md": "# Stray\n",
      "README.md": "# Readme\n",
      "tools/docs-wiki/README.md": "# Wiki\n",
      "docs/concepts/Tenant.md":
        "---\naliases: [tenant]\ntags: [multi-tenancy]\n---\n# Tenant\n",
    }),
  );
  const tagsOf = (id: string): Tag[] => index.pages.get(id)?.tags ?? [];

  it("classifies by the ordered kind rules, first match winning", () => {
    expect(names(tagsOf("docs/decisions/0007-fixture.md"))).toContain("adr");
    expect(names(tagsOf("docs/runbooks/deploy.md"))).toContain("runbook");
    expect(names(tagsOf("docs/concepts/Sync-Protocol.md"))).toContain("concept");
    expect(names(tagsOf("docs/design/Layout.md"))).toContain("design");
    // tasks/done/ must win over the broader tasks/ rule.
    expect(names(tagsOf("tasks/done/M1.md"))).toContain("milestone");
    expect(names(tagsOf("tasks/done/M1.md"))).not.toContain("planning");
    expect(names(tagsOf("tasks/TODO.md"))).toContain("planning");
    expect(names(tagsOf("docs/Stray.md"))).toContain("reference");
    expect(names(tagsOf("README.md"))).toContain("root");
  });

  it("scrapes Status: into status:<value> for statusLine kinds only", () => {
    expect(names(tagsOf("docs/decisions/0007-fixture.md"))).toContain(
      "status:accepted",
    );
    for (const id of index.pages.keys()) {
      if (id === "docs/decisions/0007-fixture.md") continue;
      expect(
        names(tagsOf(id)).some((n) => n.startsWith("status:")),
        id,
      ).toBe(false);
    }
  });

  it("leaves a page matching no rule untagged — the default has no catch-all", () => {
    expect(tagsOf("tools/docs-wiki/README.md")).toEqual([]);
  });

  it("marks declared frontmatter tags as declared, derived ones as derived", () => {
    const tags = tagsOf("docs/concepts/Tenant.md");
    expect(sourceOf(tags, "multi-tenancy")).toBe("declared");
    expect(sourceOf(tags, "concept")).toBe("derived");
  });
});

describe("inherited tags", () => {
  const concept =
    "---\naliases: [tenant]\ntags: [multi-tenancy]\n---\n\n# Tenant\n\nA tenant page.\n";

  it("inherits a concept's topics only when a page leans on it", () => {
    const index = buildIndex(
      memCorpus({
        "docs/wiki/concepts/tenant.md": concept,
        // Three mentions — over the threshold.
        "heavy.md": "# Heavy\n\ntenant one\n\ntenant two\n\ntenant three\n",
        // A single passing mention must NOT make this a multi-tenancy doc.
        "light.md": "# Light\n\nOne passing tenant reference.\n",
      }),
    );
    expect(names(index.pages.get("heavy.md")?.tags ?? [])).toContain(
      "multi-tenancy",
    );
    expect(
      sourceOf(index.pages.get("heavy.md")?.tags ?? [], "multi-tenancy"),
    ).toBe("inherited");
    expect(names(index.pages.get("light.md")?.tags ?? [])).not.toContain(
      "multi-tenancy",
    );
  });

  it("treats one explicit link as enough to inherit", () => {
    const index = buildIndex(
      memCorpus({
        "docs/wiki/concepts/tenant.md": concept,
        "linked.md":
          "# Linked\n\nSee [the concept](docs/wiki/concepts/tenant.md).\n",
      }),
    );
    expect(names(index.pages.get("linked.md")?.tags ?? [])).toContain(
      "multi-tenancy",
    );
  });

  it("never lets an inherited tag outrank a declared one", () => {
    const index = buildIndex(
      memCorpus({
        "docs/wiki/concepts/tenant.md": concept,
        "own.md":
          "---\ntags: [multi-tenancy]\n---\n\n# Own\n\ntenant tenant tenant\n",
      }),
    );
    expect(
      sourceOf(index.pages.get("own.md")?.tags ?? [], "multi-tenancy"),
    ).toBe("declared");
  });
});

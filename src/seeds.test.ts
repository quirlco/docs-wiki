// THE SEEDS SHIP PRE-VALIDATED: every seed file must satisfy the exact
// contract `docs-wiki check` verifies in adopting repos — a seed set that trips
// its own W003 would teach the format by counterexample. These tests seed
// the shipped files into an in-memory corpus and hold them to it.

import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.ts";
import { corpusFromFiles } from "./corpus.ts";
import { skillFiles, seedNotes } from "./seeds.ts";
import { buildIndex } from "./graph.ts";
import { lintIndex } from "./lint.ts";
import { parseDoc } from "./parser.ts";
import { skillPages, SKILL_STATUSES } from "./skills.ts";

const config = resolveConfig({});
const files = skillFiles(config);

describe("the shipped seeds", () => {
  it("ships six skills and three personas at the config-resolved paths", () => {
    expect(files).toHaveLength(9);
    expect(files.filter((f) => f.path.startsWith("docs/skills/"))).toHaveLength(
      6,
    );
    expect(
      files.filter((f) => f.path.startsWith("docs/personas/")),
    ).toHaveLength(3);
  });

  it("frontmatter name matches the basename, with a matching H1 and its role tag", () => {
    for (const f of files) {
      const base = (f.path.split("/").pop() ?? "").replace(/\.md$/, "");
      expect(f.content, f.path).toMatch(new RegExp(`^name: ${base}$`, "m"));
      const doc = parseDoc(f.content, f.path);
      expect(doc.title, f.path).toBe(base);
      expect(
        doc.headings.some((h) => h.depth === 1 && h.text === base),
        f.path,
      ).toBe(true);
      const role = f.path.includes("/personas/") ? "persona" : "skill";
      expect(doc.declaredTags, f.path).toContain(role);
    }
  });

  it("every page carries a closed-vocabulary Status and all required sections", () => {
    const corpus = corpusFromFiles(
      "/mem",
      new Map(files.map((f) => [f.path, f.content])),
      config,
    );
    const records = skillPages(corpus, buildIndex(corpus));
    expect(records).toHaveLength(9);
    for (const r of records) {
      expect(r.missing, r.id).toEqual([]);
      expect(SKILL_STATUSES, r.id).toContain(r.status);
    }
  });

  it("produces ZERO W003 findings, and every wikilink resolves inside the seeds", () => {
    const seeded = new Map(files.map((f) => [f.path, f.content]));
    seeded.set("README.md", "# Seeded repo\n");
    const corpus = corpusFromFiles("/mem", seeded, config);
    const index = buildIndex(corpus);

    const findings = lintIndex(corpus, index);
    expect(findings.filter((f) => f.code === "W003")).toEqual([]);

    const wikilinks = index.edges.filter((e) => e.type === "wikilink");
    expect(wikilinks.length).toBeGreaterThan(0);
    for (const e of wikilinks) {
      expect(e.to, `${e.from} → ${e.raw}`).not.toBeNull();
      // never outside the seeds + README — `check` must stay green in
      // every host repo, whatever else its corpus contains
      expect(
        files.some((f) => f.path === e.to) || e.to === "README.md",
        `${e.from} → ${e.to}`,
      ).toBe(true);
    }
  });

  it("addresses the files for a configured layout", () => {
    const custom = resolveConfig({
      skills: { dir: "meta/skills", personasDir: "meta/personas" },
    });
    const custom9 = skillFiles(custom);
    expect(custom9).toHaveLength(9);
    expect(custom9.every((f) => f.path.startsWith("meta/"))).toBe(true);
  });

  it("seedNotes prints the adoption mechanics as text, never performing them", () => {
    const text = seedNotes(config).join("\n");
    expect(text).toContain("git add docs/skills/ docs/personas/");
    expect(text).toContain('"skipRelative": [".claude/skills"]');
    expect(text).toContain(
      "ln -s ../../../docs/skills/doc-gardening.md .claude/skills/doc-gardening/SKILL.md",
    );
    expect(text).toContain('{ "tag": "skill", "prefix": "docs/skills/", "statusLine": true }');
    expect(text).toContain('{ "tag": "persona", "prefix": "docs/personas/", "statusLine": true }');
  });
});

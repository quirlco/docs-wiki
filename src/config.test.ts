// docs-wiki.config.json — discovery, merge rules, and the invariants the
// config system exists to guarantee: the machine-local floor cannot be
// subtracted, and ONE kinds list drives both tag derivation and the TOC's
// kind grouping (the drift bug the config replaces).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_ENTRY_PAGES,
  DEFAULT_KINDS,
  loadConfig,
  resolveConfig,
} from "./config.ts";
import { corpusFromFiles, walkCorpus } from "./corpus.ts";
import { buildIndex } from "./graph.ts";
import { lintIndex } from "./lint.ts";
import { makeRenderContext, renderMarkdown, tocHtml } from "./render.ts";
import { kindOf } from "./tags.ts";
import { memCorpus } from "./test-helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "docs-wiki-config-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadConfig discovery", () => {
  it("returns pure defaults when the root has no config file", () => {
    const cfg = loadConfig(tmp);
    expect(cfg.port).toBe(8123);
    expect(cfg.entryPages).toEqual(DEFAULT_ENTRY_PAGES);
    expect(cfg.reportOnlyPaths).toEqual([]);
    expect(cfg.mentionIds).toEqual({ adr: true, blocker: true, pr: true });
    expect(cfg.kinds.map((k) => k.tag)).toEqual([
      "adr",
      "runbook",
      "concept",
      "skill",
      "persona",
      "design",
      "milestone",
      "planning",
      "reference",
      "root",
    ]);
  });

  it("discovers docs-wiki.config.json at the corpus root", () => {
    const cfgDir = join(tmp, "cfgdir");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "docs-wiki.config.json"),
      `{"port": 4242, "entryPage": "docs/start.md"}`,
    );
    const cfg = loadConfig(cfgDir);
    expect(cfg.port).toBe(4242);
    expect(cfg.entryPages).toEqual(["docs/start.md"]);
  });

  it("an explicit config path overrides the root's own file and must exist", () => {
    const external = join(tmp, "external-config.json");
    writeFileSync(external, `{"reportOnlyPaths": ["tasks/"]}`);
    const cfg = loadConfig(tmp, external);
    expect(cfg.reportOnlyPaths).toEqual(["tasks/"]);
    expect(() => loadConfig(tmp, join(tmp, "no-such.json"))).toThrow(
      ConfigError,
    );
  });

  it("rejects malformed JSON with an error naming the file", () => {
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, "{not json");
    expect(() => loadConfig(tmp, bad)).toThrow(/bad\.json.*invalid JSON/s);
  });
});

describe("resolveConfig validation", () => {
  it("rejects unknown keys — a typo must fail loudly, not fall back", () => {
    expect(() => resolveConfig({ entrypage: "x.md" })).toThrow(
      /unknown key "entrypage"/,
    );
  });

  it("rejects wrong-typed values with the offending key named", () => {
    expect(() => resolveConfig({ port: "8123" })).toThrow(/"port"/);
    expect(() => resolveConfig({ reportOnlyPaths: "tasks/" })).toThrow(
      /"reportOnlyPaths"/,
    );
    expect(() => resolveConfig({ machineLocal: ["("] })).toThrow(
      /machineLocal.*not a valid regex/s,
    );
    expect(() => resolveConfig({ mentionIds: { adr: "no" } })).toThrow(
      /mentionIds\.adr/,
    );
    expect(() => resolveConfig({ kinds: [{ prefix: "docs/" }] })).toThrow(
      /"tag"/,
    );
    expect(() =>
      resolveConfig({ kinds: [{ tag: "x", prefix: "a/", rootOnly: true }] }),
    ).toThrow(/at most ONE matcher/);
    expect(() =>
      resolveConfig({ skipDirs: ["docs/decisions"] }),
    ).toThrow(/directory NAMES/);
  });

  it("merges skipDirs and skipRelative with the baseline (adds, never replaces)", () => {
    const cfg = resolveConfig({
      skipDirs: ["target"],
      skipRelative: ["vendor/snapshots/"],
    });
    for (const d of ["node_modules", ".git", ".next", "DerivedData"]) {
      expect(cfg.skipDirs.has(d), d).toBe(true);
    }
    expect(cfg.skipDirs.has("target")).toBe(true);
    expect(cfg.skipRelative.has(".claude/worktrees")).toBe(true);
    expect(cfg.skipRelative.has("vendor/snapshots")).toBe(true); // trailing / trimmed
  });
});

describe("the machine-local floor cannot be subtracted", () => {
  it("blocks the credential family even under a config that names none", () => {
    const cfg = resolveConfig({ machineLocal: [] });
    const corpus = corpusFromFiles(
      "/mem",
      new Map([
        ["README.md", "# R\n"],
        [".env.local", "SECRET=1"],
        [".envrc", "export AWS=2"],
        ["apps/.dev.vars", "SECRET=3"],
        ["notes.log", "log"],
      ]),
      cfg,
    );
    expect(corpus.files.has("README.md")).toBe(true);
    for (const secret of [".env.local", ".envrc", "apps/.dev.vars", "notes.log"]) {
      expect(corpus.files.has(secret), secret).toBe(false);
    }
  });

  it("config extras ADD to the floor", () => {
    const cfg = resolveConfig({ machineLocal: ["\\.pem$"] });
    const corpus = corpusFromFiles(
      "/mem",
      new Map([
        ["key.pem", "-----BEGIN"],
        [".env", "SECRET=1"],
      ]),
      cfg,
    );
    expect(corpus.files.has("key.pem")).toBe(false);
    expect(corpus.files.has(".env")).toBe(false);
  });
});

describe("reportOnlyPaths", () => {
  it("downgrades findings under the prefix to report-only, leaves the rest enforced", () => {
    const cfg = resolveConfig({ reportOnlyPaths: ["tasks/"] });
    const corpus = memCorpus(
      {
        "index.md": "# I\n\n[broken](missing.md)\n",
        "tasks/TODO.md": "# T\n\n[broken too](also-missing.md)\n",
      },
      cfg,
    );
    const findings = lintIndex(corpus, buildIndex(corpus));
    const bySeverity = (page: string) =>
      findings.find((f) => f.code === "E001" && f.page === page)?.severity;
    expect(bySeverity("index.md")).toBe("enforced");
    expect(bySeverity("tasks/TODO.md")).toBe("reported");
  });
});

describe("mentionIds toggles", () => {
  const files = {
    "docs/decisions/0007-thing.md": "# ADR-0007\n",
    "tasks/BLOCKERS.md": "# Blockers\n\n### B7 — Something\n\ntext\n",
    "note.md": "# N\n\nSee ADR-0007 and B7. Also PR #42 exists.\n",
  };

  it("defaults leave every family on", () => {
    const index = buildIndex(memCorpus(files));
    const types = new Set(
      (index.pages.get("note.md")?.outEdges ?? []).map((e) => e.type),
    );
    expect(types.has("mention-adr")).toBe(true);
    expect(types.has("mention-blocker")).toBe(true);
  });

  it("adr:false and blocker:false silence scanning AND rendering of those families", () => {
    const cfg = resolveConfig({ mentionIds: { adr: false, blocker: false } });
    const corpus = memCorpus(files, cfg);
    const index = buildIndex(corpus);
    const types = new Set(
      (index.pages.get("note.md")?.outEdges ?? []).map((e) => e.type),
    );
    expect(types.has("mention-adr")).toBe(false);
    expect(types.has("mention-blocker")).toBe(false);

    const html = renderMarkdown(
      files["note.md"],
      "note.md",
      makeRenderContext(index, "https://github.com/u/r"),
    );
    expect(html).not.toContain('href="/page/docs/decisions/0007-thing.md"');
    expect(html).not.toContain("#b7");
    expect(html).toContain('href="https://github.com/u/r/pull/42"'); // pr still on
  });

  it("pr:false stops PR linkification even with a repo url", () => {
    const cfg = resolveConfig({ mentionIds: { pr: false } });
    const corpus = memCorpus(files, cfg);
    const index = buildIndex(corpus);
    const html = renderMarkdown(
      files["note.md"],
      "note.md",
      makeRenderContext(index, "https://github.com/u/r"),
    );
    expect(html).not.toContain("/pull/42");
    expect(html).toContain('href="/page/docs/decisions/0007-thing.md"');
  });
});

describe("kinds drive BOTH derivation and the TOC's kind grouping", () => {
  const cfg = resolveConfig({
    kinds: [
      { tag: "spec", prefix: "specs/", statusLine: true },
      { tag: "note", pattern: "(^|/)notes/" },
      { tag: "top", rootOnly: true },
      { tag: "misc" },
    ],
  });
  const corpus = memCorpus(
    {
      "specs/auth.md": "# Auth\n\nStatus: Draft\n",
      "notes/today.md": "# Today\n",
      "README.md": "# Readme\n",
      "deep/dir/file.md": "# Deep\n",
    },
    cfg,
  );
  const index = buildIndex(corpus);
  const tagNames = (id: string) =>
    (index.pages.get(id)?.tags ?? []).map((t) => t.name);

  it("derives the custom taxonomy, first match wins, catch-all last", () => {
    expect(tagNames("specs/auth.md")).toContain("spec");
    expect(tagNames("specs/auth.md")).toContain("status:draft");
    expect(tagNames("notes/today.md")).toContain("note");
    expect(tagNames("README.md")).toContain("top");
    expect(tagNames("deep/dir/file.md")).toContain("misc");
  });

  it("groups the TOC by exactly those tags — no hard-coded kind set left", () => {
    const html = tocHtml(index, "kind");
    for (const kind of ["spec", "note", "top", "misc"]) {
      expect(html).toContain(`<h2>${kind}`);
    }
    expect(html).not.toContain("(other)");
    // and by topic, kind tags are excluded (they are structure, not topic)
    const byTopic = tocHtml(index, "topic");
    expect(byTopic).toContain("(untagged)");
  });

  it("scrapes status: only for rules that ask for it", () => {
    expect(tagNames("notes/today.md").some((n) => n.startsWith("status:"))).toBe(
      false,
    );
  });
});

describe("corpusFromFiles", () => {
  it("builds a working index and renderer from in-memory markdown, no FS", () => {
    const cfg = resolveConfig({});
    const corpus = corpusFromFiles(
      "/nonexistent/root",
      new Map([
        ["docs/a.md", "# Alpha\n\nSee [[b]] and `docs/b.md`.\n"],
        ["docs/b.md", "# Beta\n"],
        ["assets/x.css", "/* exists for path checks */"],
        ["node_modules/pkg/readme.md", "# never indexed\n"],
      ]),
      cfg,
    );
    expect(corpus.docs.has("docs/a.md")).toBe(true);
    expect(corpus.docs.has("node_modules/pkg/readme.md")).toBe(false);
    expect(corpus.files.has("assets/x.css")).toBe(true);

    const index = buildIndex(corpus);
    expect(
      (index.backlinks.get("docs/b.md") ?? []).some(
        (e) => e.from === "docs/a.md",
      ),
    ).toBe(true);

    const ctx = makeRenderContext(index, null, {
      page: (id, anchor) =>
        `/wiki/${id}${anchor !== undefined ? `#${anchor}` : ""}`,
      raw: (path) => `/files/${path}`,
    });
    const html = renderMarkdown(
      "# Alpha\n\nSee [[b]] and `docs/b.md`.\n",
      "docs/a.md",
      ctx,
    );
    // the hrefs hook rewrites every generated link
    expect(html).toContain('href="/wiki/docs/b.md"');
    expect(html).not.toContain('href="/page/');
  });
});

describe("skills config — the skills layer", () => {
  it("defaults to the skills layout, enabled", () => {
    expect(resolveConfig({}).skills).toEqual({
      enabled: true,
      dir: "docs/skills/",
      personasDir: "docs/personas/",
    });
  });

  it("merges field-wise: setting dir does not reset personasDir", () => {
    const cfg = resolveConfig({ skills: { dir: "meta/skills/" } });
    expect(cfg.skills.dir).toBe("meta/skills/");
    expect(cfg.skills.personasDir).toBe("docs/personas/");
    expect(cfg.skills.enabled).toBe(true);
  });

  it('accepts "skills": false as shorthand for disabling the layer', () => {
    const cfg = resolveConfig({ skills: false });
    expect(cfg.skills.enabled).toBe(false);
    expect(cfg.skills.dir).toBe("docs/skills/"); // dirs keep their defaults
  });

  it("normalizes directories to a trailing slash", () => {
    const cfg = resolveConfig({
      skills: { dir: "meta/skills", personasDir: "meta/personas" },
    });
    expect(cfg.skills.dir).toBe("meta/skills/");
    expect(cfg.skills.personasDir).toBe("meta/personas/");
  });

  it('strips leading "./" and collapses duplicate slashes', () => {
    expect(resolveConfig({ skills: { dir: "./docs/skills" } }).skills.dir).toBe(
      "docs/skills/",
    );
    expect(
      resolveConfig({ skills: { personasDir: "docs/personas//" } }).skills
        .personasDir,
    ).toBe("docs/personas/");
  });

  it("rejects equal dir and personasDir — a page cannot be both", () => {
    expect(() =>
      resolveConfig({ skills: { personasDir: "docs/skills/" } }),
    ).toThrow(/"skills\.dir" and "skills\.personasDir" must differ/);
    // equality is checked AFTER normalization, so sloppy spellings collide too
    expect(() =>
      resolveConfig({
        skills: { dir: "./docs/playbook//", personasDir: "docs/playbook" },
      }),
    ).toThrow(/must differ/);
    // nesting one under the other stays legal (longest prefix wins)
    expect(() =>
      resolveConfig({
        skills: { dir: "docs/playbook/", personasDir: "docs/playbook/personas/" },
      }),
    ).not.toThrow();
  });

  it("fails loudly on unknown sub-keys, absolute dirs, and wrong types", () => {
    expect(() => resolveConfig({ skills: { folder: "x/" } })).toThrow(
      /"skills" has unknown key "folder"/,
    );
    expect(() => resolveConfig({ skills: { dir: "/abs/skills/" } })).toThrow(
      /skills\.dir.*repo-relative/s,
    );
    expect(() => resolveConfig({ skills: { dir: "" } })).toThrow(
      /skills\.dir/,
    );
    expect(() => resolveConfig({ skills: { enabled: "yes" } })).toThrow(
      /skills\.enabled/,
    );
    expect(() => resolveConfig({ skills: [] })).toThrow(
      /"skills" must be an object or false/,
    );
  });

  it("the default kinds tag the skills dirs, matching before `reference`", () => {
    expect(kindOf("docs/skills/doc-gardening.md", DEFAULT_KINDS)?.tag).toBe(
      "skill",
    );
    expect(kindOf("docs/personas/gardener.md", DEFAULT_KINDS)?.tag).toBe(
      "persona",
    );
    expect(kindOf("docs/other.md", DEFAULT_KINDS)?.tag).toBe("reference");
    // maturity is the ADR convention reused: both rules scrape Status lines
    expect(DEFAULT_KINDS.find((k) => k.tag === "skill")?.statusLine).toBe(true);
    expect(DEFAULT_KINDS.find((k) => k.tag === "persona")?.statusLine).toBe(
      true,
    );
  });
});

describe("dynamic own-fixtures exclusion", () => {
  it("skips the package's own src/fixtures only when it sits inside the corpus root", () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const corpus = walkCorpus(packageRoot, resolveConfig({}));
    for (const id of corpus.docs.keys()) {
      expect(id.startsWith("src/fixtures/"), id).toBe(false);
    }
    // the dir itself is still recorded — mentioning it is not a dead path
    expect(corpus.dirs.has("src/fixtures")).toBe(true);
    expect(corpus.docs.has("README.md")).toBe(true);
  });
});

// End-to-end: spawns the CLI exactly the way the bin does —
// real node, real type-stripping flags — so a broken runtime invocation
// cannot hide behind vitest's own TS transform.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
const brokenRoot = fileURLToPath(
  new URL("./fixtures/corpus/", import.meta.url),
);
const cleanRoot = fileURLToPath(new URL("./fixtures/clean/", import.meta.url));
// A separate fixture root for the seeds commands, so the corpus/clean
// fixture-count assertions elsewhere never shift.
const seedsRoot = fileURLToPath(
  new URL("./fixtures/seeds/", import.meta.url),
);
const demoRoot = fileURLToPath(
  new URL("../examples/demo-wiki/", import.meta.url),
);
const skillsDisabledConfig = fileURLToPath(
  new URL("./fixtures/configs/skills-disabled.config.json", import.meta.url),
);

function run(...args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      cliPath,
      ...args,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("the demo wiki", () => {
  it("has no enforced findings and exactly one deliberate orphan", () => {
    const r = run("check", "--root", demoRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("0 enforced");
    expect(r.stdout).toContain("W001 docs/scratch/unfiled-idea.md");
    expect(r.stdout.match(/W001/g)).toHaveLength(1);
  });
});

describe("docs-wiki check", () => {
  it("exits 1 on the broken fixture corpus and names the findings", () => {
    const r = run("check", "--root", brokenRoot);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("E001");
    expect(r.stdout).toContain("E003");
    expect(r.stdout).toMatch(/\d+ enforced, \d+ reported/);
  });

  it("prints broken links as [enforced] wherever they live", () => {
    // No directory buys leniency here — see graph.test.ts and lint.test.ts.
    const r = run("check", "--root", brokenRoot);
    const blockersLines = r.stdout
      .split("\n")
      .filter((l) => l.includes("tasks/BLOCKERS.md:") && l.startsWith("E"));
    expect(blockersLines.length).toBeGreaterThan(0);
    expect(blockersLines.every((l) => l.includes("[enforced]"))).toBe(true);
  });

  it("exits 0 on the clean corpus", () => {
    const r = run("check", "--root", cleanRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("0 enforced, 0 reported");
  });

  it("emits parseable findings with --json", () => {
    const r = run("check", "--json", "--root", brokenRoot);
    const findings = JSON.parse(r.stdout) as { code: string; page: string }[];
    expect(
      findings.some((f) => f.code === "E001" && f.page === "index.md"),
    ).toBe(true);
  });
});

describe("docs-wiki backlinks", () => {
  it("returns grouped backlinks as JSON", () => {
    const r = run("backlinks", "sub/alpha.md", "--json", "--root", brokenRoot);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      page: string;
      backlinks: { from: string; type: string }[];
    };
    expect(parsed.page).toBe("sub/alpha.md");
    expect(
      parsed.backlinks.some((b) => b.from === "index.md" && b.type === "link"),
    ).toBe(true);
  });

  it("exits 2 for a file that is not a page", () => {
    const r = run("backlinks", "no/such/page.md", "--root", brokenRoot);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not a page");
  });

  it("exits 2 with usage when the file argument is missing", () => {
    const r = run("backlinks", "--root", brokenRoot);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
  });
});

describe("docs-wiki impact", () => {
  it("ranks referrers by how heavily they lean on the changed doc", () => {
    const r = run("impact", "sub/alpha.md", "--json", "--root", brokenRoot);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout) as {
      changed: string;
      referrers: { page: string; line: number; count: number }[];
    }[];
    expect(report).toHaveLength(1);
    expect(report[0].changed).toBe("sub/alpha.md");
    expect(report[0].referrers.map((x) => x.page)).toContain("index.md");
    // Descending by count — the top of the list is where a moved fact is
    // most likely to have been repeated.
    const counts = report[0].referrers.map((x) => x.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("prints a checklist a human or agent can walk", () => {
    const r = run("impact", "sub/alpha.md", "--root", brokenRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[ ] index.md:");
    expect(r.stdout).toContain("page(s) reference it");
  });

  it("says so plainly when nothing references the doc", () => {
    const r = run("impact", "orphan.md", "--root", brokenRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no review needed");
  });

  it("exits 2 on an explicit path that is not a page (a typo)", () => {
    const r = run("impact", "no/such/doc.md", "--root", brokenRoot);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not pages in the corpus");
  });
});

describe("docs-wiki tags", () => {
  it("lists facets with counts and the pages under one", () => {
    const all = run("tags", "--json", "--root", brokenRoot);
    expect(all.status).toBe(0);
    const rows = JSON.parse(all.stdout) as { tag: string; pages: number }[];
    expect(rows.some((r) => r.tag === "concept")).toBe(true);

    const one = run("tags", "concept", "--root", brokenRoot);
    expect(one.status).toBe(0);
    expect(one.stdout).toContain("concepts/widget.md");

    expect(run("tags", "no-such-tag", "--root", brokenRoot).status).toBe(2);
  });

  it("filters search by tag:", () => {
    const r = run("search", "tag:concept", "--json", "--root", brokenRoot);
    expect(r.status).toBe(0);
    const hits = JSON.parse(r.stdout) as { id: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.id.startsWith("concepts/"))).toBe(true);
  });
});

describe("docs-wiki search / orphans", () => {
  it("finds fixture pages by content", () => {
    const r = run("search", "widget", "--json", "--root", brokenRoot);
    expect(r.status).toBe(0);
    const hits = JSON.parse(r.stdout) as { id: string }[];
    expect(hits.map((h) => h.id)).toContain("concepts/widget.md");
  });

  it("lists orphans", () => {
    const r = run("orphans", "--root", brokenRoot);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")).toContain("orphan.md");
  });

  it("rejects unknown commands and bad flags with usage", () => {
    expect(run("frobnicate", "--root", brokenRoot).status).toBe(2);
    expect(run("check", "--nope").status).toBe(2);
  });
});

describe("docs-wiki skills", () => {
  it("prints the skills table with a summary", () => {
    const r = run("skills", "--root", seedsRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("good-skill");
    expect(r.stdout).toContain("2 skills, 1 persona");
  });

  it("emits SkillRecords with --json", () => {
    const r = run("skills", "--json", "--root", seedsRoot);
    expect(r.status).toBe(0);
    const records = JSON.parse(r.stdout) as {
      id: string;
      role: string;
      status: string | null;
      missing: string[];
    }[];
    expect(records).toHaveLength(3);
    const malformed = records.find((x) => x.id.includes("malformed"));
    expect(malformed?.status).toBeNull();
    expect(malformed?.missing).toContain("Moves");
    expect(malformed?.missing).toContain("Status line");
    const persona = records.find((x) => x.role === "persona");
    expect(persona?.status).toBe("draft");
    expect(persona?.missing).toEqual([]);
  });

  it("says the layer is disabled instead of recommending seed", () => {
    const r = run(
      "skills",
      "--root",
      seedsRoot,
      "--config",
      skillsDisabledConfig,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("the skills layer is disabled");
    expect(r.stdout).not.toContain("seed");
  });

  it("points an empty corpus at init, exit 0", () => {
    const r = run("skills", "--root", cleanRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "no skills or personas — run docs-wiki init to adopt the seeds",
    );
  });
});

describe("docs-wiki guide", () => {
  it("states the maturity vocabulary and the configured directories", () => {
    const r = run("guide", "--root", seedsRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("draft | active | deprecated");
    expect(r.stdout).toContain("docs/skills/");
    expect(r.stdout).toContain("docs/personas/");
    expect(r.stdout).toContain("rule of three");
  });

  it("emits the compiled contract with --json", () => {
    const r = run("guide", "--json", "--root", seedsRoot);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout) as {
      version: string;
      skillsDir: string;
      statuses: string[];
      skills: { id: string }[];
    };
    expect(j.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(j.skillsDir).toBe("docs/skills/");
    expect(j.statuses).toEqual(["draft", "active", "deprecated"]);
    expect(j.skills.map((x) => x.id)).toContain("docs/skills/good-skill.md");
  });
});

describe("docs-wiki seed", () => {
  it("round-trips the full seed set with --json", () => {
    const r = run("seed", "--json", "--root", seedsRoot);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      files: { path: string; content: string }[];
      notes: string[];
    };
    expect(parsed.files).toHaveLength(9);
    expect(parsed.files.map((f) => f.path)).toContain(
      "docs/skills/doc-gardening.md",
    );
    expect(parsed.files.every((f) => f.content.includes("Status:"))).toBe(true);
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  it("prints one named file under its target-path header, plus the notes", () => {
    const r = run("seed", "doc-gardening", "--root", seedsRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--- docs/skills/doc-gardening.md ---");
    expect(r.stdout).toContain("# doc-gardening");
    expect(r.stdout).toContain("git add docs/skills/ docs/personas/");
  });

  it("exits 2 on an unknown name", () => {
    const r = run("seed", "nosuch", "--root", seedsRoot);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("nosuch");
  });
});

describe("docs-wiki check on the seeds fixture", () => {
  it("reports W003 as [reported] and still exits 0", () => {
    const r = run("check", "--root", seedsRoot);
    expect(r.status).toBe(0);
    const w3 = r.stdout
      .split("\n")
      .filter((l) => l.startsWith("W003"));
    expect(w3.length).toBeGreaterThan(0);
    expect(w3.every((l) => l.includes("[reported]"))).toBe(true);
  });
});

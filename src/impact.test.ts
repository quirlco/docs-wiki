// `docs-wiki impact` with no arguments is the command the agent loop is built
// around, and it was the only one with no coverage. It talks to git, so
// these drive a real throwaway repository rather than mocking it — the
// defects worth catching here (a clean range silently falling through to
// another one; uncommitted edits invisible) are precisely the ones a mock
// would reproduce wrongly.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

function runCli(cwd: string, ...args: string[]) {
  const r = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      cliPath,
      ...args,
    ],
    { cwd, encoding: "utf8", timeout: 30_000 },
  );
  return r;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "docs-wiki-impact-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs/target.md"), "# Target\n\nA doc.\n");
  writeFileSync(
    join(repo, "docs/referrer.md"),
    "# Referrer\n\nSee [target](target.md) and docs/target.md again.\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  // A SECOND commit that touches a doc. Without it, HEAD~1 does not exist
  // and the fall-through bug this suite pins cannot manifest — the first
  // version of these tests could not have caught it.
  writeFileSync(join(repo, "docs/target.md"), "# Target\n\nA doc, revised.\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "second: edits docs/target.md");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("docs-wiki impact (no arguments)", () => {
  it("reports nothing when no docs have changed", () => {
    const out = runCli(repo, "impact", "--json");
    expect(JSON.parse(out)).toEqual([]);
  });

  it("does NOT fall back to an earlier commit when the range is clean", () => {
    // The failure this pins: an earlier version treated "zero .md in this
    // range" as "range failed" and silently reported the PREVIOUS commit's
    // docs, so a session that changed nothing got a confident checklist.
    const text = runCli(repo, "impact");
    expect(text).toContain("nothing to review");
    expect(text).not.toContain("docs/target.md");
  });

  it("sees an UNCOMMITTED edit — the doc you are editing right now", () => {
    writeFileSync(
      join(repo, "docs/target.md"),
      "# Target\n\nEdited, not committed.\n",
    );
    try {
      const report = JSON.parse(runCli(repo, "impact", "--json")) as {
        changed: string;
        referrers: { page: string; count: number }[];
      }[];
      expect(report.map((r) => r.changed)).toEqual(["docs/target.md"]);
      expect(report[0].referrers.map((r) => r.page)).toEqual([
        "docs/referrer.md",
      ]);
      // Two references from that page (a link and a path mention) fold into
      // one referrer row with a count.
      expect(report[0].referrers[0].count).toBeGreaterThanOrEqual(2);
    } finally {
      git(repo, "checkout", "--", "docs/target.md");
    }
  });

  it("sees a STAGED edit too", () => {
    writeFileSync(join(repo, "docs/target.md"), "# Target\n\nStaged.\n");
    git(repo, "add", "docs/target.md");
    try {
      const report = JSON.parse(runCli(repo, "impact", "--json")) as {
        changed: string;
      }[];
      expect(report.map((r) => r.changed)).toEqual(["docs/target.md"]);
    } finally {
      git(repo, "reset", "-q", "--hard");
    }
  });

  it("ignores non-markdown changes", () => {
    writeFileSync(join(repo, "docs/thing.ts"), "export {};\n");
    try {
      expect(JSON.parse(runCli(repo, "impact", "--json"))).toEqual([]);
    } finally {
      rmSync(join(repo, "docs/thing.ts"));
    }
  });
});

describe("docs-wiki impact with no base branch", () => {
  it("warns on stderr and exits 2 instead of printing a confident empty answer", () => {
    const lone = mkdtempSync(join(tmpdir(), "docs-wiki-impact-nobase-"));
    try {
      git(lone, "init", "-q", "-b", "trunk");
      git(lone, "config", "user.email", "t@example.com");
      git(lone, "config", "user.name", "T");
      writeFileSync(join(lone, "a.md"), "# A\n");
      git(lone, "add", "-A");
      git(lone, "commit", "-qm", "one");
      const r = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--disable-warning=ExperimentalWarning",
          cliPath,
          "impact",
        ],
        { cwd: lone, encoding: "utf8", timeout: 30_000 },
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("origin/main");
      expect(r.stderr).toContain("docs-wiki impact <file>");
    } finally {
      rmSync(lone, { recursive: true, force: true });
    }
  });
});

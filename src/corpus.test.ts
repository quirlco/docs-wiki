// walkCorpus's exclusion rules are a SECURITY boundary, not bookkeeping:
// /raw/ serves exactly `corpus.files`, so a machine-local credential file
// slipping into the walk becomes a served credential. Tested against a real
// temp directory, because the fixture corpus cannot commit a .env.local
// (.gitignore rightly refuses it).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ownFixturesRelative, walkCorpus } from "./corpus.ts";

const root = mkdtempSync(join(tmpdir(), "docs-wiki-corpus-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, "apps/web"), { recursive: true });
mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
mkdirSync(join(root, ".claude/worktrees/agent-x"), { recursive: true });
writeFileSync(join(root, "README.md"), "# Root\n");
writeFileSync(join(root, "apps/web/page.ts"), "export {};\n");
writeFileSync(join(root, ".env"), "SECRET=1\n");
writeFileSync(join(root, ".env.local"), "SECRET=2\n");
writeFileSync(join(root, "apps/web/.env.local"), "SECRET=3\n");
writeFileSync(join(root, ".dev.vars"), "SECRET=4\n");
// The prefix FAMILY, not just the spellings that have bitten us: .gitignore
// says `.env*`, and a guard listing only `.env` and `.env.` served .envrc.
writeFileSync(join(root, ".envrc"), "export AWS_SECRET=5\n");
writeFileSync(join(root, ".env-prod"), "SECRET=6\n");
writeFileSync(join(root, "apps/web/.dev.vars.production"), "SECRET=7\n");
writeFileSync(join(root, "node_modules/pkg/index.js"), "");
writeFileSync(join(root, ".claude/worktrees/agent-x/README.md"), "# Copy\n");

const corpus = walkCorpus(root);

describe("walkCorpus exclusions", () => {
  it("never records machine-local credential files — /raw/ serves this set", () => {
    expect(corpus.files.has("README.md")).toBe(true);
    expect(corpus.files.has("apps/web/page.ts")).toBe(true);
    for (const secret of [
      ".env",
      ".env.local",
      "apps/web/.env.local",
      ".dev.vars",
      ".envrc",
      ".env-prod",
      "apps/web/.dev.vars.production",
    ]) {
      expect(corpus.files.has(secret), secret).toBe(false);
    }
  });

  it("never recurses into node_modules or agent worktrees", () => {
    for (const f of corpus.files) {
      expect(f.startsWith("node_modules/")).toBe(false);
      expect(f.startsWith(".claude/worktrees/")).toBe(false);
    }
    expect(corpus.docs.has(".claude/worktrees/agent-x/README.md")).toBe(false);
  });

  it("records directories, including skipped ones, so dir mentions resolve", () => {
    expect(corpus.dirs.has("apps")).toBe(true);
    expect(corpus.dirs.has("apps/web")).toBe(true);
    expect(corpus.dirs.has("node_modules")).toBe(true); // exists, even if never walked
  });
});

describe("ownFixturesRelative", () => {
  it("excludes the source tree's fixtures when running from dist/", () => {
    const root = mkdtempSync(join(tmpdir(), "docs-wiki-dist-"));
    try {
      mkdirSync(join(root, "dist"), { recursive: true });
      mkdirSync(join(root, "src", "fixtures"), { recursive: true });
      expect(ownFixturesRelative(root, join(root, "dist"))).toEqual([
        "src/fixtures",
      ]);
      // From source both candidates are the same directory.
      expect(ownFixturesRelative(root, join(root, "src"))).toEqual([
        "src/fixtures",
      ]);
      // Outside the corpus root: nothing to exclude.
      expect(ownFixturesRelative(join(root, "dist"), join(root, "src"))).toEqual(
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

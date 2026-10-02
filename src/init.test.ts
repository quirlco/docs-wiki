// `docs-wiki init`, end to end: real temp git repos, the real CLI.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "./config.ts";
import { BLOCK_END, BLOCK_START, agentsBlock, applyBlock, runInit } from "./init.ts";
import { skillFiles } from "./seeds.ts";

const cliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const dirs: string[] = [];
function tmpRepo(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "docs-wiki-init-")));
  dirs.push(d);
  spawnSync("git", ["init", "-q", d]);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function run(root: string, ...args: string[]) {
  return runEnv({}, root, ...args);
}
// CLAUDECODE is stripped unless a test sets it: these tests may themselves
// run inside Claude Code, whose shell exports it.
function runEnv(env: Record<string, string>, root: string, ...args: string[]) {
  const r = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      cliPath,
      args[0] ?? "init",
      "--root",
      root,
      ...args.slice(1),
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, CLAUDECODE: "", ...env },
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const init = (root: string, ...flags: string[]) => run(root, "init", ...flags);

/** Every file under root (relative path → content or "-> target" for links). */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isSymbolicLink()) out[r] = `-> ${readlinkSync(join(root, r))}`;
      else if (e.isDirectory()) walk(r);
      else out[r] = readFileSync(join(root, r), "utf8");
    }
  };
  walk("");
  return out;
}

const statuses = (stdout: string): string[] =>
  stdout
    .split("\n")
    .filter((l) => /^\S.*\s{2,}(created|updated|unchanged|kept|skipped)/.test(l));

describe("init on an empty repo", () => {
  it("creates the expected files and check exits 0", () => {
    const root = tmpRepo();
    const r = init(root);
    expect(r.status).toBe(0);
    const snap = snapshot(root);
    expect(Object.keys(snap)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "docs/Home.md",
        "docs/skills/sleep-consolidation.md",
        "docs/personas/gardener.md",
      ]),
    );
    expect(snap["AGENTS.md"]).toBe(`${agentsBlock(resolveConfig({}))}\n`);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    const c = run(root, "check");
    expect(c.status).toBe(0);
    expect(c.stdout).toContain("0 enforced, 0 reported");
  });

  it("is idempotent: a rerun reports only unchanged and changes no byte", () => {
    const root = tmpRepo();
    init(root, "--claude");
    const before = snapshot(root);
    const r = init(root, "--claude");
    expect(r.status).toBe(0);
    for (const line of statuses(r.stdout)) {
      expect(line).toMatch(/unchanged|skipped/);
      expect(line).not.toMatch(/created|updated|kept/);
    }
    expect(snapshot(root)).toEqual(before);
  });

  it("--dry-run prints the plan and writes nothing", () => {
    const root = tmpRepo();
    const r = init(root, "--dry-run", "--claude");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("created");
    expect(r.stdout).toContain("nothing was written");
    expect(snapshot(root)).toEqual({});
  });

  it("--json carries the actions", () => {
    const root = tmpRepo();
    const r = init(root, "--json", "--dry-run");
    const j = JSON.parse(r.stdout) as { actions: { path: string; status: string }[]; exitCode: number };
    expect(j.exitCode).toBe(0);
    expect(j.actions.find((a) => a.path === "AGENTS.md")?.status).toBe("created");
  });
});

describe("AGENTS.md", () => {
  it("preserves existing text and appends the block after a blank line", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "AGENTS.md"), "# Mine\n\nDo the thing.\n");
    expect(init(root).status).toBe(0);
    const text = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(text.startsWith("# Mine\n\nDo the thing.\n\n" + BLOCK_START)).toBe(true);
    expect(text.endsWith(`${BLOCK_END}\n`)).toBe(true);
  });

  it("replaces a changed block in place and never touches text around it", () => {
    const root = tmpRepo();
    writeFileSync(
      join(root, "AGENTS.md"),
      `before\n\n${BLOCK_START}\nstale\n${BLOCK_END}\n\nafter\n`,
    );
    const r = init(root);
    expect(r.stdout).toMatch(/AGENTS\.md\s+updated/);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(
      `before\n\n${agentsBlock(resolveConfig({}))}\n\nafter\n`,
    );
  });

  it.each([
    ["start without end", `x\n${BLOCK_START}\nfoo\n`],
    ["duplicate blocks", `${BLOCK_START}\na\n${BLOCK_END}\n${BLOCK_START}\nb\n${BLOCK_END}\n`],
    ["end before start", `${BLOCK_END}\n${BLOCK_START}\n`],
  ])("malformed markers (%s) exit 2 and leave everything untouched", (_n, content) => {
    const root = tmpRepo();
    writeFileSync(join(root, "AGENTS.md"), content);
    const r = init(root);
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/AGENTS\.md\s+skipped \(refused: markers are malformed/);
    expect(snapshot(root)).toEqual({ "AGENTS.md": content });
  });

  it("refuses a symlinked AGENTS.md", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "real.md"), "x\n");
    symlinkSync("real.md", join(root, "AGENTS.md"));
    const r = init(root);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("it is a symlink");
    expect(readFileSync(join(root, "real.md"), "utf8")).toBe("x\n");
    expect(existsSync(join(root, "docs"))).toBe(false);
  });
});

describe("CLAUDE.md", () => {
  const claudeBlock = `${BLOCK_START}\n@AGENTS.md\n${BLOCK_END}`;

  it("adds the import once to an existing CLAUDE.md, with no flag", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "CLAUDE.md"), "# Claude\n");
    init(root);
    init(root);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(`# Claude\n\n${claudeBlock}\n`);
  });

  it("leaves a CLAUDE.md that already imports AGENTS.md alone", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "CLAUDE.md"), "# C\n@AGENTS.md\n");
    const r = init(root);
    expect(r.stdout).toMatch(/CLAUDE\.md\s+unchanged/);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("# C\n@AGENTS.md\n");
  });

  it("does not create CLAUDE.md without --claude or .claude/", () => {
    const root = tmpRepo();
    expect(init(root).stdout).toMatch(/CLAUDE\.md\s+skipped/);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
  });

  it("creates it with --claude", () => {
    const root = tmpRepo();
    init(root, "--claude");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(`${claudeBlock}\n`);
  });

  it("creates it when .claude/ exists", () => {
    const root = tmpRepo();
    mkdirSync(join(root, ".claude"));
    init(root);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(`${claudeBlock}\n`);
  });

  it("refuses a symlinked CLAUDE.md", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "elsewhere.md"), "x\n");
    symlinkSync("elsewhere.md", join(root, "CLAUDE.md"));
    expect(init(root).status).toBe(2);
    expect(readFileSync(join(root, "elsewhere.md"), "utf8")).toBe("x\n");
  });
});

describe("skills, personas, Home", () => {
  it("keeps a differing seed and never overwrites it", () => {
    const root = tmpRepo();
    mkdirSync(join(root, "docs/skills"), { recursive: true });
    writeFileSync(join(root, "docs/skills/doc-gardening.md"), "mine\n");
    const r = init(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/docs\/skills\/doc-gardening\.md\s+kept \(yours differs\)/);
    expect(readFileSync(join(root, "docs/skills/doc-gardening.md"), "utf8")).toBe("mine\n");
  });

  it("keeps an existing docs/Home.md", () => {
    const root = tmpRepo();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/Home.md"), "# Mine\n");
    init(root);
    expect(readFileSync(join(root, "docs/Home.md"), "utf8")).toBe("# Mine\n");
  });

  it("follows configured directories", () => {
    const root = tmpRepo();
    writeFileSync(
      join(root, "docs-wiki.config.json"),
      JSON.stringify({ skills: { dir: "meta/skills", personasDir: "meta/people" } }),
    );
    expect(init(root).status).toBe(0);
    expect(existsSync(join(root, "meta/skills/sleep-consolidation.md"))).toBe(true);
    expect(existsSync(join(root, "meta/people/gardener.md"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("`meta/skills/`");
    expect(run(root, "check").status).toBe(0);
  });

  it("skips the skills layer when it is disabled", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "docs-wiki.config.json"), JSON.stringify({ skills: false }));
    const r = init(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("the skills layer is disabled");
    expect(existsSync(join(root, "docs/skills"))).toBe(false);
    expect(run(root, "check").status).toBe(0);
  });
});

describe("path safety", () => {
  it.each(["../escape/skills", "docs/../../escape/skills", "docs\\..\\x", ".git/skills"])(
    "config rejects a skills dir that escapes or enters .git (%s)",
    (dir) => {
      const root = tmpRepo();
      writeFileSync(
        join(root, "docs-wiki.config.json"),
        JSON.stringify({ skills: { dir, personasDir: "docs/personas" } }),
      );
      const r = init(root);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/must not/);
      expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    },
  );

  it("normalises backslashes in a skills dir", () => {
    const root = tmpRepo();
    writeFileSync(
      join(root, "docs-wiki.config.json"),
      JSON.stringify({ skills: { dir: "meta\\skills", personasDir: "meta\\people" } }),
    );
    expect(init(root).status).toBe(0);
    expect(existsSync(join(root, "meta/skills/sleep-consolidation.md"))).toBe(true);
  });

  it("refuses an absolute skills dir", () => {
    const root = tmpRepo();
    writeFileSync(
      join(root, "docs-wiki.config.json"),
      JSON.stringify({ skills: { dir: "/tmp/x/" } }),
    );
    expect(init(root).status).toBe(2); // config rejects absolute paths
  });

  it("refuses to write through a symlinked directory", () => {
    const root = tmpRepo();
    const outside = tmpRepo();
    symlinkSync(outside, join(root, "docs"));
    const r = init(root);
    expect(r.status).toBe(2);
    expect(readdirSync(outside).filter((n) => n !== ".git")).toEqual([]);
  });

  it("exits 2 on a bad flag and on a root that is not a directory", () => {
    expect(init(tmpRepo(), "--nope").status).toBe(2);
    expect(init(join(tmpRepo(), "missing")).status).toBe(2);
  });
});

describe("the Claude Code bridge", () => {
  it("links each skill with a relative symlink that resolves to the skill file", () => {
    const root = tmpRepo();
    mkdirSync(join(root, ".claude"));
    init(root);
    const skills = skillFiles(resolveConfig({})).filter((f) => f.path.startsWith("docs/skills/"));
    expect(skills.length).toBe(6);
    for (const f of skills) {
      const name = f.path.replace("docs/skills/", "").replace(/\.md$/, "");
      const link = join(root, ".claude/skills", name, "SKILL.md");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(`../../../docs/skills/${name}.md`);
      expect(realpathSync(link)).toBe(realpathSync(join(root, f.path)));
      expect(readFileSync(link, "utf8")).toBe(f.content);
    }
  });

  it("does not index or flag the bridge", () => {
    const root = tmpRepo();
    init(root, "--claude");
    const c = run(root, "check", "--json");
    expect(c.status).toBe(0);
    expect(c.stdout).not.toContain(".claude");
    const pages = run(root, "skills", "--json");
    expect(JSON.parse(pages.stdout)).toHaveLength(9);
  });

  it("keeps something else that sits at a bridge path", () => {
    const root = tmpRepo();
    mkdirSync(join(root, ".claude/skills/doc-gardening"), { recursive: true });
    writeFileSync(join(root, ".claude/skills/doc-gardening/SKILL.md"), "mine\n");
    const r = init(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/doc-gardening\/SKILL\.md\s+kept/);
    expect(readFileSync(join(root, ".claude/skills/doc-gardening/SKILL.md"), "utf8")).toBe("mine\n");
  });
});

describe("the manual snippet matches the generated block", () => {
  it("agents/README.md carries the default block verbatim", () => {
    const readme = readFileSync(join(repoRoot, "agents/README.md"), "utf8");
    expect(readme).toContain(agentsBlock(resolveConfig({})));
  });
});

describe("docs-wiki skills", () => {
  it("prints each skill's Use-when line", () => {
    const root = tmpRepo();
    init(root);
    const r = run(root, "skills");
    expect(r.stdout).toContain("Use at the end of every working session");
  });
});

describe("markers are whole lines outside code", () => {
  const inline = `Docs say \`${BLOCK_START}\` opens it and \`${BLOCK_END}\` closes it.\n`;
  const fenced = `Example:\n\n\`\`\`\n${BLOCK_START}\nx\n${BLOCK_END}\n\`\`\`\n`;
  it.each([["inline in backticks", inline], ["inside a fence", fenced]])(
    "markers %s are prose: block appended, user text untouched",
    (_n, content) => {
      const root = tmpRepo();
      writeFileSync(join(root, "AGENTS.md"), content);
      const r = init(root);
      expect(r.status).toBe(0);
      const text = readFileSync(join(root, "AGENTS.md"), "utf8");
      expect(text.startsWith(`${content}\n${BLOCK_START}\n## Project memory`)).toBe(true);
      expect(init(root).stdout).toMatch(/AGENTS\.md\s+unchanged/);
    },
  );
});

describe("write safety", () => {
  it("refuses a read-only AGENTS.md and writes nothing", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "AGENTS.md"), "# Mine\n", { mode: 0o444 });
    const r = init(root);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("it is not writable");
    expect(r.stdout).toMatch(/would create/);
    expect(snapshot(root)).toEqual({ "AGENTS.md": "# Mine\n" });
  });

  it("keeps the file mode on rewrite", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "AGENTS.md"), "# Mine\n", { mode: 0o600 });
    expect(init(root).status).toBe(0);
    expect(lstatSync(join(root, "AGENTS.md")).mode & 0o777).toBe(0o600);
  });

  it("refuses a hard-linked AGENTS.md", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "a.md"), "# Mine\n");
    linkSync(join(root, "a.md"), join(root, "AGENTS.md"));
    const r = init(root);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("hard links");
    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("# Mine\n");
  });

  it("reports a mid-run I/O failure per step and a rerun completes", () => {
    const root = tmpRepo();
    mkdirSync(join(root, "docs/personas"), { recursive: true });
    chmodSync(join(root, "docs/personas"), 0o555);
    const r = init(root, "--json");
    chmodSync(join(root, "docs/personas"), 0o755);
    const j = JSON.parse(r.stdout) as {
      exitCode: number;
      written: boolean;
      failed: boolean;
      actions: { path: string; status: string; note?: string }[];
    };
    expect(r.status).toBe(2);
    expect(j.failed).toBe(true);
    expect(j.written).toBe(true);
    expect(j.actions.find((a) => a.path === "docs/personas/gardener.md")?.note).toMatch(/^failed:/);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    const again = init(root);
    expect(again.status).toBe(0);
    expect(existsSync(join(root, "docs/personas/gardener.md"))).toBe(true);
    expect(run(root, "check").status).toBe(0);
  });

  it("a plan-time refusal prints would create, and --json says written: false", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "AGENTS.md"), `${BLOCK_START}\nx\n`);
    const j = JSON.parse(init(root, "--json").stdout) as { written: boolean };
    expect(j.written).toBe(false);
    expect(init(root).stdout).toMatch(/docs\/Home\.md\s+would create/);
  });
});

describe("Claude Code detection and CLAUDE.md imports", () => {
  it("CLAUDECODE=1 wires CLAUDE.md and the bridge", () => {
    const root = tmpRepo();
    expect(runEnv({ CLAUDECODE: "1" }, root, "init").status).toBe(0);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(lstatSync(join(root, ".claude/skills/doc-gardening/SKILL.md")).isSymbolicLink()).toBe(true);
  });

  it.each(["@AGENTS.md", "- @AGENTS.md", "See @./AGENTS.md for more"])(
    "an existing import (%s) counts",
    (line) => {
      const root = tmpRepo();
      writeFileSync(join(root, "CLAUDE.md"), `# C\n${line}\n`);
      init(root);
      expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(`# C\n${line}\n`);
    },
  );
});

describe("line endings and BOM", () => {
  const cfg = resolveConfig({});
  it("writes CRLF and keeps the BOM, and a rerun is a no-op", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "AGENTS.md"), "\uFEFF# Mine\r\n\r\ntext\r\n");
    expect(init(root).status).toBe(0);
    const text = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(text.startsWith("\uFEFF# Mine\r\n\r\ntext\r\n\r\n" + BLOCK_START + "\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(init(root).stdout).toMatch(/AGENTS\.md\s+unchanged/);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(text);
  });

  it("replaces a stale CRLF block with CRLF", () => {
    const e = applyBlock(`a\r\n${BLOCK_START}\r\nold\r\n${BLOCK_END}\r\nb\r\n`, agentsBlock(cfg));
    expect(e.kind).toBe("ok");
    if (e.kind === "ok") {
      expect(e.status).toBe("updated");
      expect(e.text.startsWith("a\r\n")).toBe(true);
      expect(e.text.endsWith("\r\nb\r\n")).toBe(true);
      expect(/[^\r]\n/.test(e.text)).toBe(false);
    }
  });
});

describe("seed collisions and moved directories", () => {
  it("skips a seed whose name another page owns, and check stays 0", () => {
    const root = tmpRepo();
    mkdirSync(join(root, "docs/ops"), { recursive: true });
    writeFileSync(join(root, "docs/ops/triage.md"), "# Triage\n\nOurs.\n");
    writeFileSync(join(root, "docs/ops/index.md"), "# Ops\n\nSee [[triage]].\n");
    const r = init(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a page named triage already exists at docs/ops/triage.md");
    expect(existsSync(join(root, "docs/personas/triage.md"))).toBe(false);
    expect(run(root, "check").status).toBe(0);
  });

  it("does not copy a second seed set when the skills dir moved", () => {
    const root = tmpRepo();
    init(root, "--claude");
    writeFileSync(
      join(root, "docs-wiki.config.json"),
      JSON.stringify({ skills: { dir: "meta/skills", personasDir: "meta/people" } }),
    );
    const r = init(root, "--claude");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "meta"))).toBe(false);
    expect(r.stdout).toContain("already exists at docs/skills/");
    expect(run(root, "check").status).toBe(0);
  });

  it("reports a bridge link into an old skills dir clearly", () => {
    const root = tmpRepo();
    init(root, "--claude");
    rmSync(join(root, "docs/skills"), { recursive: true });
    rmSync(join(root, "docs/personas"), { recursive: true });
    writeFileSync(
      join(root, "docs-wiki.config.json"),
      JSON.stringify({ skills: { dir: "meta/skills", personasDir: "meta/people" } }),
    );
    const r = init(root, "--claude");
    expect(r.stdout).toMatch(/kept \(yours differs\) \(it links to \.\.\/\.\.\/\.\.\/docs\/skills/);
  });

  it("bridges only skills even when personas nest under the skills dir", () => {
    const root = tmpRepo();
    writeFileSync(
      join(root, "docs-wiki.config.json"),
      JSON.stringify({ skills: { dir: "docs/skills", personasDir: "docs/skills/personas" } }),
    );
    expect(init(root, "--claude").status).toBe(0);
    expect(existsSync(join(root, ".claude/skills/gardener"))).toBe(false);
    expect(existsSync(join(root, ".claude/skills/doc-gardening/SKILL.md"))).toBe(true);
  });
});

describe("copy fallback", () => {
  it("copies, records skipRelative (keeping other keys), shows it in --dry-run, and reruns unchanged", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "docs-wiki.config.json"), JSON.stringify({ port: 9000, skipRelative: ["x"] }));
    const dry = runInit({ root, config: resolveConfig({ port: 9000 }), claude: true, dryRun: true, symlinks: false });
    expect(dry.actions.find((a) => a.path === "docs-wiki.config.json")?.status).toBe("updated");
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);

    const cfg = resolveConfig({ port: 9000 });
    const first = runInit({ root, config: cfg, claude: true, dryRun: false, symlinks: false });
    expect(first.exitCode).toBe(0);
    const link = join(root, ".claude/skills/doc-gardening/SKILL.md");
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "docs-wiki.config.json"), "utf8"))).toEqual({
      port: 9000,
      skipRelative: ["x", ".claude/skills"],
    });
    const before = snapshot(root);
    const second = runInit({ root, config: resolveConfig({ port: 9000, skipRelative: ["x", ".claude/skills"] }), claude: true, dryRun: false, symlinks: false });
    expect(second.actions.every((a) => a.status === "unchanged" || a.status === "skipped")).toBe(true);
    expect(snapshot(root)).toEqual(before);
    expect(run(root, "check").status).toBe(0);
  });
});

describe("Home links the README", () => {
  it("links ../README.md only when it exists, so README is not an orphan", () => {
    const root = tmpRepo();
    writeFileSync(join(root, "README.md"), "# Proj\n");
    init(root);
    expect(readFileSync(join(root, "docs/Home.md"), "utf8")).toContain("](../README.md)");
    expect(run(root, "check").stdout).toContain("0 enforced, 0 reported");
    const bare = tmpRepo();
    init(bare);
    expect(readFileSync(join(bare, "docs/Home.md"), "utf8")).not.toContain("README");
  });
});

describe("a fresh init reports nothing", () => {
  it("init --claude then check: 0 enforced, 0 reported", () => {
    const root = tmpRepo();
    init(root, "--claude");
    expect(run(root, "check").stdout).toContain("0 enforced, 0 reported");
  });

  it("hints when a kept Home.md does not link the instruction files", () => {
    const root = tmpRepo();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/Home.md"), "# Mine\n");
    const r = init(root, "--claude");
    expect(r.stdout).toContain("Hint: link AGENTS.md and CLAUDE.md");
  });
});

// Agent-facing CLI — the primary deliverable. Autonomous sessions run
// `docs-wiki backlinks <file>` before editing a doc (who references this →
// what needs review?) and `docs-wiki check` before a PR. Exit codes:
// 0 clean · 1 enforced lint findings · 2 usage or input error.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { ConfigError, loadConfig } from "./config.ts";
import type { WikiConfig } from "./config.ts";
import { walkCorpus } from "./corpus.ts";
import { runInit } from "./init.ts";
import { skillFiles, seedNotes } from "./seeds.ts";
import { buildIndex, computeOrphans } from "./graph.ts";
import { hasEnforced, lintIndex } from "./lint.ts";
import { normalizePath } from "./resolver.ts";
import { buildSearchIndex, parseQuery, search } from "./search.ts";
import { skillPages } from "./skills.ts";
import type { Edge, WikiIndex } from "./types.ts";

const USAGE = `usage: docs-wiki [command] [options]

commands:
  serve                     browse the wiki at http://127.0.0.1:<port>  (default)
  check                     lint the corpus; exit 1 on enforced findings
  backlinks <file>          pages that link or refer to <file>
  impact [file...]          review checklist: what to re-read after editing
                            those docs. With no files, uses the docs your
                            branch changed vs origin/main.
  search <query...>         full-text search (supports tag:<name> filters)
  tags [name]               list all tags, or the pages carrying one
  orphans                   pages nothing references
  skills                    the skills and personas this repo carries
  guide                     how this corpus grows — the whole contract
  init                      wire this repo up: AGENTS.md section, skills,
                            personas, docs/Home.md (never overwrites)
  seed [name...]            print the seed files for adoption (never writes)

options:
  --json                    machine-readable output (all query commands)
  --dry-run                 init: print the plan, write nothing
  --claude                  init: also create CLAUDE.md and the
                            .claude/skills bridge, even without .claude/
  --root <dir>              corpus root (default: the enclosing git repo)
  --port <n>                serve port (default: config port, else 8123)
  --config <file>           docs-wiki.config.json to apply (default: the one
                            at the corpus root, if any; the DOCS_WIKI_CONFIG
                            environment variable names one for repos that do
                            not carry their own)
`;

interface Args {
  command: string;
  positional: string[];
  json: boolean;
  dryRun: boolean;
  claude: boolean;
  root: string;
  /** null = not given on the command line; falls back to config.port. */
  port: number | null;
  /** Explicit --config path, when given. */
  config: string | null;
}

function parseArgs(argv: string[]): Args | null {
  const positional: string[] = [];
  let json = false;
  let dryRun = false;
  let claude = false;
  let root: string | null = null;
  let port: number | null = null;
  let config: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--claude") claude = true;
    else if (a === "--root") {
      root = argv[i + 1] ?? null;
      if (root === null) return null;
      i += 1;
    } else if (a === "--config") {
      config = argv[i + 1] ?? null;
      if (config === null) return null;
      i += 1;
    } else if (a === "--port") {
      port = Number(argv[i + 1]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
      i += 1;
    } else if (a.startsWith("--")) return null;
    else positional.push(a);
  }
  return {
    command: positional[0] ?? "serve",
    positional: positional.slice(1),
    json,
    dryRun,
    claude,
    root: root === null ? findRepoRoot(process.cwd()) : resolve(root),
    port,
    config,
  };
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Nearest ancestor containing .git (a dir in the main checkout, a file in
 *  a worktree). Falls back to cwd. */
function findRepoRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

/** Accepts repo-relative, ./-prefixed, or absolute paths. */
function toPageId(input: string, root: string): string {
  const abs = isAbsolute(input) ? input : null;
  const rel =
    abs !== null && abs.startsWith(root + sep)
      ? abs.slice(root.length + 1)
      : abs !== null
        ? input // absolute but outside root — will simply not match a page
        : input;
  return normalizePath(rel.split(sep).join("/"));
}

function gitLines(root: string, args: string[]): string[] | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
  } catch {
    return null; // git absent, no such ref, not a repo
  }
}

/**
 * Markdown files this branch has changed: committed vs origin/main, PLUS
 * staged and unsaved working-tree edits — the doc you are editing right now
 * is the one you most need the impact of, and it is not committed yet.
 *
 * An empty result means "nothing changed" and is returned as such. It must
 * NOT fall back to another range: an earlier version fell through to HEAD~1
 * when the range was clean, so a session with no doc edits at all got a
 * confident checklist for somebody else's last commit.
 */
function changedDocs(root: string): string[] | null {
  const committed = gitLines(root, [
    "diff",
    "--name-only",
    "origin/main...HEAD",
  ]);
  // origin/main can legitimately be missing (fresh clone, no remote); fall
  // back to the default branch only when the REF fails, never when it is
  // merely empty.
  const base =
    committed ?? gitLines(root, ["diff", "--name-only", "main...HEAD"]);
  if (base === null) return null; // no resolvable base branch
  const staged = gitLines(root, ["diff", "--name-only", "--cached"]) ?? [];
  const unstaged = gitLines(root, ["diff", "--name-only"]) ?? [];

  return [...new Set([...base, ...staged, ...unstaged])]
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort();
}

function describeEdge(e: Edge): string {
  const kind =
    e.type === "link" || e.type === "wikilink"
      ? e.type
      : `${e.type} "${e.raw}"`;
  return `${e.from}:${e.line}  ${kind}`;
}

function printBacklinks(index: WikiIndex, id: string, json: boolean): void {
  const edges = index.backlinks.get(id) ?? [];
  if (json) {
    console.log(
      JSON.stringify(
        {
          page: id,
          backlinks: edges.map((e) => ({
            from: e.from,
            line: e.line,
            type: e.type,
            raw: e.raw,
            ...(e.anchor !== undefined ? { anchor: e.anchor } : {}),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const explicit = edges.filter(
    (e) => e.type === "link" || e.type === "wikilink",
  );
  const mentions = edges.filter(
    (e) => e.type !== "link" && e.type !== "wikilink",
  );
  const pages = new Set(edges.map((e) => e.from));
  console.log(
    `Backlinks of ${id} — ${pages.size} page(s), ${edges.length} edge(s)`,
  );
  if (explicit.length > 0) {
    console.log("  explicit links:");
    for (const e of explicit) console.log(`    ${describeEdge(e)}`);
  }
  if (mentions.length > 0) {
    console.log("  mentions:");
    for (const e of mentions) console.log(`    ${describeEdge(e)}`);
  }
  if (edges.length === 0) console.log("  (none — this page is an orphan)");
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    process.stderr.write(USAGE);
    return 2;
  }

  let config: WikiConfig;
  try {
    config = loadConfig(args.root, args.config ?? undefined);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    process.stderr.write(`${err.message}\n`);
    return 2;
  }

  if (args.command === "serve") {
    const { serveWiki } = await import("./server.ts");
    await serveWiki({
      root: args.root,
      port: args.port ?? config.port,
      config,
    });
    return 0;
  }

  if (args.command === "init") {
    if (!isDirectory(args.root)) {
      process.stderr.write(`init: ${args.root} is not a directory\n`);
      return 2;
    }
    const result = runInit({
      root: args.root,
      config,
      claude: args.claude,
      dryRun: args.dryRun,
    });
    if (args.json) {
      console.log(
        JSON.stringify(
          { dryRun: args.dryRun, ...result },
          null,
          2,
        ),
      );
      return result.exitCode;
    }
    const w = Math.max(...result.actions.map((a) => a.path.length));
    // A plan-time refusal writes nothing, so created/updated read "would ...".
    const refusedPlan = result.exitCode === 2 && !result.failed;
    const word = (s: string): string =>
      refusedPlan && s === "created"
        ? "would create"
        : refusedPlan && s === "updated"
          ? "would update"
          : s;
    for (const a of result.actions) {
      const status =
        a.status === "skipped"
          ? `skipped (${a.note ?? "no reason given"})`
          : a.note !== undefined
            ? `${word(a.status)} (${a.note})`
            : word(a.status);
      console.log(`${a.path.padEnd(w)}  ${status}`);
    }
    if (result.exitCode === 2) {
      process.stderr.write(
        result.failed
          ? "init: some steps failed (see above); fix the cause and run it again to finish\n"
          : "init: refused, nothing was written; fix what is flagged above and run it again\n",
      );
    } else {
      if (args.dryRun) console.log("(dry run: nothing was written)");
      console.log("");
      for (const n of result.nextSteps) console.log(n);
    }
    return result.exitCode;
  }

  const corpus = walkCorpus(args.root, config);
  const index = buildIndex(corpus);

  switch (args.command) {
    case "check": {
      const findings = lintIndex(corpus, index);
      if (args.json) {
        console.log(JSON.stringify(findings, null, 2));
      } else {
        for (const f of findings) {
          console.log(
            `${f.code} ${f.page}:${f.line} [${f.severity}] ${f.message}`,
          );
        }
        const enforced = findings.filter(
          (f) => f.severity === "enforced",
        ).length;
        console.log(
          `${enforced} enforced, ${findings.length - enforced} reported ` +
            `(${index.pages.size} pages, ${index.edges.length} edges)`,
        );
      }
      return hasEnforced(findings) ? 1 : 0;
    }

    case "backlinks": {
      const input = args.positional[0];
      if (input === undefined) {
        process.stderr.write(USAGE);
        return 2;
      }
      const id = toPageId(input, args.root);
      if (!index.pages.has(id)) {
        process.stderr.write(`not a page in the corpus: ${id}\n`);
        return 2;
      }
      printBacklinks(index, id, args.json);
      return 0;
    }

    case "search": {
      const query = args.positional.join(" ");
      if (query.trim() === "") {
        process.stderr.write(USAGE);
        return 2;
      }
      const { tags: wanted, text } = parseQuery(query);
      const carries = (id: string): boolean =>
        wanted.every((t) => (index.tagIndex.get(t) ?? []).includes(id));
      const hits =
        text.trim() === ""
          ? [...index.pages.values()]
              .filter((p) => carries(p.id))
              .map((p) => ({ id: p.id, title: p.title, score: 1 }))
          : search(buildSearchIndex(corpus), text, 60).filter((h) =>
              carries(h.id),
            );
      if (args.json) console.log(JSON.stringify(hits, null, 2));
      else if (hits.length === 0) console.log("no matches");
      else
        for (const h of hits)
          console.log(`${h.score.toFixed(2).padStart(8)}  ${h.id}  ${h.title}`);
      return 0;
    }

    // The command the doc-editing workflow is actually built around: you
    // changed these docs, so THESE are the pages that state something about
    // them and may now be stale. Ranked by how heavily each referrer leans
    // on the changed doc, because that correlates with how likely it is to
    // repeat a fact that just moved.
    case "impact": {
      const explicit = args.positional.length > 0;
      let requested: string[];
      if (explicit) {
        requested = args.positional.map((p) => toPageId(p, args.root));
      } else {
        const changed = changedDocs(args.root);
        if (changed === null) {
          process.stderr.write(
            "docs-wiki impact: cannot find a base branch to compare against " +
              "(neither origin/main nor main resolves here).\n" +
              "Name the docs explicitly instead: docs-wiki impact <file>...\n",
          );
          return 2;
        }
        requested = changed;
      }

      // An explicit argument that is not a page is a typo and should fail
      // loudly. A git-derived one is routine — a changed .md may legitimately
      // be outside the corpus (the wiki's own fixtures are excluded by
      // design), so those are skipped, not fatal.
      const unknown = requested.filter((t) => !index.pages.has(t));
      if (explicit && unknown.length > 0) {
        process.stderr.write(
          `not pages in the corpus: ${unknown.join(", ")}\n`,
        );
        return 2;
      }
      const targets = requested.filter((t) => index.pages.has(t));
      if (!explicit && unknown.length > 0 && !args.json) {
        console.log(
          `(skipped ${unknown.length} changed file(s) outside the corpus)`,
        );
      }

      if (targets.length === 0) {
        if (args.json) console.log("[]");
        else console.log("no changed docs vs origin/main — nothing to review");
        return 0;
      }

      const report = targets.map((target) => {
        const byPage = new Map<
          string,
          { page: string; line: number; count: number }
        >();
        for (const e of index.backlinks.get(target) ?? []) {
          const seen = byPage.get(e.from);
          if (seen === undefined) {
            byPage.set(e.from, { page: e.from, line: e.line, count: e.count });
          } else {
            seen.count += e.count;
            seen.line = Math.min(seen.line, e.line);
          }
        }
        return {
          changed: target,
          referrers: [...byPage.values()].sort(
            (a, b) => b.count - a.count || a.page.localeCompare(b.page),
          ),
        };
      });

      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
        return 0;
      }
      for (const { changed, referrers } of report) {
        console.log(`\n${changed} — ${referrers.length} page(s) reference it`);
        if (referrers.length === 0) {
          console.log("  (nothing references it; no review needed)");
          continue;
        }
        for (const r of referrers) {
          console.log(
            `  [ ] ${r.page}:${r.line}  (${r.count} reference${r.count === 1 ? "" : "s"})`,
          );
        }
      }
      console.log("\nRe-read each box: does it still say something true?");
      return 0;
    }

    case "tags": {
      const name = args.positional[0]?.toLowerCase();
      if (name === undefined) {
        const rows = [...index.tagIndex.entries()]
          .sort(
            ([a, pa], [b, pb]) => pb.length - pa.length || a.localeCompare(b),
          )
          .map(([tag, ids]) => ({ tag, pages: ids.length }));
        if (args.json) console.log(JSON.stringify(rows, null, 2));
        else
          for (const r of rows)
            console.log(`${String(r.pages).padStart(4)}  ${r.tag}`);
        return 0;
      }
      const ids = index.tagIndex.get(name);
      if (ids === undefined) {
        process.stderr.write(`no such tag: ${name}\n`);
        return 2;
      }
      if (args.json) console.log(JSON.stringify(ids, null, 2));
      else for (const id of ids) console.log(id);
      return 0;
    }

    case "orphans": {
      const orphans = computeOrphans(index);
      if (args.json) console.log(JSON.stringify(orphans, null, 2));
      else if (orphans.length === 0) console.log("no orphans");
      else for (const id of orphans) console.log(id);
      return 0;
    }

    case "skills": {
      const records = skillPages(corpus, index);
      if (args.json) {
        console.log(JSON.stringify(records, null, 2));
        return 0;
      }
      if (!config.skills.enabled) {
        console.log(
          'the skills layer is disabled ("skills": false in docs-wiki.config.json)',
        );
        return 0;
      }
      if (records.length === 0) {
        console.log(
          "no skills or personas — run docs-wiki init to adopt the seeds",
        );
        return 0;
      }
      const wStatus = Math.max(
        ...records.map((r) => (r.status ?? "(none)").length),
      );
      const wId = Math.max(...records.map((r) => r.id.length));
      for (const r of records) {
        console.log(
          `${(r.status ?? "(none)").padEnd(wStatus)}  ${r.role.padEnd(7)}  ` +
            `${r.id.padEnd(wId)}  ${r.title}` +
            (r.missing.length > 0 ? `  (malformed: ${r.missing.join(", ")})` : ""),
        );
        if (r.description !== "") console.log(`    ${r.description}`);
      }
      const nSkills = records.filter((r) => r.role === "skill").length;
      const nPersonas = records.length - nSkills;
      console.log(
        `${nSkills} skill${nSkills === 1 ? "" : "s"}, ` +
          `${nPersonas} persona${nPersonas === 1 ? "" : "s"}`,
      );
      return 0;
    }

    case "guide": {
      // Lazy like `serve`: guide.ts pulls the library barrel (for the
      // version), which the other query commands have no need to load.
      const { growthGuide, growthGuideJson } = await import("./guide.ts");
      if (args.json) {
        console.log(JSON.stringify(growthGuideJson(corpus, index), null, 2));
      } else {
        console.log(growthGuide(corpus, index));
      }
      return 0;
    }

    // Prints the shipped seeds (all of it, or the named pages) with the
    // config-resolved target path over each file, then the adoption notes.
    // Deliberately NEVER writes: docs-wiki's authority is reading and
    // checking, and the adopter — who has judgment — writes and commits.
    case "seed": {
      let files = skillFiles(config);
      if (args.positional.length > 0) {
        const byName = new Map(
          files.map((f) => [
            (f.path.split("/").pop() ?? f.path).replace(/\.md$/, ""),
            f,
          ]),
        );
        const chosen = [];
        for (const name of args.positional) {
          const file = byName.get(name);
          if (file === undefined) {
            process.stderr.write(
              `no such seed file: ${name} (have: ${[...byName.keys()].join(", ")})\n`,
            );
            return 2;
          }
          chosen.push(file);
        }
        files = chosen;
      }
      const notes = seedNotes(config);
      if (args.json) {
        console.log(JSON.stringify({ files, notes }, null, 2));
        return 0;
      }
      for (const f of files) {
        process.stdout.write(
          `--- ${f.path} ---\n${f.content}${f.content.endsWith("\n") ? "" : "\n"}\n`,
        );
      }
      for (const n of notes) console.log(n);
      return 0;
    }

    default:
      process.stderr.write(USAGE);
      return 2;
  }
}

// Invoked directly (node cli.ts …), not under vitest.
// argv[1] may be a symlink (npm and pnpm install bins as symlinks) while
// import.meta.url is always the real path, so compare real paths.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // process.exitCode, never process.exit(): a large --json payload (`seed`
  // prints the whole seed set, ~24 KB) can still be queued on a piped stdout
  // when main resolves, and exit() truncates it mid-write. Setting exitCode
  // lets the process drain stdout and leave on its own.
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 2;
    },
  );
}

// `docs-wiki init` — wire a repo up so an agent that opens it discovers the
// tool, knows to use it, and knows how. It writes ONLY the files below, never
// overwrites anything the adopter has changed, and is idempotent: a second run
// reports `unchanged` everywhere and leaves every byte alone.
//
//   AGENTS.md        a marked block (read at session start by most agents)
//   CLAUDE.md        a marked block importing AGENTS.md (Claude Code)
//   skills/personas  the bundled seeds, at their config-resolved paths
//   .claude/skills   relative symlinks to the skill files (Claude Code)
//   docs/Home.md     a starter home page
//
// Planning is separate from writing: every action is decided (and every path
// validated) first, and nothing is written when any action is refused.

import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative } from "node:path";

import type { WikiConfig } from "./config.ts";
import { walkCorpus } from "./corpus.ts";
import { FENCE } from "./parser.ts";
import { seedSets } from "./seeds.ts";
import type { SkillFile } from "./seeds.ts";

export const BLOCK_START = "<!-- docs-wiki:start -->";
export const BLOCK_END = "<!-- docs-wiki:end -->";

export type InitStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "kept (yours differs)"
  | "skipped";

export interface InitAction {
  path: string;
  status: InitStatus;
  /** Reason for `skipped`, or an extra remark. */
  note?: string;
  /** True when the action is a refusal or a failure that makes the run exit 2. */
  error?: boolean;
}

export interface InitOptions {
  root: string;
  config: WikiConfig;
  /** Create CLAUDE.md and the .claude/skills bridge even without .claude/. */
  claude: boolean;
  dryRun: boolean;
  /** Environment to read CLAUDECODE from (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /** Test hook: force symlink support on or off (default: probe). */
  symlinks?: boolean;
}

export interface InitResult {
  actions: InitAction[];
  /** True once at least one step changed the disk. False for a dry run and
   *  for a plan-time refusal, whose statuses are what init WOULD do. */
  written: boolean;
  /** True when a step threw mid-run (as opposed to a plan-time refusal). */
  failed: boolean;
  /** 2 when anything was refused, else 0. */
  exitCode: 0 | 2;
  nextSteps: string[];
}

/** The AGENTS.md section, generated from the live config so its paths match
 *  where skills and personas actually live. */
export function agentsBlock(config: WikiConfig): string {
  const { enabled, dir, personasDir } = config.skills;
  const lines = [
    BLOCK_START,
    "## Project memory (docs-wiki)",
    "",
    "This repo keeps its long-term working memory as markdown in `docs/`. People",
    "browse it with `npx docs-wiki serve`; you read and write it as plain files.",
    "",
    "At the start of a session:",
    "- Skim `docs/Home.md`, then run `npx docs-wiki guide` unless you have",
    "  already read it this session.",
    "",
    "While you build, write things down as you go:",
    "- A decision goes in `docs/decisions/`, in a file named",
    "  `NNNN-short-title.md`, with a `Status: accepted` line and the context and",
    "  why.",
    "- An idea that keeps coming up gets a page in `docs/concepts/`.",
    "- A procedure you worked out goes in `docs/runbooks/`.",
    "- Link related pages with `[[wikilinks]]`. Update a page rather than",
    "  duplicating it.",
    "- Before editing a doc, run `npx docs-wiki backlinks <file>` to see what",
    "  depends on it.",
    "",
  ];
  if (enabled) {
    lines.push(
      "Skills and personas:",
      `- \`${dir}\` holds procedures for recurring jobs. \`npx docs-wiki skills\``,
      '  lists them with their "Use when…" line. Read the matching one before you',
      "  do that job.",
      `- \`${personasDir}\` holds stances for kinds of work.`,
      "",
    );
  }
  lines.push(
    "Before you finish:",
    "- Run `npx docs-wiki check`. It must exit 0, so fix every enforced finding.",
  );
  lines.push(
    enabled
      ? `- At the end of a session, follow \`${dir}sleep-consolidation.md\`: write\n  down what you learned, and leave a short, state-only handoff in your final\n  message or pull request description (not in docs/).`
      : "- At the end of a session, write down what you learned, and leave a short,\n  state-only handoff in your final message or pull request description (not\n  in docs/).",
  );
  lines.push(
    "- Future work goes in the issue tracker, not in TODO comments.",
    BLOCK_END,
  );
  return lines.join("\n");
}

const CLAUDE_BLOCK = `${BLOCK_START}\n@AGENTS.md\n${BLOCK_END}`;

/** Starter docs/Home.md. Links only to pages that exist after init. */
export function homePage(config: WikiConfig, hasReadme = false, hasClaude = false): string {
  const { enabled, dir, personasDir } = config.skills;
  const lines = [
    "# Home",
    "",
    "This is the long-term working memory for this project: what was decided,",
    "why, and how things are done. Agents write here as they build; people",
    "browse it with `npx docs-wiki serve`. Update a page rather than starting a",
    "duplicate, and link related pages with `[[wikilinks]]`.",
    "",
    "Where things go:",
    "",
    "- `docs/decisions/` has one record per decision, named `NNNN-short-title.md`,",
    "  with a `Status:` line (for example `Status: accepted`).",
    "- `docs/concepts/` has one page per idea that keeps coming up.",
    "- `docs/runbooks/` has procedures that were worked out once and are worth",
    "  repeating.",
  ];
  if (enabled) {
    lines.push(
      `- \`${dir}\` has procedures for recurring jobs, and \`${personasDir}\` has`,
      "  stances for kinds of work. Start with [[sleep-consolidation]], which",
      "  describes how to end a session, and [[doc-gardening]], which describes",
      "  how to keep this corpus tidy.",
    );
  }
  if (hasReadme) {
    lines.push("", "For the project itself, see the [README](../README.md).");
  }
  lines.push(
    "",
    "Agent instructions: [AGENTS.md](../AGENTS.md)" +
      (hasClaude ? " and [CLAUDE.md](../CLAUDE.md)" : "") +
      " tell agents to use all of this.",
    "Run `npx docs-wiki guide` for the full contract.",
  );
  return `${lines.join("\n")}\n`;
}

// ---- marker handling -------------------------------------------------------

type BlockEdit =
  | { kind: "ok"; text: string; status: "created" | "updated" | "unchanged" }
  | { kind: "malformed"; reason: string };

/** Indexes of lines that are exactly `marker` (trimmed) and not inside a
 *  fenced code block. An inline mention in prose or in backticks is not a
 *  marker. */
function markerLines(lines: string[], marker: string): number[] {
  const out: number[] = [];
  let fence: { ch: string; len: number } | null = null;
  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (fence === null) {
      if (m !== null) {
        fence = { ch: m[1][0], len: m[1].length };
        return;
      }
    } else {
      if (m !== null && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === "") {
        fence = null;
      }
      return;
    }
    if (line.trim() === marker) out.push(i);
  });
  return out;
}

/** How many real start and end markers a text carries. */
export function countMarkers(text: string): { starts: number; ends: number } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return {
    starts: markerLines(lines, BLOCK_START).length,
    ends: markerLines(lines, BLOCK_END).length,
  };
}

/** Insert or replace the marked block in `existing` (null = no file). Text
 *  outside the markers is never touched; the file's line endings and BOM are
 *  kept, and compared EOL-insensitively so a rerun is a no-op. */
export function applyBlock(existing: string | null, block: string): BlockEdit {
  if (existing === null) return { kind: "ok", text: `${block}\n`, status: "created" };
  const bom = existing.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = existing.slice(bom.length);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const norm = body.replace(/\r\n/g, "\n");
  const lines = norm.split("\n");
  const starts = markerLines(lines, BLOCK_START);
  const ends = markerLines(lines, BLOCK_END);
  const finish = (text: string, status: "updated"): BlockEdit => ({
    kind: "ok",
    text: bom + text.replace(/\n/g, eol),
    status,
  });
  if (starts.length === 0 && ends.length === 0) {
    const sep = norm === "" ? "" : norm.endsWith("\n\n") ? "" : norm.endsWith("\n") ? "\n" : "\n\n";
    return finish(`${norm}${sep}${block}\n`, "updated");
  }
  if (starts.length !== 1 || ends.length !== 1) {
    return {
      kind: "malformed",
      reason: `expected exactly one ${BLOCK_START} line and one ${BLOCK_END} line, found ${starts.length} and ${ends.length}`,
    };
  }
  if (starts[0] > ends[0]) {
    return { kind: "malformed", reason: "the end marker comes before the start marker" };
  }
  const offsets: number[] = [];
  let at = 0;
  for (const l of lines) {
    offsets.push(at);
    at += l.length + 1;
  }
  const from = offsets[starts[0]];
  const to = offsets[ends[0]] + lines[ends[0]].length;
  if (norm.slice(from, to) === block) return { kind: "ok", text: existing, status: "unchanged" };
  return finish(norm.slice(0, from) + block + norm.slice(to), "updated");
}

// ---- path safety -----------------------------------------------------------

type PathCheck = { ok: true; abs: string } | { ok: false; reason: string };

/** A repo-relative path is writable only when it is relative, stays inside the
 *  root, and no existing ancestor directory is a symlink. */
function checkPath(root: string, rel: string): PathCheck {
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    return { ok: false, reason: `${rel} is an absolute path` };
  }
  const norm = posix.normalize(rel.split("\\").join("/"));
  if (norm === ".." || norm.startsWith("../") || norm === ".") {
    return { ok: false, reason: `${rel} resolves outside the repo root` };
  }
  if (norm.split("/")[0] === ".git") {
    return { ok: false, reason: `${rel} is inside .git` };
  }
  const abs = join(root, norm);
  let cur = root;
  const parts = norm.split("/");
  for (const part of parts.slice(0, -1)) {
    cur = join(cur, part);
    const st = lstatOrNull(cur);
    if (st === null) break;
    if (st.isSymbolicLink()) {
      return { ok: false, reason: `${relative(root, cur)} is a symlink` };
    }
    if (!st.isDirectory()) {
      return { ok: false, reason: `${relative(root, cur)} is not a directory` };
    }
  }
  return { ok: true, abs };
}

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// ---- atomic-ish write ------------------------------------------------------

function writeAtomic(abs: string, content: string, mode?: number): void {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = join(
    dirname(abs),
    `.${basename(abs)}.docs-wiki-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    writeFileSync(tmp, content, { flag: "wx" });
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, abs);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Why an existing file cannot be safely rewritten in place, or null. */
function unwritableReason(abs: string, st: Stats): string | null {
  if (st.nlink > 1) return "it has other hard links (rewriting would detach them)";
  try {
    accessSync(abs, constants.W_OK);
  } catch {
    return "it is not writable";
  }
  return null;
}

// ---- the plan --------------------------------------------------------------

interface Step {
  action: InitAction;
  /** Present only when the step changes something on disk. */
  run?: () => void;
}

const refuse = (rel: string, why: string): Step => ({
  action: { path: rel, status: "skipped", note: `refused: ${why}`, error: true },
});

function planTextFile(
  root: string,
  rel: string,
  compute: (existing: string | null) => BlockEdit,
  steps: Step[],
): void {
  const c = checkPath(root, rel);
  if (!c.ok) return void steps.push(refuse(rel, c.reason));
  const st = lstatOrNull(c.abs);
  if (st !== null && st.isSymbolicLink()) return void steps.push(refuse(rel, "it is a symlink"));
  if (st !== null && !st.isFile()) return void steps.push(refuse(rel, "not a regular file"));
  const existing = st === null ? null : readFileSync(c.abs, "utf8");
  const edit = compute(existing);
  if (edit.kind === "malformed") {
    return void steps.push(refuse(rel, `markers are malformed (${edit.reason}); fix them by hand`));
  }
  if (edit.status === "unchanged") return void steps.push({ action: { path: rel, status: "unchanged" } });
  if (st !== null) {
    const why = unwritableReason(c.abs, st);
    if (why !== null) return void steps.push(refuse(rel, why));
  }
  const mode = st === null ? undefined : st.mode & 0o7777;
  steps.push({
    action: { path: rel, status: edit.status },
    run: () => writeAtomic(c.abs, edit.text, mode),
  });
}

function planCreateOnly(root: string, rel: string, content: string, steps: Step[]): void {
  const c = checkPath(root, rel);
  if (!c.ok) return void steps.push(refuse(rel, c.reason));
  const st = lstatOrNull(c.abs);
  if (st === null) {
    steps.push({ action: { path: rel, status: "created" }, run: () => writeAtomic(c.abs, content) });
    return;
  }
  if (st.isSymbolicLink() || !st.isFile()) return void steps.push(refuse(rel, "not a regular file"));
  steps.push({
    action: {
      path: rel,
      status: readFileSync(c.abs, "utf8") === content ? "unchanged" : "kept (yours differs)",
    },
  });
}

/** Does CLAUDE.md already import AGENTS.md (`@AGENTS.md`, `@./AGENTS.md`),
 *  on a line of its own, in a list item, or inline? Fenced code is ignored,
 *  as Claude Code ignores imports there. */
function importsAgents(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let fence: { ch: string; len: number } | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (fence === null) {
      if (m !== null) {
        fence = { ch: m[1][0], len: m[1].length };
        continue;
      }
    } else {
      if (m !== null && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === "") fence = null;
      continue;
    }
    if (/(^|\s)@(\.\/)?AGENTS\.md(?![\w.-])/.test(line)) return true;
  }
  return false;
}

function canSymlink(): boolean {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "docs-wiki-probe-"));
    writeFileSync(join(dir, "t"), "");
    symlinkSync("t", join(dir, "l"));
    return true;
  } catch {
    return false;
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

/** Where a page named like a seed already lives, if anywhere but its target. */
function collisionFor(
  docs: ReadonlyMap<string, { aliases: string[] }>,
  name: string,
  target: string,
): string | null {
  const want = name.toLowerCase();
  for (const [id, doc] of docs) {
    if (id === target) continue;
    const base = (id.split("/").pop() ?? id).replace(/\.md$/i, "").toLowerCase();
    if (base === want || doc.aliases.some((a) => a.toLowerCase() === want)) return id;
  }
  return null;
}

export function planInit(opts: InitOptions): { steps: Step[]; extra: string[] } {
  const { root, config } = opts;
  const env = opts.env ?? process.env;
  const steps: Step[] = [];
  const extra: string[] = [];
  const bridge =
    opts.claude || existsSync(join(root, ".claude")) || env.CLAUDECODE === "1";

  planTextFile(root, "AGENTS.md", (e) => applyBlock(e, agentsBlock(config)), steps);

  if (bridge || lstatOrNull(join(root, "CLAUDE.md")) !== null) {
    planTextFile(
      root,
      "CLAUDE.md",
      (e) => {
        const m = e === null ? { starts: 0, ends: 0 } : countMarkers(e);
        if (e !== null && m.starts === 0 && m.ends === 0 && importsAgents(e)) {
          return { kind: "ok", text: e, status: "unchanged" };
        }
        return applyBlock(e, CLAUDE_BLOCK);
      },
      steps,
    );
  } else {
    steps.push({
      action: {
        path: "CLAUDE.md",
        status: "skipped",
        note: "no CLAUDE.md and no .claude/ here (pass --claude to create it)",
      },
    });
  }

  const present = new Set<string>(); // skill names whose page will exist at its target
  const skillSeeds: SkillFile[] = [];
  if (!config.skills.enabled) {
    steps.push({
      action: {
        path: config.skills.dir,
        status: "skipped",
        note: 'the skills layer is disabled in config ("skills": false)',
      },
    });
  } else {
    const docs = walkCorpus(root, config).docs;
    const sets = seedSets(config);
    for (const [kind, files] of [["skills", sets.skills], ["personas", sets.personas]] as const) {
      for (const f of files) {
        const name = basename(f.path, ".md");
        const clash = collisionFor(docs, name, f.path);
        if (clash !== null && lstatOrNull(join(root, f.path)) === null) {
          steps.push({
            action: {
              path: f.path,
              status: "skipped",
              note: `a page named ${name} already exists at ${clash}`,
            },
          });
          continue;
        }
        const before = steps.length;
        planCreateOnly(root, f.path, f.content, steps);
        if (kind === "skills" && steps[before].action.error !== true) {
          present.add(name);
          skillSeeds.push(f);
        }
      }
    }
  }

  const bridgeSteps = bridge && skillSeeds.length > 0;
  if (bridgeSteps) {
    const symlinks = opts.symlinks ?? canSymlink();
    let needsSkip = !symlinks;
    for (const f of skillSeeds) {
      const name = basename(f.path, ".md");
      const rel = `.claude/skills/${name}/SKILL.md`;
      const c = checkPath(root, rel);
      if (!c.ok) {
        steps.push({ action: { path: rel, status: "skipped", note: c.reason } });
        continue;
      }
      const target = posix.relative(posix.dirname(rel), f.path);
      const st = lstatOrNull(c.abs);
      if (st === null) {
        steps.push({
          action: { path: rel, status: "created", ...(symlinks ? {} : { note: "a copy; symlinks are unavailable here" }) },
          run: () => {
            mkdirSync(dirname(c.abs), { recursive: true });
            if (symlinks) {
              try {
                symlinkSync(target, c.abs);
                return;
              } catch {
                extra.push(`${rel}: symlinks are unavailable here, so it is a copy`);
                ensureSkipRelative(root);
              }
            }
            writeAtomic(c.abs, f.content);
          },
        });
      } else if (st.isSymbolicLink()) {
        const cur = readlinkSync(c.abs);
        steps.push(
          cur === target
            ? { action: { path: rel, status: "unchanged" } }
            : {
                action: {
                  path: rel,
                  status: "kept (yours differs)",
                  note: `it links to ${cur}, not ${target}; if the skills directory moved, repoint or remove it by hand`,
                },
              },
        );
      } else if (st.isFile() && readFileSync(c.abs, "utf8") === f.content) {
        needsSkip = true;
        steps.push({ action: { path: rel, status: "unchanged", note: "a copy" } });
      } else {
        steps.push({ action: { path: rel, status: "kept (yours differs)", note: "something else is at this path" } });
      }
    }
    if (needsSkip) planSkipRelative(root, steps);
  }

  planHome(opts, steps, extra, bridge || lstatOrNull(join(root, "CLAUDE.md")) !== null);
  // Keep the memory directories present in git so the mentions of them in
  // AGENTS.md and Home.md resolve. Only when the directory is absent or the
  // placeholder is already ours. These three are fixed, not derived from the
  // `kinds` config (see docs/configuration.md).
  for (const dir of ["docs/decisions", "docs/concepts", "docs/runbooks"]) {
    const keep = `${dir}/.gitkeep`;
    const c = checkPath(root, keep);
    if (!c.ok) continue; // the same symlinked docs/ is refused at Home.md
    if (lstatOrNull(c.abs) !== null) {
      steps.push({ action: { path: keep, status: "unchanged" } });
    } else if (lstatOrNull(join(root, dir)) === null) {
      steps.push({ action: { path: keep, status: "created" }, run: () => writeAtomic(c.abs, "") });
    }
  }
  return { steps, extra };
}

const CONFIG_FILE = "docs-wiki.config.json";

/** Add ".claude/skills" to skipRelative, keeping every other key. Returns the
 *  new text, or null when nothing needs doing. */
function skipRelativeEdit(abs: string): { text: string } | { note: string } | null {
  let obj: Record<string, unknown> = {};
  if (lstatOrNull(abs) !== null) {
    try {
      obj = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
    } catch {
      return { note: `${CONFIG_FILE} is not valid JSON; add ".claude/skills" to skipRelative by hand` };
    }
  }
  const cur = Array.isArray(obj.skipRelative) ? (obj.skipRelative as unknown[]) : [];
  if (cur.includes(".claude/skills")) return null;
  obj.skipRelative = [...cur, ".claude/skills"];
  return { text: `${JSON.stringify(obj, null, 2)}\n` };
}

function planSkipRelative(root: string, steps: Step[]): void {
  const c = checkPath(root, CONFIG_FILE);
  if (!c.ok) return void steps.push(refuse(CONFIG_FILE, c.reason));
  const st = lstatOrNull(c.abs);
  if (st !== null && (st.isSymbolicLink() || !st.isFile())) {
    return void steps.push(refuse(CONFIG_FILE, "not a regular file"));
  }
  const edit = skipRelativeEdit(c.abs);
  if (edit === null) return void steps.push({ action: { path: CONFIG_FILE, status: "unchanged" } });
  if ("note" in edit) {
    return void steps.push({ action: { path: CONFIG_FILE, status: "skipped", note: edit.note } });
  }
  if (st !== null) {
    const why = unwritableReason(c.abs, st);
    if (why !== null) return void steps.push(refuse(CONFIG_FILE, why));
  }
  steps.push({
    action: {
      path: CONFIG_FILE,
      status: st === null ? "created" : "updated",
      note: 'adds ".claude/skills" to skipRelative so copies are not walked',
    },
    run: () => writeAtomic(c.abs, edit.text, st === null ? undefined : st.mode & 0o7777),
  });
}

/** Run-time fallback only: a symlink the probe allowed still failed. */
function ensureSkipRelative(root: string): void {
  const abs = join(root, CONFIG_FILE);
  const edit = skipRelativeEdit(abs);
  if (edit !== null && "text" in edit) writeAtomic(abs, edit.text);
}

export function runInit(opts: InitOptions): InitResult {
  const { steps, extra } = planInit(opts);
  const refused = steps.some((s) => s.action.error === true);
  let written = false;
  let failed = false;
  if (!refused && !opts.dryRun) {
    for (const s of steps) {
      if (s.run === undefined) continue;
      try {
        s.run();
        written = true;
      } catch (err) {
        failed = true;
        s.action = {
          path: s.action.path,
          status: "skipped",
          note: `failed: ${err instanceof Error ? err.message : String(err)}`,
          error: true,
        };
      }
    }
  }
  const actions = steps.map((s) => s.action);
  const nextSteps = failed
    ? [
        "Some steps failed (see above); earlier steps were written. Fix the cause and run init again: it completes what is missing and leaves the rest alone.",
        ...extra,
      ]
    : [
        "Next: run `npx docs-wiki check` and fix anything it enforces, then commit the result.",
        "Re-running init is safe: it never overwrites what you have changed.",
        ...extra,
      ];
  return { actions, written, failed, exitCode: refused || failed ? 2 : 0, nextSteps };
}

function planHome(opts: InitOptions, steps: Step[], extra: string[], hasClaude: boolean): void {
  const { root, config } = opts;
  const rel = "docs/Home.md";
  // Another configured entry page already present means a home exists.
  const others = config.entryPages.filter((p) => p !== "README.md" && p !== rel);
  const existingOther = others.find((p) => lstatOrNull(join(root, p)) !== null);
  if (existingOther !== undefined && lstatOrNull(join(root, rel)) === null) {
    steps.push({ action: { path: rel, status: "skipped", note: `${existingOther} is already the entry page` } });
    return;
  }
  const hasReadme = lstatOrNull(join(root, "README.md"))?.isFile() === true;
  planCreateOnly(root, rel, homePage(config, hasReadme, hasClaude), steps);
  const last = steps[steps.length - 1].action;
  if (last.status === "kept (yours differs)") {
    const home = readFileSync(join(root, rel), "utf8");
    const unlinked = ["AGENTS.md", ...(hasClaude ? ["CLAUDE.md"] : [])].filter((f) => !home.includes(f));
    if (unlinked.length > 0) {
      extra.push(`Hint: link ${unlinked.join(" and ")} from your entry page (${rel}), or check will report ${unlinked.length > 1 ? "them" : "it"} as an orphan.`);
    }
  }
}

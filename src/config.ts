// docs-wiki.config.json — the one place a host repo describes itself to the
// engine. Discovered at the corpus root; every key optional; zero config on a
// bare repo yields sane defaults (the default taxonomy below).
//
// Hand-parsed on purpose, like parser.ts's frontmatter reader: `check` must
// keep running on a bare Node 22 with nothing installed, so this module may
// not grow a schema-validation dependency. Errors name the file and the key.
//
// Merge rules, deliberately asymmetric:
// - skipDirs / skipRelative: config entries are ADDED to a baseline union.
// - machineLocal: config regexes are ADDED to MACHINE_LOCAL_FLOOR; the floor
//   is non-removable — no config can widen what /raw/ serves.
// - kinds / entryPage / port / reportOnlyPaths / mentionIds: config REPLACES
//   the default when present.
// - longPage: merged field-wise (raising `lines` must not reset `sections`).
// - skills: merged field-wise (setting `dir` must not reset `personasDir`);
//   `"skills": false` is shorthand for disabling the skills layer.
//
// The resolved config threads through Corpus and WikiIndex so the walker,
// the tagger, the renderer, and the server can never disagree about it —
// one `kinds` list drives BOTH tag derivation (tags.ts) and the TOC's kind
// grouping (render.ts). Two hard-coded sets drifting apart is exactly the
// bug this file exists to make structurally impossible.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MACHINE_LOCAL_FLOOR } from "./machine-local.ts";

/** One taxonomy rule; first match wins. Matchers are mutually exclusive:
 *  `prefix` (id.startsWith), `pattern` (RegExp on the id), or `rootOnly`
 *  (no `/` in the id). A rule with NO matcher matches everything — the
 *  catch-all, which only makes sense as the last rule. */
export interface KindRule {
  tag: string;
  prefix?: string;
  pattern?: RegExp;
  rootOnly?: boolean;
  /** Scrape a `Status: <value>` line from the doc's first prose lines into a
   *  derived `status:<value>` tag (the ADR convention). */
  statusLine: boolean;
}

export interface MentionIdToggles {
  adr: boolean;
  blocker: boolean;
  pr: boolean;
}

/**
 * Thresholds for the W002 long-page warning.
 *
 * Length alone is the wrong rule: a 600-line ADR about one decision is fine,
 * and a 150-line file braiding three topics is worse. What actually matters is
 * cohesion — does this file have one subject? — which a linter cannot see. So
 * the warning fires only when length AND section count agree, which is the
 * cheapest available proxy for "this has become several documents", and stays
 * report-only so it raises the question rather than answering it.
 */
export interface LongPageRule {
  enabled: boolean;
  /** Total lines, frontmatter included. */
  lines: number;
  /** H2 count — the level these corpora use for sections. */
  sections: number;
}

/**
 * The skills layer — where a repo keeps its skills (procedures with trigger
 * conditions and moves) and personas (stances for recurring task types).
 * The directories are page-id prefixes: repo-relative, never absolute,
 * normalized to a trailing "/". `"skills": false` in config is shorthand
 * for `{ "enabled": false }`.
 */
export interface SkillsConfig {
  enabled: boolean;
  /** Where skill pages live. Default "docs/skills/". */
  dir: string;
  /** Where persona pages live. Default "docs/personas/". */
  personasDir: string;
}

export interface WikiConfig {
  /** Entry-page candidates in priority order; the first one present in the
   *  corpus is featured on the server's TOC. None present → no banner. */
  entryPages: readonly string[];
  port: number;
  /** Page-id prefixes whose lint findings are report-only (never fail CI). */
  reportOnlyPaths: readonly string[];
  /** Directory NAMES skipped wherever they appear. */
  skipDirs: ReadonlySet<string>;
  /** Repo-relative paths skipped at exactly that location. */
  skipRelative: ReadonlySet<string>;
  /** Merged floor + config extras; see machine-local.ts. */
  machineLocal: readonly RegExp[];
  mentionIds: MentionIdToggles;
  kinds: readonly KindRule[];
  longPage: LongPageRule;
  skills: SkillsConfig;
}

/** Directory names that are never documentation — the union of every skip
 *  list this engine's ancestors carried (web build output, package output,
 *  Xcode/SwiftPM build products). Config can add, not subtract. */
export const SKIP_DIRS_BASELINE: readonly string[] = [
  "node_modules",
  ".git",
  "tmp",
  "dist",
  ".next",
  ".turbo",
  ".vercel",
  ".wrangler",
  "build",
  "DerivedData",
  ".build",
  "xcuserdata",
];

/** .claude/worktrees holds live checkouts of parallel agents — recursing
 *  into it would index a full copy of the repo (×N worktrees). The engine's
 *  own fixture corpus is NOT listed here: its location is derived from
 *  import.meta.url in corpus.ts, so it follows the package wherever it is
 *  checked out instead of being a hard-coded self-reference. */
export const SKIP_RELATIVE_BASELINE: readonly string[] = [".claude/worktrees"];

export const DEFAULT_ENTRY_PAGES: readonly string[] = [
  "docs/Home.md",
  "docs/wiki/index.md",
  "README.md",
];

export const DEFAULT_PORT = 8123;

/** The default taxonomy — the default `kinds`. First match wins, so the
 *  narrower docs/* rules precede the broad `reference` bucket. No catch-all:
 *  a page matching nothing simply carries no kind tag and groups under
 *  "(other)" in the TOC. */
export const DEFAULT_KINDS: readonly KindRule[] = [
  {
    tag: "adr",
    pattern: /(^|\/)decisions\/\d{4}-[^/]+\.md$/,
    statusLine: true,
  },
  { tag: "runbook", prefix: "docs/runbooks/", statusLine: false },
  { tag: "concept", pattern: /(^|\/)concepts\//, statusLine: false },
  // The skills layer (skills.ts) at its DEFAULT location — narrow before the broad
  // `reference` bucket, statusLine because maturity is the ADR convention
  // reused. A config that overrides `kinds` replaces this whole list, so it
  // must re-add these rules itself (the `seed` notes say so).
  { tag: "skill", prefix: "docs/skills/", statusLine: true },
  { tag: "persona", prefix: "docs/personas/", statusLine: true },
  { tag: "design", prefix: "docs/design/", statusLine: false },
  { tag: "milestone", prefix: "tasks/done/", statusLine: false },
  { tag: "planning", prefix: "tasks/", statusLine: false },
  { tag: "reference", prefix: "docs/", statusLine: false },
  { tag: "root", rootOnly: true, statusLine: false },
];

export class ConfigError extends Error {}

const KNOWN_KEYS = new Set([
  "entryPage",
  "port",
  "reportOnlyPaths",
  "skipDirs",
  "skipRelative",
  "machineLocal",
  "mentionIds",
  "kinds",
  "longPage",
  "skills",
]);

/**
 * Resolve a parsed-JSON config value (or `{}` for pure defaults) into the
 * merged, compiled form the engine consumes. Throws ConfigError with the
 * source name and the offending key on any shape problem — a config typo
 * must fail loudly, not silently fall back to a default.
 */
export function resolveConfig(
  input: unknown,
  source = "docs-wiki.config.json",
): WikiConfig {
  // Explicitly annotated as never-returning so TypeScript narrows after
  // `if (!ok) fail(...)` — inference alone does not enable that analysis.
  const fail: (msg: string) => never = (msg) => {
    throw new ConfigError(`${source}: ${msg}`);
  };
  const cfg = asRecord(input) ?? fail("config must be a JSON object");
  for (const key of Object.keys(cfg)) {
    if (!KNOWN_KEYS.has(key)) {
      fail(`unknown key "${key}" (known: ${[...KNOWN_KEYS].join(", ")})`);
    }
  }

  const entryPage = cfg.entryPage;
  if (entryPage !== undefined && !isNonEmptyString(entryPage)) {
    fail(`"entryPage" must be a non-empty string (a page id)`);
  }

  const port = cfg.port ?? DEFAULT_PORT;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  ) {
    fail(`"port" must be an integer 0–65535`);
  }

  const stringArray = (value: unknown, key: string): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((v) => !isNonEmptyString(v))) {
      fail(`"${key}" must be an array of non-empty strings`);
    }
    return value as string[];
  };

  const reportOnlyPaths = stringArray(cfg.reportOnlyPaths, "reportOnlyPaths");
  const skipDirsExtra = stringArray(cfg.skipDirs, "skipDirs");
  for (const d of skipDirsExtra) {
    if (d.includes("/")) {
      fail(
        `"skipDirs" entries are directory NAMES ("${d}" has a "/" — use skipRelative for paths)`,
      );
    }
  }
  const skipRelativeExtra = stringArray(cfg.skipRelative, "skipRelative").map(
    (p) => p.replace(/\/+$/, ""),
  );

  const machineLocalExtra = stringArray(cfg.machineLocal, "machineLocal").map(
    (src) => {
      try {
        return new RegExp(src);
      } catch (err) {
        return fail(
          `"machineLocal" pattern ${JSON.stringify(src)} is not a valid regex — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  const mentionIds: MentionIdToggles = { adr: true, blocker: true, pr: true };
  if (cfg.mentionIds !== undefined) {
    const m =
      asRecord(cfg.mentionIds) ?? fail(`"mentionIds" must be an object`);
    for (const key of Object.keys(m)) {
      if (key !== "adr" && key !== "blocker" && key !== "pr") {
        fail(`"mentionIds" has unknown key "${key}" (known: adr, blocker, pr)`);
      }
    }
    for (const key of ["adr", "blocker", "pr"] as const) {
      const value = m[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") {
        fail(`"mentionIds.${key}" must be a boolean`);
      }
      mentionIds[key] = value;
    }
  }

  let kinds: readonly KindRule[] = DEFAULT_KINDS;
  if (cfg.kinds !== undefined) {
    if (!Array.isArray(cfg.kinds)) fail(`"kinds" must be an array of rules`);
    kinds = (cfg.kinds as unknown[]).map((raw, i) => {
      const at = `"kinds"[${i}]`;
      const rule = asRecord(raw) ?? fail(`${at} must be an object`);
      for (const key of Object.keys(rule)) {
        if (!["tag", "prefix", "pattern", "rootOnly", "statusLine"].includes(key))
          fail(`${at} has unknown key "${key}"`);
      }
      const tag = rule.tag;
      if (!isNonEmptyString(tag)) fail(`${at} needs a non-empty string "tag"`);
      const matchers = ["prefix", "pattern", "rootOnly"].filter(
        (k) => rule[k] !== undefined,
      );
      if (matchers.length > 1) {
        fail(
          `${at} ("${tag}") has ${matchers.join(" AND ")} — give a rule at most ONE matcher (none = catch-all)`,
        );
      }
      const prefix = rule.prefix;
      if (prefix !== undefined && !isNonEmptyString(prefix))
        fail(`${at}.prefix must be a non-empty string`);
      if (rule.rootOnly !== undefined && rule.rootOnly !== true)
        fail(`${at}.rootOnly must be true when present`);
      if (rule.statusLine !== undefined && typeof rule.statusLine !== "boolean")
        fail(`${at}.statusLine must be a boolean`);
      let pattern: RegExp | undefined;
      const patternSrc = rule.pattern;
      if (patternSrc !== undefined) {
        if (!isNonEmptyString(patternSrc))
          fail(`${at}.pattern must be a non-empty string (a regex source)`);
        try {
          pattern = new RegExp(patternSrc);
        } catch (err) {
          fail(
            `${at}.pattern is not a valid regex — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return {
        tag,
        ...(prefix !== undefined ? { prefix } : {}),
        ...(pattern !== undefined ? { pattern } : {}),
        ...(rule.rootOnly === true ? { rootOnly: true } : {}),
        statusLine: rule.statusLine === true,
      };
    });
  }

  // Merged field-wise, so raising the line threshold does not silently reset
  // the section count that makes the rule mean anything.
  const longPage: LongPageRule = { enabled: true, lines: 400, sections: 6 };
  if (cfg.longPage !== undefined) {
    if (cfg.longPage === false) {
      longPage.enabled = false;
    } else {
      const raw = asRecord(cfg.longPage) ?? fail(`"longPage" must be an object or false`);
      for (const [key, value] of Object.entries(raw)) {
        if (key === "enabled") {
          if (typeof value !== "boolean") fail(`"longPage.enabled" must be a boolean`);
          longPage.enabled = value;
        } else if (key === "lines" || key === "sections") {
          if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
            fail(`"longPage.${key}" must be a positive integer`);
          }
          longPage[key] = value;
        } else {
          fail(`"longPage" has unknown key "${key}" (known: enabled, lines, sections)`);
        }
      }
    }
  }

  // Field-wise like longPage: pointing `dir` elsewhere must not silently
  // reset `personasDir`. Dirs are id prefixes, so they are forced relative
  // and to a trailing "/" — the exact form membership tests startsWith on.
  const skills: SkillsConfig = {
    enabled: true,
    dir: "docs/skills/",
    personasDir: "docs/personas/",
  };
  if (cfg.skills !== undefined) {
    if (cfg.skills === false) {
      skills.enabled = false;
    } else {
      const raw =
        asRecord(cfg.skills) ?? fail(`"skills" must be an object or false`);
      for (const [key, value] of Object.entries(raw)) {
        if (key === "enabled") {
          if (typeof value !== "boolean")
            fail(`"skills.enabled" must be a boolean`);
          skills.enabled = value;
        } else if (key === "dir" || key === "personasDir") {
          if (!isNonEmptyString(value)) {
            fail(
              `"skills.${key}" must be a non-empty string (a repo-relative directory)`,
            );
          }
          if (value.startsWith("/")) {
            fail(
              `"skills.${key}" must be repo-relative, not absolute ("${value}")`,
            );
          }
          // Mirror skipRelative's hygiene: "./docs/skills" and
          // "docs/skills//" both mean docs/skills/ — normalize before the
          // prefix tests ever see the value.
          let dir = value.split("\\").join("/").replace(/\/{2,}/g, "/");
          if (dir.startsWith("./")) dir = dir.slice(2);
          if (dir.split("/").includes("..")) {
            fail(`"skills.${key}" must not contain ".." ("${value}")`);
          }
          if (dir.split("/")[0] === ".git") {
            fail(`"skills.${key}" must not be inside .git ("${value}")`);
          }
          if (dir === "" || dir === "/") {
            fail(`"skills.${key}" must name a directory ("${value}")`);
          }
          skills[key] = dir.endsWith("/") ? dir : `${dir}/`;
        } else {
          fail(
            `"skills" has unknown key "${key}" (known: enabled, dir, personasDir)`,
          );
        }
      }
    }
  }
  // Equal dirs would make every skill or persona page both a skill and a persona —
  // two answers is one too many, so this is a config error, not a tiebreak.
  // (Nesting one under the other is legal; skills.ts resolves it by the
  // longest — most specific — prefix.)
  if (skills.dir === skills.personasDir) {
    fail(
      `"skills.dir" and "skills.personasDir" must differ (both "${skills.dir}")`,
    );
  }

  return {
    entryPages:
      entryPage !== undefined ? [entryPage as string] : DEFAULT_ENTRY_PAGES,
    port: port as number,
    reportOnlyPaths,
    skipDirs: new Set([...SKIP_DIRS_BASELINE, ...skipDirsExtra]),
    skipRelative: new Set([...SKIP_RELATIVE_BASELINE, ...skipRelativeExtra]),
    machineLocal: [...MACHINE_LOCAL_FLOOR, ...machineLocalExtra],
    mentionIds,
    kinds,
    longPage,
    skills,
  };
}

/**
 * Load the config for a corpus root. Resolution order:
 * 1. `configPath` argument (the CLI's `--config`) — must exist;
 * 2. the DOCS_WIKI_CONFIG environment variable — must exist (this is how an
 *    external config is applied to a repo that does not carry one);
 * 3. `<root>/docs-wiki.config.json` — optional; absent means pure defaults.
 */
export function loadConfig(root: string, configPath?: string): WikiConfig {
  const explicit = configPath ?? process.env.DOCS_WIKI_CONFIG ?? null;
  const file = explicit ?? join(root, "docs-wiki.config.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (explicit === null && isMissingFile(err)) return resolveConfig({}, file);
    throw new ConfigError(
      `${file}: cannot read config — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${file}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return resolveConfig(parsed, file);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

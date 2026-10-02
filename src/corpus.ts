// Markdown discovery. Walks a root directory, parses every .md file, and
// records every other file path so path mentions can be existence-checked.
// What gets skipped is driven by the resolved WikiConfig (see config.ts):
// skipDirs (names, anywhere), skipRelative (exact repo-relative paths), and
// machineLocal (regexes — a SECURITY boundary: the server's /raw/ route
// serves exactly `corpus.files`, so credentials must never enter it).

import { readdirSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.ts";
import type { WikiConfig } from "./config.ts";
import { isMachineLocal } from "./machine-local.ts";
import { parseDoc } from "./parser.ts";
import type { ParsedDoc } from "./parser.ts";
import type { PageId, Scope } from "./types.ts";

export interface Corpus {
  root: string;
  /** The resolved config the corpus was built under; buildIndex and the
   *  server read it from here so every consumer sees the same rules. */
  config: WikiConfig;
  docs: Map<PageId, ParsedDoc>;
  /**
   * Every file under root (repo-relative POSIX), markdown included — EXCEPT
   * machine-local files (.env*, .dev.vars, …). Excluding them here is a
   * security boundary, not bookkeeping: the server's /raw/ route serves
   * exactly this set, and credentials must never be in it.
   */
  files: Set<string>;
  /** Every directory under root, including skipped ones (they exist — a
   *  mention of a skipped dir is not a dead path). */
  dirs: Set<string>;
}

/** Findings on a page under a configured `reportOnlyPaths` prefix never fail
 *  `check` — the high-churn corners a host repo names (for example tasks/**).
 *  Default is empty: everything enforced. */
export function scopeFor(id: PageId, config: WikiConfig): Scope {
  return config.reportOnlyPaths.some((p) => id.startsWith(p))
    ? "report-only"
    : "enforced";
}

/**
 * The engine's own fixture corpora contain deliberately broken markdown that
 * must never count as project documentation. Earlier vendored copies pinned
 * their in-tree location as a string constant — which silently broke every
 * time the tool moved. Derive it from import.meta.url instead, and skip it
 * only when it actually sits inside the corpus being walked.
 */
// dirname+join, not new URL(rel, import.meta.url): bundlers (Turbopack) treat the
// latter as an asset reference and fail on the directory when a host app bundles us.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Root-relative paths of this engine's own fixture directories that sit
 * inside `root`. Two layouts exist: running from source (MODULE_DIR is src/,
 * fixtures next to it) and running the built package (MODULE_DIR is dist/,
 * whose fixtures are not shipped but the source tree's are still on disk in a
 * checkout), so both candidates are considered. Exported for tests.
 */
export function ownFixturesRelative(
  root: string,
  moduleDir: string = MODULE_DIR,
): string[] {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const candidates = [
    join(moduleDir, "fixtures"),
    join(moduleDir, "..", "src", "fixtures"),
  ];
  const out = new Set<string>();
  for (const c of candidates) {
    // Only a directory that exists can need skipping; without this check the
    // result depends on whether the temp dir sits behind a symlink (macOS).
    if (!existsSync(c)) continue;
    const rel = relative(real(root), real(c));
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    out.add(rel.split(sep).join("/"));
  }
  return [...out];
}

export function walkCorpus(
  root: string,
  config: WikiConfig = loadConfig(root),
): Corpus {
  const docs = new Map<PageId, ParsedDoc>();
  const files = new Set<string>();
  const dirs = new Set<string>();

  const skipRelative = new Set(config.skipRelative);
  for (const own of ownFixturesRelative(root)) skipRelative.add(own);

  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        dirs.add(childRel); // recorded even when skipped — the dir exists
        if (config.skipDirs.has(entry.name) || skipRelative.has(childRel))
          continue;
        walk(join(abs, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isMachineLocal(childRel, config.machineLocal)) continue; // .env* etc. — never indexed, never served
      files.add(childRel);
      if (entry.name.toLowerCase().endsWith(".md")) {
        const content = readFileSync(join(abs, entry.name), "utf8");
        docs.set(childRel, parseDoc(content, entry.name));
      }
    }
  };

  walk(root, "");
  return { root, config, docs, files, dirs };
}

/**
 * Build a Corpus from in-memory markdown — no filesystem involved. For host
 * apps that store docs elsewhere (a database, an API) and want the same
 * index/render pipeline. Keys are repo-relative POSIX paths; values are file
 * contents (only `.md` entries are parsed as pages, but every entry joins
 * `files` so path mentions existence-check against it).
 *
 * The same exclusion rules as walkCorpus apply — machineLocal, skipDirs and
 * skipRelative — so a host cannot accidentally index what the walker never
 * would. `root` is nominal (it names the corpus and seeds default config
 * discovery); it does not have to exist on disk.
 */
export function corpusFromFiles(
  root: string,
  fileMap: ReadonlyMap<string, string>,
  config: WikiConfig = loadConfig(root),
): Corpus {
  const docs = new Map<PageId, ParsedDoc>();
  const files = new Set<string>();
  const dirs = new Set<string>();

  const excluded = (rel: string): boolean => {
    if (isMachineLocal(rel, config.machineLocal)) return true;
    const parts = rel.split("/");
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (config.skipDirs.has(parts[i])) return true;
    }
    for (const p of config.skipRelative) {
      if (rel === p || rel.startsWith(`${p}/`)) return true;
    }
    return false;
  };

  for (const [path, content] of fileMap) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirs.add(parts.slice(0, i).join("/")); // ancestors exist even when skipped
    }
    if (excluded(path)) continue;
    files.add(path);
    if (path.toLowerCase().endsWith(".md")) {
      docs.set(path, parseDoc(content, parts[parts.length - 1] ?? path));
    }
  }

  return { root, config, docs, files, dirs };
}

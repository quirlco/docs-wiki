// docs-wiki — backlinks, search, link lint, tag facets, and a localhost
// browser over a repo's markdown. This barrel is the library surface for
// host apps embedding the engine (index a corpus, render pages with
// backlinks into their own layout); the CLI (cli.ts) and the standalone
// server consume the same modules, so the two can never disagree.
//
// The typical embedding:
//   const config = loadConfig(root);            // or resolveConfig({...})
//   const corpus = corpusFromFiles(root, files, config); // or walkCorpus(root, config)
//   const index = buildIndex(corpus);
//   const ctx = makeRenderContext(index, repoUrl, { page, raw, tag });
//   renderMarkdown(content, id, ctx); backlinksPanelHtml(ctx, id); …

// Read from the package.json that sits one level above this file — true of
// both the source layout (src/index.ts) and the built one (dist/index.js).
// dirname+join, not new URL(rel, import.meta.url): bundler-safe (see corpus.ts).
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf8",
      ),
    ) as { version?: unknown };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    // fall through: a host bundle may not carry package.json
  }
  return "0.0.0";
}

export const WIKI_VERSION: string = readVersion();

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Configuration (docs-wiki.config.json).
export {
  ConfigError,
  DEFAULT_ENTRY_PAGES,
  DEFAULT_KINDS,
  DEFAULT_PORT,
  loadConfig,
  resolveConfig,
  SKIP_DIRS_BASELINE,
  SKIP_RELATIVE_BASELINE,
} from "./config.ts";
export type {
  KindRule,
  LongPageRule,
  MentionIdToggles,
  SkillsConfig,
  WikiConfig,
} from "./config.ts";
export { isMachineLocal, MACHINE_LOCAL_FLOOR } from "./machine-local.ts";

// Corpus discovery — from disk or from memory.
export { corpusFromFiles, scopeFor, walkCorpus } from "./corpus.ts";
export type { Corpus } from "./corpus.ts";
export { parseDoc } from "./parser.ts";
export type { ParsedDoc } from "./parser.ts";

// Index, graph, lint.
export { buildIndex, computeOrphans, graphJson } from "./graph.ts";
export type { GraphJson } from "./graph.ts";
export { hasEnforced, lintIndex } from "./lint.ts";
export { kindOf, scrapeStatus } from "./tags.ts";

// Skills and personas — skills, personas, the growth guide, and the seed documents.
export { skillPages, REQUIRED_SECTIONS, SKILL_STATUSES } from "./skills.ts";
export type { SkillRecord } from "./skills.ts";
export { skillFiles, seedNotes } from "./seeds.ts";
export type { SkillFile } from "./seeds.ts";
export { growthGuide, growthGuideJson } from "./guide.ts";
export type { GrowthGuideJson } from "./guide.ts";

// Search.
export { buildSearchIndex, parseQuery, search } from "./search.ts";
export type { SearchHit, SearchIndex } from "./search.ts";

// Rendering (HTML fragments a host lays out itself).
export {
  backlinksPanelHtml,
  DEFAULT_HREFS,
  escapeHtml,
  makeRenderContext,
  renderMarkdown,
  shellHtml,
  tagChipsHtml,
  tocHtml,
} from "./render.ts";
export type { Hrefs, RenderContext } from "./render.ts";
export { githubSlug, Slugger } from "./slug.ts";

// Standalone localhost server (never deployable; binds 127.0.0.1 only).
export { serveWiki, startWikiServer } from "./server.ts";
export type { RunningServer, ServeOptions } from "./server.ts";

// Data model.
export type {
  Edge,
  EdgeType,
  Heading,
  LintFinding,
  Page,
  PageId,
  Scope,
  Tag,
  TagSource,
  TargetKind,
  WikiIndex,
} from "./types.ts";

// Wiring a repo up for agents — what `docs-wiki init` writes.
export { agentsBlock, runInit } from "./init.ts";
export type { InitAction, InitOptions, InitResult } from "./init.ts";

// The shipped seeds — the seed skills and personas docs-wiki offers an
// adopting repository, plus the adoption notes that travel with them. This
// module READS the bundled files under src/seeds/ and reports what each
// would be named in the host repo (config-resolved paths). It NEVER writes
// a corpus: `seed` prints, and the adopter — an agent with judgment, or a
// human — writes and commits. That division is the architecture: reading
// and checking are docs-wiki's whole authority.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { WikiConfig } from "./config.ts";

// dirname+join, not new URL(rel, import.meta.url): bundlers (Turbopack) treat the
// latter as an asset reference and fail on the directory when a host app bundles us.
const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "seeds");

export interface SkillFile {
  /** Where the file belongs in the ADOPTING repo — the configured skills or
   *  personas directory plus the shipped basename. */
  path: string;
  content: string;
}

function readSeedDir(sub: string, targetDir: string): SkillFile[] {
  return readdirSync(join(SEEDS_DIR, sub))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      path: `${targetDir}${name}`,
      content: readFileSync(join(SEEDS_DIR, sub, name), "utf8"),
    }));
}

/** The full shipped seeds, addressed for the given config: skills first,
 *  then personas, each group sorted by basename. */
export function skillFiles(config: WikiConfig): SkillFile[] {
  const { skills, personas } = seedSets(config);
  return [...skills, ...personas];
}

/** The same seeds, kept apart by origin (the skills bridge links only skills,
 *  whatever the directory layout). */
export function seedSets(config: WikiConfig): {
  skills: SkillFile[];
  personas: SkillFile[];
} {
  return {
    skills: readSeedDir("skills", config.skills.dir),
    personas: readSeedDir("personas", config.skills.personasDir),
  };
}

/**
 * The adoption notes `seed` prints after the files: what the adopter (not
 * this tool) should do next. Everything here is TEXT — the symlink commands
 * are printed, never executed.
 */
export function seedNotes(config: WikiConfig): string[] {
  const { dir, personasDir } = config.skills;
  const skillNames = readSeedDir("skills", dir).map((f) =>
    basename(f.path, ".md"),
  );
  return [
    "Easy path: `docs-wiki init` writes these files (never overwriting yours),",
    "wires AGENTS.md and the Claude Code bridge, and is safe to re-run.",
    "",
    "By hand: `seed` only prints. Write the files above at their printed paths,",
    "review them, then commit:",
    `  git add ${dir} ${personasDir}`,
    "",
    "If this repo bridges skills into Claude Code, symlink each skill so the",
    "corpus page stays the single source of truth:",
    ...skillNames.map(
      (name) =>
        `  mkdir -p .claude/skills/${name} && ln -s ../../../${dir}${name}.md .claude/skills/${name}/SKILL.md`,
    ),
    'Symlinks are never walked as corpus; if you copy instead, add',
    '"skipRelative": [".claude/skills"] to docs-wiki.config.json so the copies',
    "are not indexed twice.",
    "",
    'A repo that overrides "kinds" must add the skill and persona rules itself (an',
    "overriding config replaces the whole default list):",
    `  { "tag": "skill", "prefix": "${dir}", "statusLine": true }`,
    `  { "tag": "persona", "prefix": "${personasDir}", "statusLine": true }`,
  ];
}

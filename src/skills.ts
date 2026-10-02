// The skills layer — skills (procedures) and personas (stances) as corpus
// pages, read through the same corpus/index every other consumer uses.
// This module only DESCRIBES skill and persona pages: membership by configured
// directory, the Status scrape, and conformance to the required-section
// contract. It never writes anything; lint.ts turns a non-empty `missing`
// list into a W003 finding — report-only, permanently, because "is this a
// well-formed skill?" polices an advisory layer, and a malformed draft must
// never block the PR that is trying to fix it.

import type { Corpus } from "./corpus.ts";
import { scrapeStatus } from "./tags.ts";
import type { PageId, WikiIndex } from "./types.ts";

/** A skill or persona page's maturity. CLOSED and identical in every adopting repo —
 *  a cross-repo compatibility surface: draft
 *  is written but unproven; active is earned by linked evidence from real
 *  work; deprecated is superseded — the body names the successor, and the
 *  file is never deleted. */
export const SKILL_STATUSES = ["draft", "active", "deprecated"] as const;

/** The section contract that makes a skill or persona page machine-parseable: a
 *  skill states when it fires and what to do; a persona states when to
 *  adopt it and the stance it takes. Matched case-insensitively against
 *  the page's H2 texts. */
export const REQUIRED_SECTIONS = {
  skill: ["When", "Moves"],
  persona: ["When to adopt", "Stance"],
} as const;

export interface SkillRecord {
  id: PageId;
  role: "skill" | "persona";
  title: string;
  /** The frontmatter `description` — the "Use when…" line; "" when absent. */
  description: string;
  /** Normalized `Status:` value from the first prose lines, or null when
   *  the page carries none. */
  status: string | null;
  /** The page's H2 texts, in order. */
  sections: string[];
  /** What W003 will name: each absent required section, "Status line" when
   *  the status line is missing, `unknown status "x"` when it is outside
   *  SKILL_STATUSES. Empty = the page conforms. */
  missing: string[];
}

/** A directory README or index organizes the skills without being part of
 *  it — never held to the skill format. */
const EXEMPT_BASENAMES = new Set(["readme.md", "index.md"]);

/**
 * Every skill or persona page in the corpus, sorted by id. Membership is purely the
 * configured directories (`skills.dir`, `skills.personasDir`) — the same
 * prefix convention the kind taxonomy uses, so the `skill` tag and the
 * skills listing can only disagree if a config overrode `kinds` without
 * re-adding the rules. Empty when the skills layer is disabled.
 */
export function skillPages(corpus: Corpus, index: WikiIndex): SkillRecord[] {
  const { skills } = corpus.config;
  if (!skills.enabled) return [];

  const records: SkillRecord[] = [];
  for (const id of [...index.pages.keys()].sort()) {
    // Both prefixes can match when one dir nests inside the other; the
    // longest prefix is the more specific claim and wins. Equal dirs are
    // rejected at config resolve time, so there is no tie to break.
    const inSkills = id.startsWith(skills.dir);
    const inPersonas = id.startsWith(skills.personasDir);
    const role: SkillRecord["role"] | null =
      inSkills && inPersonas
        ? skills.personasDir.length > skills.dir.length
          ? "persona"
          : "skill"
        : inSkills
          ? "skill"
          : inPersonas
            ? "persona"
            : null;
    if (role === null) continue;
    const basename = (id.split("/").pop() ?? id).toLowerCase();
    if (EXEMPT_BASENAMES.has(basename)) continue;

    const doc = corpus.docs.get(id);
    const page = index.pages.get(id);
    if (doc === undefined || page === undefined) continue;

    const status = scrapeStatus(doc);
    const sections = doc.headings
      .filter((h) => h.depth === 2)
      .map((h) => h.text);
    const lowered = sections.map((s) => s.toLowerCase());

    const missing: string[] = [];
    for (const required of REQUIRED_SECTIONS[role]) {
      if (!lowered.includes(required.toLowerCase())) missing.push(required);
    }
    if (status === null) {
      missing.push("Status line");
    } else if (!(SKILL_STATUSES as readonly string[]).includes(status)) {
      missing.push(`unknown status "${status}"`);
    }

    records.push({
      id,
      role,
      title: page.title,
      description: doc.description,
      status,
      sections,
      missing,
    });
  }
  return records;
}

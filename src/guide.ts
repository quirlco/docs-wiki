// `docs-wiki guide` — the growth contract in one command. The primary reader
// is an agent that has never seen this repo, and every factual line is
// DERIVED from the live config and the actual corpus — a repo that moved its
// skills directory or tuned its thresholds gets a guide that says so, never
// a generic one. The JSON form carries the vocabularies, the required
// sections, and the skills and personas with their statuses, as one
// structured artifact a session loads instead of re-reading prose.

import type { KindRule, LongPageRule } from "./config.ts";
import type { Corpus } from "./corpus.ts";
import { WIKI_VERSION } from "./index.ts";
import { skillPages, REQUIRED_SECTIONS, SKILL_STATUSES } from "./skills.ts";
import type { SkillRecord } from "./skills.ts";
import type { WikiIndex } from "./types.ts";

export interface GrowthGuideJson {
  version: string;
  /** False when the repo's config disables the layer ("skills": false) —
   *  distinguishable in JSON from a merely empty corpus. */
  enabled: boolean;
  skillsDir: string;
  personasDir: string;
  statuses: readonly string[];
  requiredSections: typeof REQUIRED_SECTIONS;
  skills: SkillRecord[];
  personas: SkillRecord[];
  longPage: LongPageRule;
}

export function growthGuideJson(
  corpus: Corpus,
  index: WikiIndex,
): GrowthGuideJson {
  const records = skillPages(corpus, index);
  return {
    version: WIKI_VERSION,
    enabled: corpus.config.skills.enabled,
    skillsDir: corpus.config.skills.dir,
    personasDir: corpus.config.skills.personasDir,
    statuses: SKILL_STATUSES,
    requiredSections: REQUIRED_SECTIONS,
    skills: records.filter((r) => r.role === "skill"),
    personas: records.filter((r) => r.role === "persona"),
    longPage: corpus.config.longPage,
  };
}

function describeKind(rule: KindRule): string {
  const matcher =
    rule.prefix !== undefined
      ? `prefix ${rule.prefix}`
      : rule.pattern !== undefined
        ? `pattern ${rule.pattern.source}`
        : rule.rootOnly === true
          ? "root-only"
          : "catch-all";
  return `    ${rule.tag.padEnd(12)}${matcher}${rule.statusLine ? "  (scrapes Status:)" : ""}`;
}

function listRecord(r: SkillRecord): string {
  const flag =
    r.missing.length > 0 ? `   (malformed: ${r.missing.join(", ")})` : "";
  return `  ${(r.status ?? "(none)").padEnd(10)}  ${r.role.padEnd(7)}  ${r.id}${flag}`;
}

export function growthGuide(corpus: Corpus, index: WikiIndex): string {
  const { config } = corpus;
  const { dir, personasDir, enabled } = config.skills;
  const records = skillPages(corpus, index);

  const skillListing = !enabled
    ? '  (the skills layer is disabled — "skills": false in this repo\'s config)'
    : records.length === 0
      ? "  (none yet — `docs-wiki init` writes the seed pages (`docs-wiki seed` prints them); commit what fits)"
      : records.map(listRecord).join("\n");

  return `# How this corpus grows — the contract

The corpus is long-term memory. A session's context window is working
memory: fast, rich, and gone when the session ends. Everything durable a
session learns is routed into the corpus before it clears — that loop is the
whole contract, and this guide derives every fact below from the LIVE
config, so it describes THIS repo rather than a generic one.

## Layout (from config)

  entry page:         ${config.entryPages.join("  →  ")}  (first present wins)
  skills live at:     ${dir}<name>.md
  personas live at:   ${personasDir}<name>.md
  long-page warning:  past ${config.longPage.lines} lines AND ${config.longPage.sections} H2 sections (W002, report-only)${config.longPage.enabled ? "" : " — DISABLED here"}
  kind taxonomy (first match wins):
${config.kinds.map(describeKind).join("\n")}

## The skills and personas this repo carries

${skillListing}

Statuses are a CLOSED vocabulary, identical in every repo: ${SKILL_STATUSES.join(" | ")}

  draft        written, unproven — the only status a new skill may be born with
  active       earned by linked Evidence from real work where the skill held
  deprecated   superseded — the body names the successor; the file is never deleted

A skill page requires the H2 sections: ${REQUIRED_SECTIONS.skill.join(", ")} (Evidence by convention).
A persona page requires: ${REQUIRED_SECTIONS.persona.join(", ")} (Toolkit and Retire when by convention).
Every skill or persona page carries a "Status: <value>" line directly under the H1 —
the scraper reads only the first 8 prose lines, so a Status buried lower
does not count. \`docs-wiki check\` verifies this format as W003 — report-only,
permanently.

## The loop: act → notice → encode → apply → sleep

Act is the work itself. Notice is pattern recognition, governed by the
rule of three: once = just do it; twice = note it in the handoff; three
times = a pattern that must be encoded. Encode routes the lesson home:

  what you learned                          where it goes
  a fact about the system now               the doc that states it (edit in place)
  a decision among alternatives             an ADR: docs/decisions/NNNN-short-title.md, "Status: accepted"
  an idea that keeps coming up              a page in docs/concepts/
  a procedure you worked out                a page in docs/runbooks/
  work for later                            a ticket in your issue tracker — never a TODO comment
  a procedure that keeps recurring          a skill, born draft
  a stance for a recurring task type        a persona
  state the next session needs              the handoff — and only until then

Link related pages with [[wikilinks]] and update a page rather than duplicating
it. \`docs-wiki init\` writes the same loop into AGENTS.md so every session sees it.

Apply is the next session reading this guide and adopting what fits. Sleep
closes the loop.

## Long pages — the W002 doctrine

W002 fires only when length AND section count agree, and it stays
report-only forever, because the property that matters — does this file
have ONE subject? — is a judgment no linter can make. When it fires:

  one subject       leave it; add a summary or TOC at the top so a reader can skip
  a journal         archive the old entries; NEVER split by topic — splitting a
                    journal destroys the chronology that makes it useful
  several subjects  split and link them; this is the case worth acting on

Run \`docs-wiki impact <file>\` before restructuring anything — its referrers are
the pages that will go stale, and your checklist afterwards.

## Sleep — ending a session

1. \`docs-wiki check\` — fix enforced findings; weigh the reported ones.
2. \`docs-wiki impact <file>\` for anything restructured; walk the checklist.
3. Route every unconsolidated lesson through the encoding table above.
4. Update the handoff with STATE only — live state, next step, landmines —
   in your final message or pull request description, not in docs/.
   Lessons never live in the handoff; it is the only ephemeral store.
5. Commit. Only then clear context.

Corpus = long-term memory. Context window = working memory. This = sleep.
`;
}

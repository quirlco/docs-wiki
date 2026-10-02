---
name: skill-authoring
description: >-
  Use when the rule of three says a procedure must become a skill, or when
  revising one: the exact format contract, the closed maturity vocabulary,
  the evidence bar for active, and the deprecate-don't-delete rule.
tags: [skill]
---

# skill-authoring

Status: active

A skill is a repeatable procedure encoded as a corpus page: the shapes that
trigger it, the moves to make, and the evidence that earned it trust. This
page is the format contract — the instructions for extending the set.

## When

- [[pattern-recognition]] found a procedure that has now worked three times.
- An existing skill fired but its moves proved wrong or incomplete.
- A skill has been superseded and needs deprecating.

## Moves

1. Create one file per skill in this repo's skills directory (`docs-wiki guide`
   prints the configured path). The basename is the skill's name.
2. Follow the format exactly — `docs-wiki check` verifies it as W003:
   - frontmatter: `name:` equal to the basename; `description:`
     trigger-phrased, so an agent matching against it knows when to load
     the skill; `tags: [skill]` (the same tag the default taxonomy
     derives from the skills directory)
   - `# <name>` as the H1
   - a `Status: draft` line directly under the H1 — the scraper reads only
     the first 8 prose lines, so a Status buried lower does not count
   - a one-paragraph summary of what the skill is for
   - `## When` — the trigger shapes, as bullets
   - `## Moves` — concrete ordered actions, commands included
   - `## Evidence` — what proves the procedure, linked to real work
3. Maturity is a closed vocabulary: `draft`, `active`, `deprecated`. Every
   new skill is born `draft` — written is not proven. (The seed skills
   ship `active` as a baseline; skills you write start as `draft` and earn
   promotion with linked Evidence.)
4. Promote draft to active only on linked Evidence from real work: the
   sessions, commits, or documents where the procedure held. A draft that
   never earns evidence should die a draft.
5. Deprecate, never delete: set `Status: deprecated` and name the successor
   in the body. A deprecated skill still explains why its replacement
   exists — the corpus keeps its history.
6. Where the repo bridges skills into Claude Code, add the symlink so the
   corpus page stays the single source of truth:
   `.claude/skills/<name>/SKILL.md` pointing at `../../../<skills dir>/<name>.md`
   (`docs-wiki seed` prints the exact commands).
7. Run `docs-wiki check` — the new page must produce no W003.

## Evidence

- The nine seed pages are written to this contract and ship pre-validated
  against it: the format is proven by the files that carry it.
- The draft / active / deprecated vocabulary keeps trust visible: a reader
  can tell at a glance which procedures have held up in real work.

---
name: persona-authoring
description: >-
  Use when a recurring task type keeps needing the same judgment rather than
  another procedure: when a persona is warranted, its format, and the
  one-persona-at-a-time discipline. The agent writes these for itself.
tags: [skill]
---

# persona-authoring

Status: active

Sometimes moves are not enough. When the same type of task keeps requiring
the same *stance* — what to optimize for, what to refuse — encode the stance
as a persona. You are writing these for yourself: the agent that adopts one
next session is you, without this context window.

## When

- A recurring task type keeps requiring the same priorities and the same
  refusals, and no procedure captures them ([[pattern-recognition]] counted
  to three).
- Work keeps going wrong in exactly the way a missing stance predicts — a
  cleanup session that sneaks in new features, an intake session that
  starts implementing.
- An existing persona's stance no longer matches how the work actually goes.

## Moves

1. Confirm a skill is not enough. If the lesson is "do these steps", write
   a skill ([[skill-authoring]]). A persona is warranted only when the
   lesson is "while doing this kind of work, want these things and refuse
   those".
2. Create one file per persona in this repo's personas directory
   (`docs-wiki guide` prints the configured path), in the format `docs-wiki check`
   verifies: frontmatter (`name:` = basename, trigger-phrased
   `description:`, `tags: [persona]`, matching the tag the default taxonomy derives), the `# <name>` H1, a `Status:` line,
   a one-paragraph summary, then:
   - `## When to adopt` — the task shapes that call for this stance
   - `## Stance` — what it optimizes for, and what it REFUSES
   - `## Toolkit` — the commands and skills it leans on
   - `## Retire when` — the conditions under which to drop it
3. Adopt ONE persona at a time. A stance is a coherent set of priorities;
   two at once is no stance at all. Say which one is adopted; drop it when
   the task type changes.
4. Revise in place as the stance sharpens. A persona is a living page and
   its history is git's job.
5. Retire through the Status line — `deprecated`, with the body naming what
   replaced it or why the task type no longer occurs — never by deletion.

## Evidence

- Three worked examples ship beside this skill: [[gardener]],
  [[historian]], and [[triage]]. The same agent, a different stance for a
  different kind of work.
- The refusal lines in those three each guard against a familiar failure:
  gardening that wrote new content, histories quietly deleted, triage that
  started fixing the first interesting bug.

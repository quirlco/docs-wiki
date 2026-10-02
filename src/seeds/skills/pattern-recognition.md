---
name: pattern-recognition
description: >-
  Use during and at the end of any working session to notice repetition
  worth encoding: the rule of three, the signals that count, and the routing
  table from pattern to doc edit, ADR, ticket, skill, persona, or handoff.
tags: [skill]
---

# pattern-recognition

Status: active

The meta-skill: the loop only learns if something notices the pattern.
Acting is cheap and forgetting is free, so repetition is the one reliable
signal that something you learned in a session has earned a permanent home
in the docs. This
skill is how to spot it, and where to send what you spotted.

## When

- The same kind of ticket keeps arriving.
- The human gives you the same correction for the second time.
- You re-run a search you know you have run before.
- The same mistake shows up in two different sessions.
- Anything makes you think "again?".

## Moves

1. Apply the rule of three:
   - **Once** — just do it. Encoding a one-off is over-encoding; a set of
     skills that outgrows its corpus costs more to read than it saves.
   - **Twice** — note it in the handoff, so the next session can count to
     three.
   - **Three times** — it is a pattern. Encode it now, before sleep.
2. Route what you noticed through the encoding table:
   - a fact about the system now — edit the doc that states it, in place
   - a decision among alternatives — an ADR in `docs/decisions/`, with its status line
   - work for later — an item in your issue tracker, never a TODO comment
   - a procedure that has now worked three times — a skill, born draft
     ([[skill-authoring]])
   - a stance a recurring task type needs — a persona ([[persona-authoring]])
   - state the next session needs — the handoff, and only until that session
3. Encode at the moment of noticing, or at latest during
   [[sleep-consolidation]]. Never "later" — later is a session that no
   longer exists.

## Evidence

- This skill drives the act → notice → encode → apply → sleep loop (see
  `docs-wiki guide`). Over-encoding is that loop's main failure mode, which
  is why the rule of three is the bar rather than "encode everything".
- In practice: a correction given twice usually becomes a standing
  instruction by the third time — the rule of three, running informally
  before it had a name.

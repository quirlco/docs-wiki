---
name: sleep-consolidation
description: >-
  Use at the end of every working session, before clearing context: run the
  checks, route every lesson through the encoding table, write a state-only
  handoff, commit — and only then clear. The sleep protocol.
tags: [skill]
---

# sleep-consolidation

Status: active

The corpus is long-term memory; the context window is working memory; this
is the step that moves one into the other. A session that simply stops
loses everything it learned. A session
that sleeps — consolidates, commits, clears — leaves the corpus slightly
more capable than it found it, and a loop that always ends this way can run
indefinitely without drowning in its own history.

## When

- The work is done, or the context window is close to full.
- You are about to hand off to another session.
- Any session end at all, however small the session was.

## Moves

1. Run `docs-wiki check`. Fix enforced findings; weigh the reported ones —
   W001/W002 route to [[doc-gardening]], a W003 names the malformed skill or
   persona page to repair.
2. Run `docs-wiki impact <file>` for anything you restructured, and walk the
   referrer checklist: does each page still say something true?
3. Route every unconsolidated lesson through the encoding table
   ([[pattern-recognition]] holds it): a fact — edit the doc; a decision —
   an ADR in `docs/decisions/`; later work — an issue in your tracker; a third-time procedure — a skill; a
   stance — a persona.
4. Update the handoff with STATE only: live state, the immediate next step,
   the landmine just discovered. Put it in your final message or pull
   request description, not in `docs/`. Lessons never live in the handoff —
   it is the only ephemeral store, and anything worth keeping past one
   handoff must already be in the corpus proper from the previous move.
5. Commit — a clean working tree, docs included.
6. Only then clear context. Consolidate, clear, wake fresh.

## Evidence

- Sleep is what makes the context window renewable, the corpus is what
  makes sleeping safe, and the handoff is a short-lived note, not a second
  corpus.
- End-every-session-with-a-committed-tree-and-a-handoff is a rule worth
  following even before it is written down; encoding it makes it portable
  to the next session.

---
name: ticket-hygiene
description: >-
  Use whenever a thought about future work occurs mid-session, and in any
  repo that tracks work somewhere: what becomes an issue versus a doc edit
  versus a skill, and how to work the queue honestly.
tags: [skill]
---

# ticket-hygiene

Status: active

Your issue tracker is how the project's future is stored, in a place the
next session can query. The failure this skill prevents is leakage: work
living in TODO comments, in the handoff, or in your head — all places the
next session cannot look.

## When

- A thought of the shape "we should…", "later…", or "this will break
  when…" occurs while you are doing something else.
- You are starting work in a repo whose tracking conventions you have not
  read.
- You finish, abandon, or get blocked on a piece of tracked work.

## Moves

1. Sort the thought before storing it:
   - **future work** — an issue in your tracker
   - **a fact changed** — edit the doc that states it; that is not an issue
   - **a procedure proved out again** — [[pattern-recognition]] counts it;
     [[skill-authoring]] encodes it
2. In an unfamiliar repo, read how it tracks work (a contributing guide,
   an agent instruction file, or the tracker itself) before filing
   anything.
3. File, don't comment: an issue beats a TODO comment every time, because
   a comment is invisible to the queue.
4. Work the queue honestly: mark an item in progress before working it;
   close it when done; mark it blocked, with the reason, when waiting on a
   person; mark it dropped when deliberately not doing it. Change the
   status rather than deleting the item — the reason survives.
5. Reference the issue from the commit or pull request that does the work,
   so the history and the queue point at each other.
6. Where there is no tracker at all, agree on one place (a single docs
   page will do) and keep the same sorting discipline: nothing durable
   lives only in a comment.

## Evidence

- Link a few issues that were filed from a TODO-shaped thought and later
  closed by real work; that is the proof this routine holds.
- "File it, don't leave it in a comment" is cheap to follow and expensive
  to skip: a comment nobody queries is work nobody does.

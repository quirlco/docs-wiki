---
name: doc-gardening
description: >-
  Use when docs-wiki check reports W001 orphan pages or W002 long pages, when a
  doc has visibly grown several subjects, or before restructuring any page:
  the split/archive/link decision procedure and the orphan playbook.
tags: [skill]
---

# doc-gardening

Status: active

Corpus maintenance is deciding, page by page, whether a warning is telling
you something. The linter can measure length and reachability; it cannot see
cohesion — does this file have one subject? — so the W-codes raise questions,
and this skill is the procedure for answering them without wrecking what the
page was for.

## When

- `docs-wiki check` reports `W002 long page` on a file you own or are editing.
- `docs-wiki check` reports `W001 orphan page`.
- A page you are reading clearly braids two or more subjects, whatever its
  length.
- You are about to restructure, rename, split, or merge any doc.

## Moves

1. Run `docs-wiki impact <file>` FIRST for any page you are about to restructure.
   The referrers it lists are the pages that will go stale — they are your
   checklist for afterwards.
2. For a W002, answer the one question the lint cannot: does this file have
   one subject?
   - **One subject** — leave it. Add a summary or TOC at the top so a reader
     can skip. Long is not the problem; incohesion is.
   - **A journal** (session logs, append-only history) — archive the old
     entries into a dated page. NEVER split a journal by topic: the
     chronology is what makes it useful, and a topic split destroys it.
   - **Several subjects** — split into one page per subject and link them
     from where the original stood. This is the case the warning exists for.
3. For a W001 orphan, choose deliberately instead of reflexively linking:
   - link it from its natural parent — the page a reader would arrive from;
   - or merge it into the page that already owns the subject;
   - or drop it on purpose, recording why.
4. Re-run `docs-wiki check`, then walk the impact checklist: does each referrer
   still say something true?

## Evidence

- The one-subject / journal / several-subjects rule has two failure modes
  on either side: split too eagerly and a subject scatters across stubs;
  hoard too long and a page becomes a landfill. Both codes stay warnings
  precisely because this judgment is made per page — which is what this
  procedure is.
- Link to real W001/W002 reports you resolved with it as you accumulate
  them.

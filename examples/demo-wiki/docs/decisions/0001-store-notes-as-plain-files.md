# ADR-0001: Store notes as plain files

Date: 2026-03-02 · Status: accepted

## Context

Early Lantern builds kept notes in a local database. Users asked for two
things the database made hard: opening their notes in other editors, and
keeping them in version control.

## Decision

Every note is a single markdown file inside its [[notebook]] folder. Lantern
keeps an index of titles and [[tagging]] metadata, but the index is a cache:
it can always be rebuilt from the files.

## Consequences

- Notes survive Lantern. Any editor can open them.
- Rebuilding the index is the first step of [restoring from a backup](../runbooks/restore-from-backup.md).
- Syncing has to cope with plain files changing underneath it, which led to
  [ADR-0002](0002-sync-with-a-merge-log.md).

# ADR-0002: Sync with a merge log

Date: 2026-04-18 · Status: proposed

## Context

[ADR-0001](0001-store-notes-as-plain-files.md) made notes plain files, so two
devices can edit the same note while offline. Whole-file "last write wins"
silently drops one side's edits.

## Decision

Each device appends its edits to a small merge log next to the notebook.
Devices exchange logs and replay them in timestamp order, keeping both sides
of any conflicting paragraph and marking the spot for the user.

## Open questions

- How long should a merge log be kept once every device has replayed it?
- Should the [search screen](../design/search-ui.md) flag notes that contain an
  unresolved conflict marker?

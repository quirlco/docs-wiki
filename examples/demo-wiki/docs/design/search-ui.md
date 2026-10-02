# Search UI

The search screen answers one question: where did I write that? It opens from
anywhere with a single keystroke.

## Behaviour

- Results update as you type, best match first, with the matching line shown.
- Typing `#` offers the existing tags from [[tagging]]; picking one filters
  the results to that tag.
- A result opens its note scrolled to the match.

## Not in this version

Searching inside attachments, and searching across devices before they have
synced ([ADR-0002](../decisions/0002-sync-with-a-merge-log.md) is still open).

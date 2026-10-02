# docs-wiki for AI agents

This page is for an AI coding agent (or the person driving one) that has been
asked to set up docs-wiki in a repository, or to work in a repo that already
uses it. It is tool-neutral: anything that can run shell commands can follow
it.

## What docs-wiki gives you

- A **gate**: `docs-wiki check` exits 1 when the repo's markdown has broken
  links, broken `[[wikilinks]]`, ambiguous references, duplicate aliases or
  broken anchors. Run it before you finish any change that touches docs.
- A **map**: `docs-wiki backlinks <file>` says what refers to a page, and
  `docs-wiki impact <file>` lists the pages worth re-reading after you edit it.
- **Search**: `docs-wiki search <words>` (with `tag:<name>` to filter).
- A **contract**: `docs-wiki guide` prints how this corpus is meant to grow,
  derived from the repo's live configuration. Read it once per session.

Taken together, docs-wiki is long-term working memory for the project: you
write down decisions, concepts and how-tos as you build, and people browse all
of it with `docs-wiki serve`. Apart from `init`, which only creates files and
never overwrites yours, it only reads, and it never needs the network.

## The contract in six lines

1. Needs Node 22 or newer. Zero runtime dependencies.
2. Install: `npm i -D docs-wiki`, or run it ad hoc with `npx docs-wiki <command>`.
3. Run `docs-wiki check` as a gate. Exit 0 means pass, 1 means fix findings,
   2 means you invoked it wrongly (see [setup.md](setup.md) for each code).
4. Run `docs-wiki guide` once to learn the repo's layout and conventions.
5. Configuration is optional: a `docs-wiki.config.json` at the repo root.
   Defaults suit most repos. See [configuration](../docs/configuration.md).
6. Wire the repo up with `docs-wiki init` (below). It writes the AGENTS.md
   section, the bundled skills and personas, and a starter `docs/Home.md`, and
   it is safe to re-run. See
   [skills and personas](../docs/skills-and-personas.md).

## Before you edit a doc

```sh
docs-wiki backlinks <file>   # who depends on this page?
```

After editing, with the changes still uncommitted or on a branch:

```sh
docs-wiki impact          # checklist for the docs your branch changed
docs-wiki check           # the gate; fix anything it enforces
```

`impact` with no arguments compares against `origin/main` (or a local `main`).
If neither exists, it prints a warning to stderr naming the missing base and
exits 2 rather than guessing; name the files explicitly instead:
`docs-wiki impact <file>`.

## Wiring it into the repo

Run this from the repository root:

```sh
npx docs-wiki init
```

It is non-interactive and prints one line per file: `created`, `updated`,
`unchanged`, `kept (yours differs)` or `skipped (<reason>)`. It maintains a
marked section in `AGENTS.md` (the instruction file most agent tools read at
session start), writes the bundled skills and personas, and creates
`docs/Home.md` if there is none. If the repo has a `CLAUDE.md` or a `.claude/`
directory (or you pass `--claude`, or Claude Code runs it: its shell sets `CLAUDECODE=1`), it also makes `CLAUDE.md` import
`AGENTS.md` and links each skill into `.claude/skills/`. Use `--dry-run` to see
the plan first. Then run `docs-wiki check`, fix what it enforces, and commit.
See [setup.md](setup.md) for the step by step, including what to do about each
finding, and consider running `docs-wiki check` in CI as well.

### Prefer to wire it by hand?

Paste this into the instruction file your agent tool reads (`AGENTS.md`,
`CLAUDE.md`, a contributing guide, or similar). It is exactly what `init`
writes with the default directories, so `init` can later keep it up to date.

```markdown
<!-- docs-wiki:start -->
## Project memory (docs-wiki)

This repo keeps its long-term working memory as markdown in `docs/`. People
browse it with `npx docs-wiki serve`; you read and write it as plain files.

At the start of a session:
- Skim `docs/Home.md`, then run `npx docs-wiki guide` unless you have
  already read it this session.

While you build, write things down as you go:
- A decision goes in `docs/decisions/`, in a file named
  `NNNN-short-title.md`, with a `Status: accepted` line and the context and
  why.
- An idea that keeps coming up gets a page in `docs/concepts/`.
- A procedure you worked out goes in `docs/runbooks/`.
- Link related pages with `[[wikilinks]]`. Update a page rather than
  duplicating it.
- Before editing a doc, run `npx docs-wiki backlinks <file>` to see what
  depends on it.

Skills and personas:
- `docs/skills/` holds procedures for recurring jobs. `npx docs-wiki skills`
  lists them with their "Use when…" line. Read the matching one before you
  do that job.
- `docs/personas/` holds stances for kinds of work.

Before you finish:
- Run `npx docs-wiki check`. It must exit 0, so fix every enforced finding.
- At the end of a session, follow `docs/skills/sleep-consolidation.md`: write
  down what you learned, and leave a short, state-only handoff in your final
  message or pull request description (not in docs/).
- Future work goes in the issue tracker, not in TODO comments.
<!-- docs-wiki:end -->
```

Replace `npx docs-wiki` with `docs-wiki` if it is installed as a dev
dependency and on your PATH (for example via a package script).

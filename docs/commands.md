# Commands

```sh
docs-wiki <command> [--root <dir>] [--json] [--config <file>]
```

Without installing anything you can run the same thing from a checkout:

```sh
node --experimental-strip-types src/cli.ts <command> …
```

The root defaults to the nearest ancestor of the current directory that
contains `.git` (worktree-aware). Every command, `serve` included, runs on a
bare Node 22 or newer with nothing installed: a docs check should never
depend on an install step having been run.

## Commands

| Command | What it does |
| --- | --- |
| `serve` (default) | Browse the wiki at `http://127.0.0.1:8123` (binds loopback only). `--port <n>` overrides the port. |
| `check` | Lint the corpus. Exit 1 if there are enforced findings. |
| `backlinks <file>` | Every page that links to or mentions `<file>`. |
| `impact [file...]` | A review checklist: which pages to re-read after editing these docs. With no files, it uses the docs your branch changed against `origin/main` (or a local `main`); if neither exists it exits 2 and asks you to name files. |
| `search <query...>` | Full-text search. `tag:<name>` filters by tag. |
| `tags [name]` | List every tag, or the pages carrying one. |
| `orphans` | Pages nothing references. |
| `skills` | The skills and personas this repo carries, with their status. |
| `guide` | How this corpus grows: the contract, derived from the live config. `--json` for the machine form. |
| `init` | Wire the repo up for agents: a marked docs-wiki section in `AGENTS.md`, the bundled skills and personas, and a starter `docs/Home.md`. See [init](#init). |
| `seed [name...]` | Print the bundled seed skills and personas (see [skills and personas](skills-and-personas.md)). Never writes; `init` is the easy path. |

Options:

| Option | Meaning |
| --- | --- |
| `--json` | Machine-readable output (all query commands). |
| `--dry-run` | `init` only: print the plan and write nothing. |
| `--claude` | `init` only: also create `CLAUDE.md` and the `.claude/skills` bridge, even when the repo has no `.claude/` directory. |
| `--root <dir>` | Corpus root. Default: the enclosing git repo. |
| `--port <n>` | Port for `serve`. Default: the config's `port`, else 8123. |
| `--config <file>` | A `docs-wiki.config.json` to apply. Default: the one at the corpus root, if any. The `DOCS_WIKI_CONFIG` environment variable can name one for repos that do not carry their own. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Clean: no enforced findings. |
| 1 | `check` found enforced findings. |
| 2 | Usage or input error (unknown command, bad flag, unreadable config). For `init`: also a root that is not a directory, or a refused write (below). |

## init

```sh
docs-wiki init [--root <dir>] [--dry-run] [--claude] [--json]
```

Non-interactive. Prints one line per file, then a short next-steps note:
`created`, `updated`, `unchanged`, `kept (yours differs)`, or
`skipped (<reason>)`. `--dry-run` prints the same plan and writes nothing.

| File | What init does |
| --- | --- |
| `AGENTS.md` | Maintains a block between `<!-- docs-wiki:start -->` and `<!-- docs-wiki:end -->`, each alone on its line and outside code fences. Creates the file, appends the block, or replaces the block when it differs. Text outside the markers is never touched. |
| `CLAUDE.md` | Makes sure it imports `AGENTS.md` (an `@AGENTS.md` line, in a marked block). Created only with `--claude`, when `.claude/` exists, or when `CLAUDECODE=1` is set (Claude Code's shell sets it). Any `@AGENTS.md` or `@./AGENTS.md` import already in the file counts. Existing line endings and a BOM are kept. |
| skills and personas | Writes each bundled seed to `skills.dir` and `skills.personasDir` (default `docs/skills/`, `docs/personas/`). Missing: created. Identical: `unchanged`. Different: `kept (yours differs)`, never overwritten. A page already named like a seed elsewhere (say `docs/ops/triage.md`) makes init skip that seed, so no wikilink becomes ambiguous. Skipped when the skills layer is disabled. |
| `.claude/skills/<name>/SKILL.md` | With `--claude` or an existing `.claude/`: a relative symlink to each skill file. Falls back to a copy (and adds `.claude/skills` to `skipRelative`) where symlinks are unavailable. |
| `docs/Home.md` | A starter home page, if there is none. |
| `docs/decisions/`, `docs/concepts/`, `docs/runbooks/` | A `.gitkeep` in each that does not exist yet, so the directories the block mentions are in git. |

The AGENTS.md block is generated from your config, so it names your configured
skills directories. Running `init` again changes nothing it already wrote.

`init` exits 2, and writes nothing at all, when it refuses at plan time (printing `would create`, with `written: false` in `--json`): the root is not a
directory, a configured directory resolves outside the root (`..`), a target
file or one of its parent directories is a symlink, a file to rewrite is read-only or has other hard links, or the markers in
`AGENTS.md` or `CLAUDE.md` are malformed (a start without an end, or
duplicates). Fix the file and run it again. An I/O error part way through is reported per file with exit 2 and may leave earlier files written; running `init` again finishes the rest.

## Findings from `check`

| Code | Meaning | Enforced |
| --- | --- | --- |
| `E001` | Broken markdown link: the target file does not exist. | yes |
| `E002` | Broken `[[wikilink]]`: no page has that name. | yes |
| `E003` | Ambiguous resolution: a wikilink or reference matches more than one page. | yes |
| `E004` | Dead mention: prose names an ADR id or a file path that does not exist. | no (report only) |
| `E005` | Duplicate alias claim: two concept pages claim the same alias. | yes |
| `E006` | Broken anchor: a `#heading` link points at a heading that does not exist. | yes |
| `W001` | Orphan page: nothing links to or mentions it. | no |
| `W002` | Long page: past the length and section thresholds (see `longPage` in the [configuration](configuration.md)). | no |
| `W003` | A skill or persona page is malformed (missing Status line, unknown status, missing section). | no |

Only `E001`, `E002`, `E003`, `E005` and `E006` are ever enforced. The
other codes are heuristics and stay report-only by design. A repo can also
mark whole directories report-only with `reportOnlyPaths`.

## The corpus model

Every `.md` file under the root (minus skipped directories) is a page. A
page's id is its repo-relative path. Links resolve through one resolver:
markdown links, `[[wikilinks]]`, unlinked prose mentions (ADR ids, blocker
ids, file paths, unique basenames, concept aliases), and `PR #N`. Ambiguity
is a hard error, never a silent pick. docs-wiki never rewrites your files.

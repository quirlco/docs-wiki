# Setting up docs-wiki in a repo

Step by step, for an agent or a person. Every command here was written to be
run from the repository root.

## 1. Check the prerequisites

```sh
node --version     # must be v22 or newer
git rev-parse --show-toplevel   # the repo root (docs-wiki defaults to this)
```

If Node is older than 22, stop and tell the user. docs-wiki relies on a
Node feature that older versions lack.

## 2. Install (or skip installing)

Either add it as a dev dependency:

```sh
npm i -D docs-wiki
```

or run it on demand with `npx docs-wiki <command>` and install nothing. The
rest of this page writes `docs-wiki <command>`; use whichever form you chose.

## 3. Run init

```sh
docs-wiki init --dry-run   # optional: print the plan, write nothing
docs-wiki init
```

`init` is the easy path and is safe to re-run. It never overwrites a file you
have changed. It writes:

- a marked section in `AGENTS.md` that tells future sessions to use docs-wiki
  and how (created if missing, appended if the file exists, replaced in place
  if the section is already there; text outside the markers is never touched);
- the bundled skills and personas under your configured directories (by
  default `docs/skills/` and `docs/personas/`);
- `docs/Home.md`, a starter home page, if you have none;
- with `--claude`, or when the repo has `CLAUDE.md` or `.claude/`: a `CLAUDE.md`
  that imports `AGENTS.md`, and `.claude/skills/<name>/SKILL.md` links to the
  skill files.

Read each line it prints. Exit 2 means one of two things. A refusal found while
planning (a path outside the repo, a symlinked or read-only or hard-linked
target, broken markers in `AGENTS.md`) writes nothing: its lines read
`would create` or `would update`. An I/O error part way through (for example an
unwritable directory) is reported per file and may leave earlier files written;
fix the cause and run `init` again, and it completes what is missing. If the fix
means changing a file you did not create (permissions, links, existing pages),
ask the user first.

## 4. Run the check

```sh
docs-wiki check
echo "exit: $?"
```

Exit codes:

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | No enforced findings | Done. Report-only findings may still be listed. |
| 1 | At least one enforced finding | Fix them (below) and run again. |
| 2 | Usage or input error | Read stderr. Usually a mistyped command or flag, or a config file with a bad key or type. |

Each finding prints as `CODE page:line [enforced|reported] message`. Add
`--json` for a machine-readable list.

## 5. Fix findings, code by code

Enforced (these make `check` exit 1):

| Code | Meaning | Fix |
| --- | --- | --- |
| `E001` | Markdown link whose target file does not exist | Correct the path, restore the missing file, or remove the link. If the file was renamed, run `docs-wiki backlinks <new-name>` to find stale links to the old name. |
| `E002` | `[[wikilink]]` with no matching page | Fix the name, create the page, or turn it into plain text. |
| `E003` | A reference that matches more than one page (for example two `notes.md` files) | Use an explicit path link instead, or rename one of the pages. |
| `E005` | Two concept pages claim the same alias in their frontmatter | Give each alias one owner. Remove it from one page. |
| `E006` | A `#heading` link to a heading that does not exist | Fix the anchor, or restore the heading. Anchors follow GitHub's slug rules (lowercase, spaces become dashes). |

Report-only (listed, but they do not change the exit code):

| Code | Meaning | What to do |
| --- | --- | --- |
| `E004` | Prose mentions an ADR id or file path that does not exist | Fix or drop the mention. Often a renamed file. |
| `W001` | Orphan: nothing links to this page | Link it from the page a reader would arrive from, merge it into the page that owns the subject, or delete it on purpose. Do not add a link only to silence the warning. |
| `W002` | Long page (over 400 lines and 6 sections by default) | Ask whether the page has one subject. One subject: leave it, add a table of contents. A journal: archive old entries, never split by topic. Several subjects: split and link. |
| `W003` | A skill or persona page is malformed | Run `docs-wiki guide` for the required format: a `Status:` line under the title, and the required sections. |

Re-run `docs-wiki check` until it exits 0.

## 6. Learn the repo's conventions

```sh
docs-wiki guide
```

It prints the entry page, where skills and personas live, the long-page
thresholds and the tag taxonomy, all derived from this repo's configuration.

## 7. Configure only if you need to

Defaults work for most repos. Create `docs-wiki.config.json` at the repo root
only to change something. Common reasons:

```json
{
  "entryPage": "docs/index.md",
  "reportOnlyPaths": ["notes/"],
  "skipRelative": ["vendor/docs-snapshot"]
}
```

A typo in this file fails loudly with exit 2 and names the key. The full list
of keys is in [configuration](../docs/configuration.md).

## 8. Wire it into CI

`init` already told your agents about docs-wiki. To enforce the gate for
everyone, also run it in CI:

```sh
docs-wiki check
```

A non-zero exit fails the job. If you would rather wire the instruction file
by hand than run `init`, use the snippet in
[README.md](README.md#prefer-to-wire-it-by-hand), and `docs-wiki seed` to print
the skills and personas instead of writing them.

## 9. Confirm

```sh
docs-wiki check && echo ok
docs-wiki serve        # optional: browse at http://127.0.0.1:8123
```

Tell the user what you added, and which files you created or changed.

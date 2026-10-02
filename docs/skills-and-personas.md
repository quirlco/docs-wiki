# Skills and personas

docs-wiki ships nine seed pages you can adopt into your own repo: six skills
and three personas. They are written for an AI coding agent (or a person) that
works on your docs and wants a shared way of doing it.

- A **skill** is a repeatable procedure, with sections `## When`, `## Moves`
  and `## Evidence`.
- A **persona** is a stance for a kind of work, with sections
  `## When to adopt` and `## Stance` (and by convention `## Toolkit` and
  `## Retire when`).

The seeds:

| Seed | Kind | What it is for |
| --- | --- | --- |
| `doc-gardening` | skill | Deciding what to do about orphan and long-page warnings |
| `pattern-recognition` | skill | Noticing repetition worth writing down (the rule of three) |
| `skill-authoring` | skill | The format and lifecycle of a skill |
| `persona-authoring` | skill | When and how to write a persona |
| `sleep-consolidation` | skill | Ending a session: run the checks, record what you learned, commit |
| `ticket-hygiene` | skill | Keeping future work in your issue tracker rather than in comments |
| `gardener` | persona | Corpus maintenance: cohesion and link integrity |
| `historian` | persona | Keeping decisions and statuses truthful |
| `triage` | persona | Turning raw input into correctly shaped issues |

## Maturity

Every skill and persona carries a `Status:` line directly under its title,
from a closed vocabulary shared by every repo:

- `draft`: written, not yet proven.
- `active`: earned by linked evidence from real work.
- `deprecated`: superseded; the body names the successor; never deleted.

## Adopting the seeds

The easy path is one command:

```sh
docs-wiki init
```

It writes every seed that is not there yet to the path your config resolves
(by default `docs/skills/` and `docs/personas/`), leaves any file you already
have untouched (reported as `kept (yours differs)`), and also adds a docs-wiki
section to `AGENTS.md` so agents find the skills. With `--claude`, or when the
repo has a `.claude/` directory, it links each skill into `.claude/skills/` for
Claude Code. Re-running it is safe. See [commands](commands.md#init) for the
details.

To read before you adopt, or to adopt by hand, `seed` only prints:

```sh
docs-wiki seed                  # print every seed under its target path
docs-wiki seed doc-gardening    # or just one
```

`seed` prints each file under the path your config resolves for it, followed by
adoption notes: the `git add` line, optional symlink commands for agent tools
that read skills from their own directory, and a caveat for repos that
override `kinds`. `seed` never writes into your repo; writing and committing
the files is then your move.

Afterwards:

- `docs-wiki skills` lists what your repo carries, with status.
- `docs-wiki guide` prints the whole contract derived from your live config
  (`--json` for the machine form).
- `docs-wiki check` verifies the page format as finding `W003`, report-only.

## The loop

The guide describes one loop: act, notice, encode, apply, sleep. You do the
work; you notice something that keeps recurring; you write it down in the
right place (a doc edit, a decision record, an issue, a skill, a persona);
the next session reads the guide and applies it; at the end of a session you
consolidate and commit before clearing context.

If your repo already keeps skills or personas somewhere else, point
`skills.dir` and `skills.personasDir` at them in the
[configuration](configuration.md). The default taxonomy tags pages under
`docs/skills/` and `docs/personas/` as `skill` and `persona`.

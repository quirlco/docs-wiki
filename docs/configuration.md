# Configuration

docs-wiki works with no configuration at all. To change anything, put a
`docs-wiki.config.json` at the corpus root. Every key is optional.

An external config can be applied to a repo that does not carry one with
`--config <file>` or the `DOCS_WIKI_CONFIG` environment variable. Precedence:
`--config`, then `DOCS_WIKI_CONFIG`, then `<root>/docs-wiki.config.json`, then
the defaults. The file is parsed by hand, so a typo or a wrong type fails
loudly with the file and key named; it never falls back silently.

```jsonc
{
  // Featured "Start here" page on the server's table of contents.
  // Default: first existing of docs/Home.md, docs/wiki/index.md, README.md;
  // none present means no banner.
  "entryPage": "docs/Home.md",

  // Serve port (default 8123); --port overrides.
  "port": 8123,

  // Page-id prefixes whose lint findings are report-only (never fail CI).
  // Default [] — everything enforced.
  "reportOnlyPaths": ["tasks/"],

  // Directory NAMES skipped wherever they appear. Merged with the baseline
  // (node_modules, .git, tmp, dist, .next, .turbo, .vercel, .wrangler,
  // build, DerivedData, .build, xcuserdata). Adds only, never subtracts.
  "skipDirs": ["target"],

  // Repo-relative paths skipped at exactly that location. Merged with
  // [".claude/worktrees"]. The engine's own src/fixtures is excluded
  // automatically whenever it sits inside the corpus root.
  "skipRelative": ["vendor/snapshots"],

  // Extra regexes for machine-local files (never indexed, never served at
  // /raw/, never existence-checked). Merged with a non-removable security
  // floor: (^|/)\.env, (^|/)\.dev\.vars, ^\.claude/worktrees(/|$),
  // ^tmp(/|$), (^|/)node_modules(/|$), (^|/)\.DS_Store$, \.log$.
  // Config can only add, never subtract.
  "machineLocal": ["\\.pem$"],

  // Toggle mention-identifier families (scanning and rendering);
  // all default true.
  "mentionIds": { "adr": true, "blocker": true, "pr": true },

  // W002 long-page warning. Fires only when BOTH thresholds are exceeded,
  // because length alone would flag a thorough single-subject ADR, which is
  // fine. Always report-only. Merged field-wise; `false` disables it.
  // Default: { "enabled": true, "lines": 400, "sections": 6 }
  "longPage": { "lines": 400, "sections": 6 },

  // Where skills and personas live (see skills-and-personas.md).
  // Merged field-wise: setting `dir` keeps the default `personasDir`.
  // `false` disables the layer (no W003, `skills` reports empty).
  // Directories are repo-relative, normalised to a trailing "/".
  // Default: { "enabled": true, "dir": "docs/skills/", "personasDir": "docs/personas/" }
  "skills": { "dir": "docs/skills/" },

  // Ordered taxonomy rules; FIRST MATCH WINS. Each rule has a tag and at
  // most one matcher: prefix (id.startsWith), pattern (regex on the id), or
  // rootOnly (no "/" in the id). A rule with no matcher is the catch-all.
  // statusLine: true reads a "Status: <value>" line from the page's first
  // prose lines into a derived status:<value> tag (the ADR convention).
  // This one list drives both tag derivation and the table of contents'
  // grouping, so they can never drift apart. The default is shown below;
  // setting "kinds" replaces the whole list, so re-add the skill and
  // persona rules if you keep that layer.
  "kinds": [
    { "tag": "adr", "pattern": "(^|/)decisions/\\d{4}-[^/]+\\.md$", "statusLine": true },
    { "tag": "runbook", "prefix": "docs/runbooks/" },
    { "tag": "concept", "pattern": "(^|/)concepts/" },
    { "tag": "skill", "prefix": "docs/skills/", "statusLine": true },
    { "tag": "persona", "prefix": "docs/personas/", "statusLine": true },
    { "tag": "design", "prefix": "docs/design/" },
    { "tag": "milestone", "prefix": "tasks/done/" },
    { "tag": "planning", "prefix": "tasks/" },
    { "tag": "reference", "prefix": "docs/" },
    { "tag": "root", "rootOnly": true }
  ]
}
```

Pages can also declare their own tags and aliases in frontmatter:

```markdown
---
tags: [organizing, search]
aliases: [notebook, notebooks]
---
```

Declared tags join the derived ones. Aliases make a concept page findable by
plain-prose mentions; two pages claiming the same alias is finding `E005`.

## What `init` and `guide` assume

`docs-wiki init` and `docs-wiki guide` assume the three memory folders
`docs/decisions/`, `docs/concepts/` and `docs/runbooks/`; they are fixed, not
derived from `kinds`. The skills and personas directories follow
`skills.dir` and `skills.personasDir`, which must stay inside the repo (no
`..` segments, nothing under `.git`); backslashes are read as `/`.

# Library API

`docs-wiki` is also a library. `src/index.ts` is the barrel, and the package
root exports it. Use it when you want to render docs that are stored somewhere
other than the filesystem, or embed backlinks in your own app.

```ts
import {
  buildIndex, corpusFromFiles, loadConfig, makeRenderContext,
  renderMarkdown, backlinksPanelHtml, graphJson,
} from "docs-wiki";

const config = loadConfig(root);                       // or resolveConfig({...})
const corpus = corpusFromFiles(root, files, config);   // Map<pageId, markdown>; or walkCorpus(root, config)
const index = buildIndex(corpus);
const ctx = makeRenderContext(index, repoUrl, {
  page: (id, anchor) => `/projects/x/docs/${id}${anchor ? `#${anchor}` : ""}`,
  raw: (path) => `/projects/x/files/${path}`,
  tag: (name) => `/projects/x/tags/${encodeURIComponent(name)}`,
});                                                    // href hooks; defaults are /page/ /raw/ /tag/
const html = renderMarkdown(content, id, ctx);         // + backlinksPanelHtml, tocHtml, tagChipsHtml
const graph = graphJson(index);                        // payload for the canvas clients
```

TypeScript users: the type declarations reference Node's types, so install `@types/node` as a dev dependency in your project.

## What else is exported

- Corpus and index: `walkCorpus`, `computeOrphans`, `lintIndex` and
  `hasEnforced`.
- Search: `buildSearchIndex`, `search` and `parseQuery`.
- Rendering helpers: `escapeHtml`, `githubSlug`, `shellHtml`.
- The standalone server: `startWikiServer`.
- Skills and personas: `skillPages`, `skillFiles`, `seedNotes`,
  `growthGuide` and `growthGuideJson`, `SKILL_STATUSES`,
  `REQUIRED_SECTIONS`.
- All the types (`WikiConfig`, `WikiIndex`, `Page`, `Edge`, `LintFinding`, …).

## Browser assets

Client scripts ship under `docs-wiki/public/*`:

- `graph.mjs` exports `mountGraph(canvas, legendEl, dataUrl, pageHref?)`.
- `pane-graph.mjs` exports `mountPaneGraph(canvas, pageId, legendEl, dataUrl?, pageHref?)`.
- The standalone server's pages use the thin auto-run entry `graph-auto.mjs`.

## Running from source

The package ships a prebuilt `dist/`. A checkout of the repository runs
straight from TypeScript source with no build step, using Node's built-in type
stripping (`node --experimental-strip-types src/cli.ts`). `pnpm build`
produces the `dist/` that gets published.

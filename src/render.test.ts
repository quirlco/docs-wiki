// The renderer is a SECOND consumer of the mention rules — these tests pin
// it to the scanner's semantics (the review that prompted this file found
// the two had already drifted: aliases matched inside paths, and a
// document-controlled anchor reached an href attribute unescaped).

import { describe, expect, it } from "vitest";

import { buildIndex } from "./graph.ts";
import { escapeHtml, makeRenderContext, renderMarkdown } from "./render.ts";
import { memCorpus } from "./test-helpers.ts";
import type { Corpus } from "./corpus.ts";

function render(
  files: Record<string, string>,
  page: string,
  repoUrl: string | null = null,
) {
  const corpus: Corpus = memCorpus(files);
  const ctx = makeRenderContext(buildIndex(corpus), repoUrl);
  return renderMarkdown(files[page], page, ctx);
}

describe("escapeHtml", () => {
  it("escapes the four HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">&amp;</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;",
    );
  });
});

describe("renderMarkdown — attribute safety", () => {
  it("keeps a hostile wikilink anchor inside the href attribute", () => {
    const html = render(
      {
        "sub/alpha.md": "# Alpha\n\n## X\n",
        "note.md": '# N\n\n[[alpha#x" onmouseover="alert(1)]]\n',
      },
      "note.md",
    );
    expect(html).not.toContain('onmouseover="alert');
    expect(html).toContain("&quot; onmouseover=&quot;"); // neutralized, visible in href
  });
});

describe("renderMarkdown — scanner parity", () => {
  const conceptFiles = {
    "docs/wiki/concepts/router.md":
      "---\naliases: [router]\n---\n\n# Router\n",
    "services/api/src/index.ts": "",
    "note.md":
      "# N\n\nThe router worker lives in services/api and its entry is services/api/src/index.ts.\n",
  };

  it("never linkifies an alias inside a path (dirs and files alike)", () => {
    const html = render(conceptFiles, "note.md");
    // Prose alias linked once…
    expect(html).toContain(
      'href="/page/docs/wiki/concepts/router.md">router</a>',
    );
    // …but never inside the directory or file path tokens.
    expect(html).not.toContain(
      'services/<a href="/page/docs/wiki/concepts/router.md">',
    );
    expect(html).toContain('href="/raw/services/api/src/index.ts"');
  });

  it("wraps backticked path mentions whole: <a><code>…</code></a>", () => {
    const html = render(
      {
        "docs/a.md": "# A\n\nSee `packages/x.css` for details.\n",
        "packages/x.css": "",
      },
      "docs/a.md",
    );
    expect(html).toContain(
      '<a href="/raw/packages/x.css"><code>packages/x.css</code></a>',
    );
  });

  it("renders unresolved wikilinks as dead spans, resolved ones as links", () => {
    const html = render(
      { "a.md": "# A\n\n[[b]] and [[missing-page]]\n", "b.md": "# B\n" },
      "a.md",
    );
    expect(html).toContain('href="/page/b.md"');
    expect(html).toContain('class="dead"');
  });

  it("links PR #N only when a repo URL is known", () => {
    const files = { "a.md": "# A\n\nShipped in PR #42.\n" };
    expect(render(files, "a.md", "https://github.com/u/r")).toContain(
      'href="https://github.com/u/r/pull/42"',
    );
    expect(render(files, "a.md", null)).not.toContain("/pull/42");
  });

  it("leaves fenced content byte-identical", () => {
    const html = render(
      {
        "a.md": "# A\n\n```bash\n# heading? docs/b.md [[b]]\n```\n",
        "docs/b.md": "# B\n",
        "b.md": "# B2\n",
      },
      "a.md",
    );
    expect(html).toContain("# heading? docs/b.md [[b]]");
    expect(html).not.toContain('<a href="/page/docs/b.md"');
  });
});

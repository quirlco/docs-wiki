import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WIKI_VERSION } from "./index.ts";
import { marked } from "./vendor/marked.mjs";

describe("docs-wiki skeleton", () => {
  it("exports a semver version", () => {
    expect(WIKI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("takes WIKI_VERSION from package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(WIKI_VERSION).toBe(pkg.version);
  });

  it("renders GFM tables via the VENDORED marked with zero configuration", () => {
    // The package has zero runtime dependencies; marked ships vendored at
    // src/vendor/marked.mjs so `serve` works with no npm install.
    const html = marked.parse("# Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<h1>");
    expect(html).toContain("<table>");
  });
});

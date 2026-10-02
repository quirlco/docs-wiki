import { describe, expect, it } from "vitest";

import { buildSearchIndex, search, tokenize } from "./search.ts";
import { memCorpus } from "./test-helpers.ts";

const corpus = memCorpus({
  "a.md": "# Alpha Systems\n\ntenant gateway tenant routing\n",
  "b.md": "# Beta\n\ngateway only here\n",
  "c.md": "# Tenant Guide\n\nall about slugs\n",
  "d.md": "# Token Store\n\nTokenStoreDO holds the grant state.\n",
});
const index = buildSearchIndex(corpus);

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, keeps identifiers whole", () => {
    expect(tokenize("TokenStoreDO holds ADR-0042!")).toEqual([
      "tokenstoredo",
      "holds",
      "adr",
      "0042",
    ]);
  });
});

describe("search", () => {
  it("boosts title matches above body matches", () => {
    const hits = search(index, "tenant");
    expect(hits[0].id).toBe("c.md"); // "Tenant" in title
    expect(hits.map((h) => h.id)).toContain("a.md");
  });

  it("prefix-expands the final term (search-as-you-type)", () => {
    expect(search(index, "tenan").map((h) => h.id)).toContain("a.md");
    expect(search(index, "TokenSt")[0]?.id).toBe("d.md");
  });

  it("requires every term (AND semantics)", () => {
    const hits = search(index, "tenant gateway");
    expect(hits.map((h) => h.id)).toEqual(["a.md"]);
  });

  it("matches identifiers case-insensitively", () => {
    expect(search(index, "tokenstoredo")[0]?.id).toBe("d.md");
  });

  it("returns empty for no matches and empty queries", () => {
    expect(search(index, "zzzzz")).toEqual([]);
    expect(search(index, "  !? ")).toEqual([]);
  });
});

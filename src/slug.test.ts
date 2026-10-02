import { describe, expect, it } from "vitest";

import { githubSlug, Slugger } from "./slug.ts";

describe("githubSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(githubSlug("Hello World")).toBe("hello-world");
  });

  it("strips punctuation without spacing it", () => {
    expect(githubSlug("What's this?")).toBe("whats-this");
    expect(githubSlug("Hello, World!")).toBe("hello-world");
  });

  it("drops em-dashes but keeps each surrounding space as a hyphen", () => {
    // A status-heading shape: "### Item 7 — DONE 2026-01-15".
    expect(githubSlug("Item 7 — DONE 2026-01-15")).toBe(
      "item-7--done-2026-01-15",
    );
  });

  it("removes backticks and emphasis markers like GitHub's rendered text", () => {
    expect(githubSlug("`code` first")).toBe("code-first");
    expect(githubSlug("**bold** heading")).toBe("bold-heading");
  });

  it("keeps underscores and hyphens", () => {
    expect(githubSlug("snake_case stays")).toBe("snake_case-stays");
    expect(githubSlug("pre-hyphenated")).toBe("pre-hyphenated");
  });
});

describe("Slugger dedupe", () => {
  it("suffixes repeats with -1, -2", () => {
    const s = new Slugger();
    expect(s.slug("Section One")).toBe("section-one");
    expect(s.slug("Section One")).toBe("section-one-1");
    expect(s.slug("Section One")).toBe("section-one-2");
  });

  it("never emits the same slug twice even when a literal heading collides with a suffix", () => {
    const s = new Slugger();
    const emitted = [s.slug("x"), s.slug("x"), s.slug("x-1")];
    expect(new Set(emitted).size).toBe(3);
    expect(emitted).toEqual(["x", "x-1", "x-1-1"]);
  });
});

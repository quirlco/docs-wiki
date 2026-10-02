import { describe, expect, it } from "vitest";

import { maskInlineCode, parseDoc } from "./parser.ts";

describe("maskInlineCode", () => {
  it("blanks single-backtick spans, preserving length", () => {
    const masked = maskInlineCode("a `b c` d");
    expect(masked).toBe("a       d");
    expect(masked.length).toBe("a `b c` d".length);
  });

  it("handles double-backtick spans containing single backticks", () => {
    expect(maskInlineCode("x ``a ` b`` y")).toBe("x           y");
  });

  it("leaves unmatched backticks as literal text", () => {
    expect(maskInlineCode("just ` one")).toBe("just ` one");
  });
});

describe("parseDoc — fences", () => {
  it("ignores heading-looking and link-looking lines inside fences", () => {
    const doc = parseDoc(
      [
        "# Real",
        "",
        "```bash",
        "# not a heading",
        "[fake](x.md)",
        "[[fake]]",
        "```",
        "",
      ].join("\n"),
      "f.md",
    );
    expect(doc.headings.map((h) => h.text)).toEqual(["Real"]);
    expect(doc.links).toHaveLength(0);
    expect(doc.wikilinks).toHaveLength(0);
  });

  it("does not close a backtick fence with a tilde fence or a shorter run", () => {
    const doc = parseDoc(
      ["````", "```", "# still fenced", "~~~", "````", "# out"].join("\n"),
      "f.md",
    );
    expect(doc.headings.map((h) => h.text)).toEqual(["out"]);
  });

  it("survives an unterminated fence at EOF without leaking tokens", () => {
    const doc = parseDoc(
      ["# Title", "```text", "# fenced", "[x](y.md)"].join("\n"),
      "f.md",
    );
    expect(doc.headings.map((h) => h.text)).toEqual(["Title"]);
    expect(doc.links).toHaveLength(0);
  });

  it("excludes fenced lines from proseLines", () => {
    const doc = parseDoc(
      ["prose", "```", "fenced", "```", "more prose"].join("\n"),
      "f.md",
    );
    expect(doc.proseLines.map((l) => l.text)).toEqual(["prose", "more prose"]);
    expect(doc.proseLines.map((l) => l.line)).toEqual([1, 5]);
  });
});

describe("parseDoc — headings and title", () => {
  it("takes the first H1 as title and slugs with per-doc dedupe", () => {
    const doc = parseDoc(
      "# ADR-0007: Fixture\n\n## Section One\n\n## Section One\n",
      "f.md",
    );
    expect(doc.title).toBe("ADR-0007: Fixture");
    expect(doc.headings.map((h) => h.slug)).toEqual([
      "adr-0007-fixture",
      "section-one",
      "section-one-1",
    ]);
    expect(doc.headings.map((h) => h.line)).toEqual([1, 3, 5]);
  });

  it("falls back to the file name when there is no H1", () => {
    expect(parseDoc("just prose\n", "notes.md").title).toBe("notes.md");
  });

  it("tolerates multiple H1s (tasks/TODO.md has three)", () => {
    const doc = parseDoc("# One\n\n# Two\n", "f.md");
    expect(doc.title).toBe("One");
    expect(doc.headings).toHaveLength(2);
  });
});

describe("parseDoc — explicit links", () => {
  it("extracts relative links with anchors and titles", () => {
    const doc = parseDoc('[a](sub/x.md#frag) [b](y.md "Titled")', "f.md");
    expect(doc.links).toHaveLength(2);
    expect(doc.links[0]).toMatchObject({ target: "sub/x.md", anchor: "frag" });
    expect(doc.links[1]).toMatchObject({ target: "y.md", anchor: undefined });
  });

  it("skips external and protocol-relative targets", () => {
    const doc = parseDoc(
      "[e](https://example.com/x.md) [m](mailto:a@b.c) [p](//cdn.example/x.md)",
      "f.md",
    );
    expect(doc.links).toHaveLength(0);
  });

  it("records pure-anchor links with an empty target", () => {
    const doc = parseDoc("[below](#local-heading)", "f.md");
    expect(doc.links[0]).toMatchObject({ target: "", anchor: "local-heading" });
  });

  it("flags images and still records their targets", () => {
    const doc = parseDoc("![logo](assets/logo.svg)", "f.md");
    expect(doc.links[0]).toMatchObject({
      image: true,
      target: "assets/logo.svg",
    });
  });

  it("does not extract links from inline code", () => {
    const doc = parseDoc("`[not a link](x.md)` but [real](y.md)", "f.md");
    expect(doc.links.map((l) => l.target)).toEqual(["y.md"]);
  });
});

describe("parseDoc — wikilinks", () => {
  it("parses target, alias, and heading forms", () => {
    const doc = parseDoc(
      "[[alpha]] [[alpha|The Alpha]] [[alpha#section-one]]",
      "f.md",
    );
    expect(doc.wikilinks).toHaveLength(3);
    expect(doc.wikilinks[0]).toMatchObject({
      target: "alpha",
      alias: undefined,
    });
    expect(doc.wikilinks[1]).toMatchObject({
      target: "alpha",
      alias: "The Alpha",
    });
    expect(doc.wikilinks[2]).toMatchObject({
      target: "alpha",
      anchor: "section-one",
    });
  });

  it("never treats Next.js catch-all route syntax as a wikilink", () => {
    // Verbatim shape from docs/decisions/0011-dashboard-authentication.md:135-136.
    const doc = parseDoc(
      "- `/sign-in/[[...rest]]/page.tsx`\n- raw form: /sign-up/[[...rest]]/page.tsx\n",
      "f.md",
    );
    expect(doc.wikilinks).toHaveLength(0);
  });

  it("rejects targets with path traversal or a leading dot", () => {
    const doc = parseDoc("[[../escape]] [[.hidden]]", "f.md");
    expect(doc.wikilinks).toHaveLength(0);
  });
});

describe("parseDoc — frontmatter", () => {
  it("reads inline alias lists and offsets line numbers", () => {
    const doc = parseDoc(
      "---\naliases: [widget, the widget engine]\n---\n\n# Widget\n",
      "f.md",
    );
    expect(doc.aliases).toEqual(["widget", "the widget engine"]);
    expect(doc.headings[0].line).toBe(5);
  });

  it("reads block alias lists", () => {
    const doc = parseDoc("---\naliases:\n  - one\n  - two\n---\n# T\n", "f.md");
    expect(doc.aliases).toEqual(["one", "two"]);
  });

  it("reads prettier-wrapped multi-line bracket arrays", () => {
    const doc = parseDoc(
      "---\naliases:\n  [\n    supply chain,\n    npm worm,\n  ]\nother: x\n---\n# T\n",
      "f.md",
    );
    expect(doc.aliases).toEqual(["supply chain", "npm worm"]);
  });

  it("treats unterminated frontmatter as content", () => {
    const doc = parseDoc("---\naliases: [x]\n# Heading\n", "f.md");
    expect(doc.aliases).toEqual([]);
    expect(doc.headings.map((h) => h.text)).toEqual(["Heading"]);
  });
});

describe("frontmatter description", () => {
  it("reads a folded block, and a plain value, ahead of other keys", () => {
    const folded = parseDoc(
      "---\nname: x\ndescription: >-\n  Use when a\n  and b.\ntags: [skill]\n---\n# X\n",
      "x.md",
    );
    expect(folded.description).toBe("Use when a and b.");
    expect(folded.declaredTags).toEqual(["skill"]);
    expect(parseDoc("---\ndescription: Plain one\n---\n# X\n", "x.md").description).toBe("Plain one");
    expect(parseDoc("# X\n", "x.md").description).toBe("");
  });
});

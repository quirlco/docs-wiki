// `docs-wiki guide` derives everything from the live config and the actual
// corpus — a repo that moved its skills directory or tuned its thresholds
// gets a guide that says so verbatim, never a generic one.

import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.ts";
import { buildIndex } from "./graph.ts";
import { growthGuide, growthGuideJson } from "./guide.ts";
import { WIKI_VERSION } from "./index.ts";
import { memCorpus } from "./test-helpers.ts";

describe("growthGuide", () => {
  const config = resolveConfig({
    entryPage: "docs/start-here.md",
    skills: { dir: "meta/skills", personasDir: "meta/personas" },
    longPage: { lines: 250, sections: 4 },
  });
  const corpus = memCorpus(
    {
      "meta/skills/example.md":
        "# example\n\nStatus: draft\n\n## When\n\n- x\n\n## Moves\n\n1. y\n",
      "docs/start-here.md": "# Start\n\nSee [[example]].\n",
    },
    config,
  );
  const index = buildIndex(corpus);

  it("reflects the non-default config verbatim", () => {
    const text = growthGuide(corpus, index);
    expect(text).toContain("meta/skills/");
    expect(text).toContain("meta/personas/");
    expect(text).toContain("250");
    expect(text).toContain("docs/start-here.md");
    expect(text).toContain("draft | active | deprecated");
    // the actual skills listing, from the index
    expect(text).toContain("meta/skills/example.md");
    // the loop, the rule, the doctrine
    expect(text).toContain("act → notice → encode → apply → sleep");
    expect(text).toContain("rule of three");
    expect(text).toContain("NEVER split by topic");
  });

  it("offers seed when the corpus has no skills yet", () => {
    const bare = memCorpus({ "README.md": "# R\n" });
    const text = growthGuide(bare, buildIndex(bare));
    expect(text).toContain("`docs-wiki seed`");
  });

  it("distinguishes a disabled layer from an empty corpus in JSON", () => {
    const disabled = memCorpus(
      { "README.md": "# R\n" },
      resolveConfig({ skills: false }),
    );
    const j = growthGuideJson(disabled, buildIndex(disabled));
    expect(j.enabled).toBe(false);
    expect(j.skills).toEqual([]);
    const empty = memCorpus({ "README.md": "# R\n" });
    expect(growthGuideJson(empty, buildIndex(empty)).enabled).toBe(true);
  });

  it("emits the compiled JSON contract", () => {
    const j = growthGuideJson(corpus, index);
    expect(j.version).toBe(WIKI_VERSION);
    expect(j.enabled).toBe(true);
    expect(j.skillsDir).toBe("meta/skills/");
    expect(j.personasDir).toBe("meta/personas/");
    expect(j.statuses).toEqual(["draft", "active", "deprecated"]);
    expect(j.requiredSections.skill).toEqual(["When", "Moves"]);
    expect(j.requiredSections.persona).toEqual(["When to adopt", "Stance"]);
    expect(j.skills).toHaveLength(1);
    expect(j.skills[0].id).toBe("meta/skills/example.md");
    expect(j.skills[0].missing).toEqual([]);
    expect(j.personas).toEqual([]);
    expect(j.longPage).toEqual({ enabled: true, lines: 250, sections: 4 });
  });
});

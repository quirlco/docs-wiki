// The skills layer: membership by configured directory, the Status scrape,
// and the required-section contract — the records lint.ts turns into W003.

import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.ts";
import type { WikiConfig } from "./config.ts";
import { buildIndex } from "./graph.ts";
import { skillPages, REQUIRED_SECTIONS, SKILL_STATUSES } from "./skills.ts";
import { memCorpus } from "./test-helpers.ts";

function records(files: Record<string, string>, config?: WikiConfig) {
  const corpus = config ? memCorpus(files, config) : memCorpus(files);
  return skillPages(corpus, buildIndex(corpus));
}

const GOOD_SKILL =
  "# good\n\nStatus: active\n\nSummary.\n\n## When\n\n- x\n\n## Moves\n\n1. y\n";

describe("skillPages membership", () => {
  it("classifies by the configured directories, skills and personas apart", () => {
    const r = records({
      "docs/skills/good.md": GOOD_SKILL,
      "docs/personas/p.md":
        "# p\n\nStatus: draft\n\n## When to adopt\n\n- x\n\n## Stance\n\n- y\n",
      "docs/other.md": "# not a skill\n",
    });
    expect(r.map((x) => [x.id, x.role])).toEqual([
      ["docs/personas/p.md", "persona"],
      ["docs/skills/good.md", "skill"],
    ]);
  });

  it("honors a non-default layout — membership follows config, not defaults", () => {
    const cfg = resolveConfig({ skills: { dir: "meta/skills" } });
    const r = records(
      {
        "meta/skills/good.md": GOOD_SKILL,
        "docs/skills/stray.md": GOOD_SKILL, // not the configured dir any more
      },
      cfg,
    );
    expect(r.map((x) => x.id)).toEqual(["meta/skills/good.md"]);
  });

  it("resolves nested dirs by the longest prefix — personas inside dir stay personas", () => {
    const cfg = resolveConfig({
      skills: { dir: "docs/playbook/", personasDir: "docs/playbook/personas/" },
    });
    const r = records(
      {
        "docs/playbook/s.md": GOOD_SKILL,
        "docs/playbook/personas/p.md":
          "# p\n\nStatus: draft\n\n## When to adopt\n\n- x\n\n## Stance\n\n- y\n",
      },
      cfg,
    );
    expect(r.map((x) => [x.id, x.role])).toEqual([
      ["docs/playbook/personas/p.md", "persona"],
      ["docs/playbook/s.md", "skill"],
    ]);
  });

  it("exempts README.md and index.md basenames — organisation, not a skill", () => {
    const r = records({
      "docs/skills/README.md": "# The skills\n",
      "docs/skills/index.md": "# Index\n",
      "docs/skills/good.md": GOOD_SKILL,
    });
    expect(r.map((x) => x.id)).toEqual(["docs/skills/good.md"]);
  });

  it("is empty when the skills layer is disabled", () => {
    const cfg = resolveConfig({ skills: false });
    expect(records({ "docs/skills/good.md": GOOD_SKILL }, cfg)).toEqual([]);
  });
});

describe("skillPages conformance", () => {
  it("a well-formed skill has nothing missing", () => {
    const [r] = records({ "docs/skills/good.md": GOOD_SKILL });
    expect(r.status).toBe("active");
    expect(r.sections).toEqual(["When", "Moves"]);
    expect(r.missing).toEqual([]);
  });

  it("names a missing Status line", () => {
    const [r] = records({
      "docs/skills/no-status.md": "# s\n\n## When\n\n- x\n\n## Moves\n\n1. y\n",
    });
    expect(r.status).toBeNull();
    expect(r.missing).toEqual(["Status line"]);
  });

  it("names an off-vocabulary status", () => {
    const [r] = records({
      "docs/skills/weird.md":
        "# s\n\nStatus: wip\n\n## When\n\n- x\n\n## Moves\n\n1. y\n",
    });
    expect(r.status).toBe("wip");
    expect(r.missing).toEqual(['unknown status "wip"']);
  });

  it("names the absent required sections for a persona", () => {
    const [r] = records({
      "docs/personas/p.md": "# p\n\nStatus: draft\n\n## When to adopt\n\n- x\n",
    });
    expect(r.missing).toEqual(["Stance"]);
  });

  it("matches required sections case-insensitively", () => {
    const [r] = records({
      "docs/skills/cased.md":
        "# s\n\nStatus: active\n\n## when\n\n- x\n\n## MOVES\n\n1. y\n",
    });
    expect(r.missing).toEqual([]);
  });

  it("keeps the closed vocabularies stable — the cross-repo surface", () => {
    expect(SKILL_STATUSES).toEqual(["draft", "active", "deprecated"]);
    expect(REQUIRED_SECTIONS.skill).toEqual(["When", "Moves"]);
    expect(REQUIRED_SECTIONS.persona).toEqual(["When to adopt", "Stance"]);
  });
});

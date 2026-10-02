// Tags — the browse/facet layer over the corpus.
//
// The design constraint is the same one that shaped mention auto-linking:
// high-churn files must stay byte-identical, so a scheme that requires
// frontmatter on every doc is a non-starter. Tags therefore come from three
// sources, in ascending order of cleverness and descending order of
// authority:
//
//   derived   — a fact about the file itself (it IS an ADR; its Status line
//               says accepted). Free, exact, no edits to anything. WHAT is
//               derived is the config's `kinds` list — the same ordered list
//               render.ts groups the TOC by, so derivation and rendering can
//               never drift apart (the KIND_TAGS bug this replaces).
//   declared  — frontmatter `tags:` on files whose authors opted in. Exact,
//               but only reaches files someone has touched.
//   inherited — topics borrowed from a concept page the doc leans on. This
//               is the only inferred kind, so it is deliberately conservative
//               (see MIN_INHERIT below) and always labelled in the UI.
//
// Provenance is kept per tag rather than flattened, because a reader must be
// able to tell "this doc IS about OAuth" from "this doc mentions something
// that is about OAuth".

import type { KindRule } from "./config.ts";
import type { ParsedDoc } from "./parser.ts";
import type { Edge, PageId, Tag } from "./types.ts";

/**
 * A doc inherits a concept's topics only if it leans on that concept: an
 * explicit link, or at least this many mentions. One passing mention of
 * "tenant" does not make a document a multi-tenancy document.
 */
const MIN_INHERIT_MENTIONS = 3;

const CONCEPT_PATH = /(^|\/)concepts\//;

/** A concept page is one in a `concepts/` directory, wherever that sits.
 *  Concept-ness feeds tag INHERITANCE (topic vocabulary), which is a
 *  different axis from the kind taxonomy — it stays fixed rather than
 *  config-driven, matching every ancestor of this engine. */
export function isConceptPage(id: PageId): boolean {
  return CONCEPT_PATH.test(id);
}

/** ADRs put "Date: … · Status: accepted" near the top; skill and persona pages
 *  (skills.ts) carry a plain "Status: draft|active|deprecated". Scraped
 *  only for kinds whose rule sets `statusLine: true`, and by the skills
 *  layer through scrapeStatus below. */
const STATUS_LINE =
  /^\s*(?:>\s*)?(?:Date:.*·\s*)?Status:\s*([A-Za-z][A-Za-z -]*)/i;

/** The normalized `Status:` value from a doc's first prose lines, or null
 *  when it has none. ONE scraper serves both tag derivation here and the
 *  skills layer (skills.ts), so a page's `status:<value>` tag and its
 *  SkillRecord.status can never disagree about what the line says. */
export function scrapeStatus(doc: ParsedDoc): string | null {
  for (const line of doc.proseLines.slice(0, 8)) {
    const m = STATUS_LINE.exec(line.text);
    if (m) return m[1].trim().toLowerCase().replace(/\s+/g, "-");
  }
  return null;
}

/** The first kind rule matching a page id, or null when nothing matches
 *  (the page then carries no kind tag). A rule with no matcher is the
 *  catch-all. Exported because render.ts's TOC grouping must ask the SAME
 *  question the tagger answered. */
export function kindOf(
  id: PageId,
  kinds: readonly KindRule[],
): KindRule | null {
  for (const rule of kinds) {
    if (rule.rootOnly === true) {
      if (!id.includes("/")) return rule;
      continue;
    }
    if (rule.prefix !== undefined) {
      if (id.startsWith(rule.prefix)) return rule;
      continue;
    }
    if (rule.pattern !== undefined) {
      if (rule.pattern.test(id)) return rule;
      continue;
    }
    return rule; // no matcher — catch-all
  }
  return null;
}

/** Tags that are simply true of the file: its kind (from the config's
 *  ordered rule list, first match wins) and — for statusLine kinds — the
 *  scraped `status:<value>`. */
export function derivedTags(
  id: PageId,
  doc: ParsedDoc,
  kinds: readonly KindRule[],
): string[] {
  const rule = kindOf(id, kinds);
  if (rule === null) return [];
  const tags = [rule.tag];
  if (rule.statusLine) {
    const status = scrapeStatus(doc);
    if (status !== null) tags.push(`status:${status}`);
  }
  return tags;
}

export interface TagInput {
  id: PageId;
  doc: ParsedDoc;
  edges: Edge[];
}

/**
 * Compute every page's tag set. Concept pages' DECLARED tags are the topic
 * vocabulary; other pages inherit them through the mention graph.
 */
export function computeTags(
  inputs: TagInput[],
  isConcept: (id: PageId) => boolean,
  kinds: readonly KindRule[],
): Map<PageId, Tag[]> {
  const conceptTopics = new Map<PageId, string[]>();
  for (const { id, doc } of inputs) {
    if (isConcept(id) && doc.declaredTags.length > 0) {
      conceptTopics.set(id, doc.declaredTags);
    }
  }

  const out = new Map<PageId, Tag[]>();
  for (const { id, doc, edges } of inputs) {
    const byName = new Map<string, Tag>();
    const add = (name: string, source: Tag["source"]): void => {
      const key = name.toLowerCase();
      // Stronger provenance wins: derived > declared > inherited.
      const rank = { derived: 3, declared: 2, inherited: 1 } as const;
      const existing = byName.get(key);
      if (existing === undefined || rank[source] > rank[existing.source]) {
        byName.set(key, { name: key, source });
      }
    };

    for (const t of derivedTags(id, doc, kinds)) add(t, "derived");
    for (const t of doc.declaredTags) add(t, "declared");

    // Inheritance: how heavily does this page lean on each concept? An
    // explicit link is intent and counts as sufficient on its own; mentions
    // count by occurrence (edges fold repeats into Edge.count).
    const leaning = new Map<PageId, number>();
    for (const e of edges) {
      if (e.to === null || e.targetKind !== "page" || !isConcept(e.to))
        continue;
      const weight =
        e.type === "link" || e.type === "wikilink"
          ? MIN_INHERIT_MENTIONS
          : e.count;
      leaning.set(e.to, (leaning.get(e.to) ?? 0) + weight);
    }
    if (!isConcept(id)) {
      for (const [conceptId, weight] of leaning) {
        if (weight < MIN_INHERIT_MENTIONS) continue;
        for (const t of conceptTopics.get(conceptId) ?? []) add(t, "inherited");
      }
    }

    out.set(
      id,
      [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  return out;
}

export function buildTagIndex(
  pages: Map<PageId, { tags: Tag[] }>,
): Map<string, PageId[]> {
  const index = new Map<string, PageId[]>();
  for (const [id, page] of pages) {
    for (const t of page.tags) {
      index.set(t.name, [...(index.get(t.name) ?? []), id]);
    }
  }
  for (const ids of index.values()) ids.sort();
  return new Map([...index.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

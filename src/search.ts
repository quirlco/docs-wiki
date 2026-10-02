// Hand-rolled inverted-index search. No stemming, no fuzz — this corpus is
// full of identifiers (TokenStoreDO, ADR-0042, kubectl) where exact and
// prefix matching are what you actually want. The whole index builds in
// milliseconds at this scale; one implementation serves the CLI and the
// server's /api/search endpoint.

import type { Corpus } from "./corpus.ts";
import type { PageId } from "./types.ts";

export interface SearchHit {
  id: PageId;
  title: string;
  score: number;
}

export interface SearchIndex {
  docs: { id: PageId; title: string }[];
  /** Sorted, for prefix expansion via binary search. */
  tokens: string[];
  /** token → (docIdx → weighted term frequency). */
  postings: Map<string, Map<number, number>>;
}

const TITLE_WEIGHT = 5;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

export function buildSearchIndex(corpus: Corpus): SearchIndex {
  const docs: { id: PageId; title: string }[] = [];
  const postings = new Map<string, Map<number, number>>();

  const add = (token: string, docIdx: number, weight: number): void => {
    let byDoc = postings.get(token);
    if (byDoc === undefined) {
      byDoc = new Map();
      postings.set(token, byDoc);
    }
    byDoc.set(docIdx, (byDoc.get(docIdx) ?? 0) + weight);
  };

  for (const id of [...corpus.docs.keys()].sort()) {
    const doc = corpus.docs.get(id);
    if (doc === undefined) continue;
    const docIdx = docs.length;
    docs.push({ id, title: doc.title });
    for (const t of tokenize(doc.title)) add(t, docIdx, TITLE_WEIGHT);
    for (const t of tokenize(id)) add(t, docIdx, TITLE_WEIGHT);
    for (const line of doc.proseLines)
      for (const t of tokenize(line.text)) add(t, docIdx, 1);
  }

  return { docs, tokens: [...postings.keys()].sort(), postings };
}

/** Tokens starting with `prefix`, via binary search on the sorted list. */
function prefixRange(tokens: string[], prefix: string, cap: number): string[] {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  for (let i = lo; i < tokens.length && out.length < cap; i += 1) {
    if (!tokens[i].startsWith(prefix)) break;
    out.push(tokens[i]);
  }
  return out;
}

/** `tag:adr sync log` → { tags: ["adr"], text: "sync log" }.
 *  Splitting here (rather than in each caller) keeps the CLI and the server's
 *  search box answering the same query language. */
export function parseQuery(query: string): { tags: string[]; text: string } {
  const tags: string[] = [];
  const rest: string[] = [];
  for (const token of query.split(/\s+/)) {
    const m = /^tag:(.+)$/i.exec(token);
    if (m) tags.push(m[1].toLowerCase());
    else if (token !== "") rest.push(token);
  }
  return { tags, text: rest.join(" ") };
}

export function search(
  index: SearchIndex,
  query: string,
  limit = 20,
): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const n = index.docs.length;
  const perTermScores: Map<number, number>[] = terms.map((term, i) => {
    const last = i === terms.length - 1;
    // Every term matches itself exactly; the final term also prefix-expands
    // so search-as-you-type works ("TokenSt" → TokenStoreDO).
    const matched = last ? prefixRange(index.tokens, term, 50) : [];
    if (!last || !matched.includes(term)) {
      if (index.postings.has(term)) matched.unshift(term);
    }
    const scores = new Map<number, number>();
    for (const token of matched) {
      const byDoc = index.postings.get(token);
      if (byDoc === undefined) continue;
      const idf = Math.log(1 + n / byDoc.size);
      for (const [docIdx, tf] of byDoc) {
        scores.set(docIdx, (scores.get(docIdx) ?? 0) + tf * idf);
      }
    }
    return scores;
  });

  // AND semantics: a doc must match every term.
  const first = perTermScores[0];
  const hits: SearchHit[] = [];
  for (const [docIdx, score0] of first) {
    let total = score0;
    let all = true;
    for (let i = 1; i < perTermScores.length; i += 1) {
      const s = perTermScores[i].get(docIdx);
      if (s === undefined) {
        all = false;
        break;
      }
      total += s;
    }
    if (all) hits.push({ ...index.docs[docIdx], score: total });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

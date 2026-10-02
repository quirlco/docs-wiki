// Lint: findings from an index. The v1 enforcement contract, documented in
// the README and relied on by CI: broken/ambiguous EXPLICIT references
// (E001/E002/E003/E006) fail the build outside tasks/**; a duplicate alias
// claim (E005) fails EVERYWHERE, because the alias vocabulary is one global
// namespace; dead mentions (E004), orphans (W001), long pages (W002) and
// malformed skill and persona pages (W003) are always report-only, because each is a
// heuristic — prose recognition, graph reachability, a length proxy for
// cohesion, a format check on an advisory layer — and none must ever fail
// the concurrent build loop's PRs. W003 in particular stays report-only
// PERMANENTLY: a malformed draft skill must never block the PR that is
// trying to fix it. Tightening this is an ADR amendment, not a tweak — and
// keep this comment in step with the code, which is the failure this very
// line once had.

import type { Corpus } from "./corpus.ts";
import { computeOrphans } from "./graph.ts";
import { skillPages } from "./skills.ts";
import type { LintFinding, WikiIndex } from "./types.ts";

export function lintIndex(corpus: Corpus, index: WikiIndex): LintFinding[] {
  const findings: LintFinding[] = [];
  const severityFor = (page: string): LintFinding["severity"] =>
    index.pages.get(page)?.scope === "enforced" ? "enforced" : "reported";

  for (const edge of index.edges) {
    if (edge.type === "link" || edge.type === "wikilink") {
      const severity = severityFor(edge.from);
      if (edge.unresolved === "ambiguous") {
        findings.push({
          code: "E003",
          page: edge.from,
          line: edge.line,
          severity,
          message: `ambiguous ${edge.type} ${edge.raw} — candidates: ${(edge.candidates ?? []).join(", ")}`,
        });
      } else if (edge.unresolved === "not-found") {
        findings.push({
          code: edge.type === "link" ? "E001" : "E002",
          page: edge.from,
          line: edge.line,
          severity,
          message: `broken ${edge.type} ${edge.raw} — target not found`,
        });
      } else if (
        edge.anchor !== undefined &&
        edge.targetKind === "page" &&
        edge.to !== null
      ) {
        const target = index.pages.get(edge.to);
        if (target && !target.headings.some((h) => h.slug === edge.anchor)) {
          findings.push({
            code: "E006",
            page: edge.from,
            line: edge.line,
            severity,
            message: `broken anchor #${edge.anchor} on ${edge.raw} — no such heading in ${edge.to}`,
          });
        }
      }
    } else if (edge.to === null) {
      findings.push({
        code: "E004",
        page: edge.from,
        line: edge.line,
        severity: "reported",
        message: `dead mention "${edge.raw}" — no such ${edge.targetKind === "page" ? "page" : "file"}`,
      });
    }
  }

  // Intra-doc anchors never become edges; check them straight off the parse.
  for (const [id, doc] of corpus.docs) {
    if (!index.pages.has(id)) continue;
    for (const link of doc.links) {
      if (link.target !== "" || link.anchor === undefined) continue;
      if (!doc.headings.some((h) => h.slug === link.anchor)) {
        findings.push({
          code: "E006",
          page: id,
          line: link.line,
          severity: severityFor(id),
          message: `broken intra-doc anchor #${link.anchor} (${link.raw})`,
        });
      }
    }
  }

  for (const c of index.aliasCollisions) {
    findings.push({
      code: "E005",
      page: c.pages[c.pages.length - 1],
      line: 1,
      severity: "enforced",
      message: `alias "${c.alias}" claimed by multiple pages: ${c.pages.join(", ")}`,
    });
  }

  for (const orphan of computeOrphans(index)) {
    findings.push({
      code: "W001",
      page: orphan,
      line: 1,
      severity: "reported",
      message: "orphan page — nothing links or mentions it",
    });
  }

  // W002 long page. Length is a *symptom*; the property that matters is
  // cohesion — does this file have one subject? — and a linter cannot see
  // that. So both signals have to agree before it says anything, which keeps
  // it quiet about a long single-subject ADR while catching a file that has
  // grown several unrelated H2 groups.
  //
  // Always report-only, and never becomes enforced: the right answer is
  // sometimes "leave it, add a summary" and sometimes "archive the old
  // entries" — an append-only journal is the worst offender in these corpora
  // and is exactly the file a naive "long ⇒ split" rule would ruin. The lint
  // raises the question; a human or an agent answers it.
  const { longPage } = corpus.config;
  if (longPage.enabled) {
    for (const [id, doc] of corpus.docs) {
      if (!index.pages.has(id)) continue;
      if (doc.lineCount <= longPage.lines) continue;
      const sections = doc.headings.filter((h) => h.depth === 2).length;
      if (sections < longPage.sections) continue;
      findings.push({
        code: "W002",
        page: id,
        line: 1,
        severity: "reported",
        message: `long page — ${doc.lineCount} lines across ${sections} sections; is this still one subject?`,
      });
    }
  }

  // W003 skill or persona page malformed. The skills layer's format contract — the
  // Status line, the closed maturity vocabulary, the required sections —
  // checked wherever the config says skills and personas live. skills.ts
  // computes what is missing; this only names it. Severity is "reported"
  // ALWAYS (see the contract at the top of this file).
  if (corpus.config.skills.enabled) {
    for (const rec of skillPages(corpus, index)) {
      if (rec.missing.length === 0) continue;
      const h1 = index.pages.get(rec.id)?.headings.find((h) => h.depth === 1);
      const named = rec.missing
        .map((m) =>
          m.startsWith("unknown status")
            ? m
            : m === "Status line"
              ? "missing Status line"
              : `missing "${m}" section`,
        )
        .join(", ");
      findings.push({
        code: "W003",
        page: rec.id,
        line: h1?.line ?? 1,
        severity: "reported",
        message: `${rec.role} page malformed — ${named}; \`docs-wiki guide\` shows the format`,
      });
    }
  }

  return findings.sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) || // "enforced" < "reported"
      a.page.localeCompare(b.page) ||
      a.line - b.line ||
      a.code.localeCompare(b.code),
  );
}

export function hasEnforced(findings: LintFinding[]): boolean {
  return findings.some((f) => f.severity === "enforced");
}

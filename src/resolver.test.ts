import { describe, expect, it } from "vitest";

import { normalizePath, resolveTarget } from "./resolver.ts";
import type { ResolverContext } from "./resolver.ts";

function ctx(pages: string[]): ResolverContext {
  const basenameIndex = new Map<string, string[]>();
  for (const p of pages) {
    const base = (p.split("/").pop() ?? p).toLowerCase();
    basenameIndex.set(base, [...(basenameIndex.get(base) ?? []), p]);
  }
  return { pages: new Set(pages), basenameIndex };
}

const C = ctx([
  "README.md",
  "docs/security.md",
  "docs/decisions/0007-use-postgres.md",
  "sub/notes.md",
  "other/notes.md",
  "sub/alpha.md",
]);

describe("normalizePath", () => {
  it("resolves dot segments", () => {
    expect(normalizePath("docs/decisions/../security.md")).toBe(
      "docs/security.md",
    );
    expect(normalizePath("./README.md")).toBe("README.md");
  });

  it("returns empty when traversal escapes the root", () => {
    expect(normalizePath("../outside.md")).toBe("");
  });
});

describe("resolveTarget", () => {
  it("resolves relative to the source file first (GitHub semantics)", () => {
    const r = resolveTarget(
      "../security.md",
      "docs/decisions/0007-use-postgres.md",
      C,
    );
    expect(r).toEqual({ ok: true, id: "docs/security.md" });
  });

  it("falls back to repo-root form for root-style references", () => {
    const r = resolveTarget(
      "docs/security.md",
      "docs/decisions/0007-use-postgres.md",
      C,
    );
    expect(r).toEqual({ ok: true, id: "docs/security.md" });
  });

  it("treats a leading slash as repo-root", () => {
    expect(resolveTarget("/docs/security.md", "README.md", C)).toEqual({
      ok: true,
      id: "docs/security.md",
    });
  });

  it("resolves a unique basename without extension, case-insensitively", () => {
    expect(resolveTarget("Alpha", "README.md", C)).toEqual({
      ok: true,
      id: "sub/alpha.md",
    });
  });

  it("ERRORS on ambiguous basenames instead of silently picking", () => {
    const r = resolveTarget("notes", "README.md", C);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "ambiguous") {
      expect(r.candidates.sort()).toEqual(["other/notes.md", "sub/notes.md"]);
    } else {
      expect.unreachable("expected an ambiguous resolution");
    }
  });

  it("reports not-found for missing targets and escaped paths", () => {
    expect(resolveTarget("missing.md", "README.md", C)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(resolveTarget("../../outside.md", "README.md", C)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("never uses basename matching for path-shaped targets", () => {
    expect(resolveTarget("wrongdir/alpha.md", "README.md", C)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

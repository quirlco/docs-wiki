// GitHub's anchor algorithm (github-slugger semantics, hand-rolled to keep
// the dependency count at one): lowercase, drop every character that is not
// a letter, number, whitespace, hyphen or underscore, then turn each
// whitespace character into a hyphen. Parity with GitHub is the point — a
// `#fragment` written in a doc must resolve identically in the wiki UI and
// in GitHub's rendering of the same file.

export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Per-document slugger: repeated headings get -1, -2, … like GitHub. */
export class Slugger {
  private counts = new Map<string, number>();

  slug(text: string): string {
    const base = githubSlug(text);
    const seen = this.counts.get(base);
    if (seen === undefined) {
      this.counts.set(base, 0);
      return base;
    }
    // A suffixed form can itself collide with a later literal heading
    // ("x", "x", "x-1" → x, x-1, x-1-1 on GitHub); track every emitted slug.
    let n = seen + 1;
    let candidate = `${base}-${n}`;
    while (this.counts.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    this.counts.set(base, n);
    this.counts.set(candidate, 0);
    return candidate;
  }
}

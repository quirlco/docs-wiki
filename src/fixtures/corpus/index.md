# Fixture Index

Valid relative link: [alpha](sub/alpha.md).
Root-style link with leading slash: [alpha again](/sub/alpha.md).
Broken link: [missing](missing.md).
Anchor link on a target page: [section](sub/alpha.md#section-one).
Intra-doc anchor: [below](#local-heading).
Broken intra-doc anchor: [nowhere](#does-not-exist).
External links stay inert: [example](https://example.com/page.md) and <https://example.com>.

Wikilinks: [[alpha]] resolves by basename, [[alpha|the alpha page]] carries an
alias, and [[alpha#section-one]] carries a heading.
Broken wikilink: [[nonexistent-page]].
Ambiguous wikilink: [[notes]] — two files share that basename.

ADR mention: ADR-0007 decided the widget approach. Blocker mention: B7.
Missing ADR mention: ADR-0099 has never existed.

## Local Heading

The widget engine drives everything here — that phrase is a registered alias
of the widget concept page and must produce a mention-alias edge.

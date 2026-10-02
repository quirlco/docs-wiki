# Fence EOF

An unterminated fence must not break the parser or leak tokens:

```text
# looks like a heading
[[looks-like-a-wikilink]]
[looks like a link](fake.md)

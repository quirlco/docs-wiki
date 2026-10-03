# Security policy

## Reporting a vulnerability

Please report security problems privately, using GitHub's private
vulnerability reporting: open the **Security** tab of this repository and
choose **Report a vulnerability**. Please do not open a public issue for
anything exploitable.

Include what you found, how to reproduce it, and which version you used. You
should get an acknowledgement within a few days.

## What docs-wiki does and does not do

- It reads markdown files under the root you give it and serves them on
  `127.0.0.1` only. There is no flag to bind another address.
- It never writes to your repository.
- Files that look machine-local (environment files, logs, `node_modules`) are
  never indexed or served.
- It has no runtime dependencies, and the package runs no install-time
  scripts.

## How releases are made

Releases are cut by tagging `v*` on a commit that is already on `main`. From
1.0.0 on, they are published from GitHub Actions with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements)
via npm trusted publishing, behind a human-approved `npm` environment. The
workflow can only *stage* a release; it reaches the registry after a
maintainer approves it on npm with two-factor authentication, and npm
refuses token-based publishing for this package. The `0.0.0-reserve` and
`0.0.0-stage` placeholders (deprecated) were created manually to claim the
package name; they carry no provenance and no code.

You can check a release against this repository:

```sh
npm audit signatures
```

All GitHub Actions used in the workflows are pinned to full commit SHAs.

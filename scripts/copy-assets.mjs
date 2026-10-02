// Copies the non-TypeScript runtime assets next to the compiled output.
// The code finds them relative to its own file (public/, vendor/, seeds/),
// so dist/ must mirror src/ for these three directories.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["public", "vendor", "seeds"]) {
  mkdirSync(join(root, "dist", dir), { recursive: true });
  cpSync(join(root, "src", dir), join(root, "dist", dir), { recursive: true });
}

// The compiled CLI is the package's bin: give it a shebang.
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
const cli = join(root, "dist", "cli.js");
const text = readFileSync(cli, "utf8");
if (!text.startsWith("#!")) {
  writeFileSync(cli, `#!/usr/bin/env node\n${text}`);
}
chmodSync(cli, 0o755);

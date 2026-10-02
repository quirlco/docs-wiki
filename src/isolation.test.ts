// The standalone server is a local tool. These assertions are a tripwire:
// they fail the moment it can be bound to anything but loopback, or the
// package grows a lifecycle script that runs code on install.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("the standalone server is loopback-only", () => {
  it("binds loopback with no way to widen it", () => {
    const server = readFileSync(
      new URL("./server.ts", import.meta.url),
      "utf8",
    );
    // The address is a literal, not a variable, option or env read. Note
    // "[::1]" DOES appear in this file and is fine — it is a Host HEADER
    // allowlist entry, not a bind address; only `listen` decides exposure.
    expect(server).toContain('server.listen(port, "127.0.0.1", resolve)');
    expect(server.match(/\.listen\(/g)).toHaveLength(1);
    expect(server).not.toMatch(/0\.0\.0\.0|process\.env\.(HOST|BIND|ADDRESS)/);

    // …and the CLI offers no flag that could reach it.
    const cli = readFileSync(new URL("./cli.ts", import.meta.url), "utf8");
    expect(cli).not.toMatch(/--host|--bind|--public|--expose/);
  });

  it("runs no code at install time", () => {
    // Zero runtime dependencies and no lifecycle scripts: installing this
    // package must never execute anything.
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string>; dependencies?: object };
    const scripts = Object.keys(pkg.scripts ?? {});
    for (const hook of ["preinstall", "install", "postinstall"])
      expect(scripts).not.toContain(hook);
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "docs-wiki",
    // Fixture corpora contain deliberately broken markdown; they are test
    // DATA, never test files. Overriding `exclude` drops vitest's defaults,
    // so node_modules must be restated.
    exclude: ["src/fixtures/**", "examples/**", "dist/**", "node_modules/**"],
  },
});

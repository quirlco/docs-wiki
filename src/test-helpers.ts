// In-memory corpus construction for unit tests — no filesystem involved.
// A thin veneer over the public corpusFromFiles, so tests exercise the same
// code path a host app uses.

import { resolveConfig } from "./config.ts";
import type { WikiConfig } from "./config.ts";
import { corpusFromFiles } from "./corpus.ts";
import type { Corpus } from "./corpus.ts";

/** Values are file contents for .md entries; any other path just exists. */
export function memCorpus(
  files: Record<string, string>,
  config: WikiConfig = resolveConfig({}),
): Corpus {
  return corpusFromFiles("/mem", new Map(Object.entries(files)), config);
}

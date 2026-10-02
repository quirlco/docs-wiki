// Auto-run entry for the standalone server's /graph page: mounts the corpus
// graph exactly as the pre-refactor graph.mjs did on load. Kept separate so
// graph.mjs itself is a pure module a host app can import (mountGraph) with
// its own canvas and data endpoint.

import { mountGraph } from "./graph.mjs";

await mountGraph(
  document.getElementById("graph"),
  document.getElementById("graph-legend"),
  "/api/graph.json",
);

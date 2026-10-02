// Force-directed graph of the corpus — rendering and interaction only. The
// layout core (physics, the non-overlap constraint, label placement) lives in
// layout.mjs so its guarantees can be unit-tested instead of eyeballed:
//   1. node circles never overlap;
//   2. labels never cover a node or another label.
//
// This module only EXPORTS mountGraph — no top-level side effects — so a
// host app can import it against its own canvas and data endpoint. The
// standalone server's /graph page uses the tiny auto-run entry
// graph-auto.mjs, which mounts it exactly as before.

import {
  bounds,
  placeLabels,
  prewarm,
  seedPositions,
  step,
} from "./layout.mjs";

const PALETTE = [
  "#4c8dff",
  "#3fb27f",
  "#d9a441",
  "#a879f0",
  "#e2725b",
  "#3aa8b5",
  "#e06c9f",
];

/**
 * Fetch graph JSON (the shape graphJson() in graph.ts produces) from
 * `dataUrl` and run the interactive corpus graph on `canvas`, with a colour
 * legend in `legendEl` (optional). Node clicks navigate via `pageHref`
 * (default: the standalone server's /page/<id> route).
 */
export async function mountGraph(
  canvas,
  legendEl = null,
  dataUrl = "/api/graph.json",
  pageHref = (id) => `/page/${id}`,
) {
  const ctx = canvas.getContext("2d");

  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const EDGE = dark ? "rgba(160,172,184,0.42)" : "rgba(90,102,114,0.42)";
  const EDGE_FAINT = dark ? "rgba(160,172,184,0.10)" : "rgba(90,102,114,0.10)";
  const LABEL = dark ? "#e8ecef" : "#141a1f";
  const HALO = dark ? "rgba(20,24,28,0.92)" : "rgba(255,255,255,0.92)";

  const { nodes, links, groups = [] } = await (await fetch(dataUrl)).json();

  // Colour by index into the CORPUS-wide group list the server sends, not into
  // the groups present in this view — otherwise "docs" is orange on this page
  // and green in a single page's pane, which is worse than no colour at all.
  const colorOf = (g) =>
    PALETTE[Math.max(0, groups.indexOf(g)) % PALETTE.length];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Labels must be unambiguous: a repo can have four different README.md
  // files, and four nodes all reading "README" is worse than no label at all.
  const baseName = (id) =>
    (id.split("/").pop() ?? id).replace(/\.md$/, "") || id;
  const baseCounts = new Map();
  for (const n of nodes) {
    baseCounts.set(baseName(n.id), (baseCounts.get(baseName(n.id)) ?? 0) + 1);
  }
  const shortName = (id) => {
    const base = baseName(id);
    if ((baseCounts.get(base) ?? 0) < 2) return base;
    const parts = id.split("/");
    return parts.length > 1 ? `${parts[parts.length - 2]}/${base}` : base;
  };

  seedPositions(nodes);
  for (const n of nodes) n.label = shortName(n.id);

  const springs = links
    .map((l) => ({
      a: byId.get(l.source),
      b: byId.get(l.target),
      explicit: l.explicit,
    }))
    .filter((s) => s.a && s.b);

  const neighbors = new Map(nodes.map((n) => [n, new Set()]));
  for (const s of springs) {
    neighbors.get(s.a).add(s.b);
    neighbors.get(s.b).add(s.a);
  }

  let alpha = 1;
  let dragging = null;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let hovered = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  }

  function fitToView() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const { minX, minY, maxX, maxY } = bounds(nodes);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    scale = Math.max(
      0.15,
      Math.min((rect.width - 90) / w, (rect.height - 60) / h, 1.6),
    );
    panX = -((minX + maxX) / 2) * scale;
    panY = -((minY + maxY) / 2) * scale;
  }

  // Settle BEFORE the first paint: the page opens readable rather than
  // animating out of a pile (and a screenshot captures the converged graph).
  alpha = prewarm(nodes, springs);
  resize();
  fitToView();
  addEventListener("resize", () => {
    resize();
    fitToView();
  });

  const measure = (text, size, bold) => {
    ctx.font = `${bold ? 600 : 400} ${size}px system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };

  function drawLabels(focus) {
    const rect = canvas.getBoundingClientRect();
    const view = {
      scale,
      panX,
      panY,
      width: rect.width,
      height: rect.height,
    };
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    for (const l of placeLabels(nodes, view, measure, { focus, hovered })) {
      ctx.font = `${l.emphasised ? 600 : 400} ${l.size}px system-ui, sans-serif`;
      // Halo so a label crossing an edge stays legible.
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(l.node.label, l.x, l.y + l.size - 1);
      ctx.fillStyle = LABEL;
      ctx.fillText(l.node.label, l.x, l.y + l.size - 1);
    }
  }

  function draw() {
    if (alpha > 0.021 || dragging) alpha = step(nodes, springs, alpha, dragging);
    const rect = canvas.getBoundingClientRect();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width / 2 + panX, rect.height / 2 + panY);
    ctx.scale(scale, scale);

    const focus = hovered ? new Set([hovered, ...neighbors.get(hovered)]) : null;

    for (const s of springs) {
      if (focus && !(focus.has(s.a) && focus.has(s.b))) continue;
      ctx.strokeStyle = s.explicit ? EDGE : EDGE_FAINT;
      ctx.lineWidth = (s.explicit ? 1.3 : 0.8) / scale;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      ctx.globalAlpha = focus && !focus.has(n) ? 0.18 : 1;
      ctx.fillStyle = colorOf(n.group);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (n === hovered) {
        ctx.strokeStyle = LABEL;
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawLabels(focus);
    requestAnimationFrame(draw);
  }

  function toWorld(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - rect.width / 2 - panX) / scale,
      y: (ev.clientY - rect.top - rect.height / 2 - panY) / scale,
    };
  }

  function nodeAt(p) {
    let best = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= n.r + 4 / scale && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  let panFrom = null;
  let pressPos = null;

  canvas.addEventListener("pointerdown", (ev) => {
    const n = nodeAt(toWorld(ev));
    pressPos = { x: ev.clientX, y: ev.clientY };
    if (n) {
      dragging = n;
      alpha = Math.max(alpha, 0.35);
    } else {
      panFrom = { x: ev.clientX - panX, y: ev.clientY - panY };
      canvas.style.cursor = "grabbing";
    }
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (dragging) {
      const p = toWorld(ev);
      dragging.x = p.x;
      dragging.y = p.y;
      alpha = Math.max(alpha, 0.25);
    } else if (panFrom) {
      panX = ev.clientX - panFrom.x;
      panY = ev.clientY - panFrom.y;
    } else {
      const n = nodeAt(toWorld(ev));
      if (n !== hovered) {
        hovered = n;
        canvas.style.cursor = n ? "pointer" : "grab";
      }
    }
  });

  canvas.addEventListener("pointerup", (ev) => {
    const moved =
      pressPos && Math.hypot(ev.clientX - pressPos.x, ev.clientY - pressPos.y);
    const n = dragging;
    dragging = null;
    panFrom = null;
    pressPos = null;
    canvas.style.cursor = hovered ? "pointer" : "grab";
    if (n && moved !== null && moved < 4) location.href = pageHref(n.id);
  });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = toWorld(ev);
    scale = Math.min(4, Math.max(0.15, scale * (ev.deltaY < 0 ? 1.12 : 0.89)));
    // Keep the point under the cursor fixed while zooming.
    panX = ev.clientX - rect.left - rect.width / 2 - before.x * scale;
    panY = ev.clientY - rect.top - rect.height / 2 - before.y * scale;
  });

  addEventListener("keydown", (ev) => {
    if (ev.key === "f" && document.activeElement?.tagName !== "INPUT")
      fitToView();
  });

  if (legendEl) {
    legendEl.innerHTML =
      groups
        .map(
          (g) =>
            `<span><i style="background:${colorOf(g)}"></i>${g === "root" ? "repo root" : g}</span>`,
        )
        .join("") + `<span>press <b>f</b> to refit</span>`;
  }

  draw();
}

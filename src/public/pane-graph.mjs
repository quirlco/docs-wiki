// The backlinks pane's Graph tab: this page's neighbourhood, drawn with the
// same layout core as the full graph so the two never drift apart. Loaded
// lazily by app.mjs the first time the tab is opened — a doc page should not
// pay for a canvas nobody looked at.

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
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const EDGE = dark ? "rgba(160,172,184,0.5)" : "rgba(90,102,114,0.5)";
const EDGE_FAINT = dark ? "rgba(160,172,184,0.16)" : "rgba(90,102,114,0.16)";
const LABEL = dark ? "#e8ecef" : "#141a1f";
const HALO = dark ? "rgba(20,24,28,0.92)" : "rgba(255,255,255,0.92)";
const FOCUS_RING = dark ? "#e8ecef" : "#141a1f";

export async function mountPaneGraph(
  canvas,
  pageId,
  legendEl = null,
  // A host app embedding the pane points these at its own endpoint/routes;
  // the defaults are the standalone server's.
  dataUrl = `/api/graph.json?page=${encodeURIComponent(pageId)}`,
  pageHref = (id) => `/page/${id}`,
) {
  const ctx = canvas.getContext("2d");
  const res = await fetch(dataUrl);
  // Always return a handle, even on failure: the caller memoises this and a
  // bare `return` would make the tab permanently dead after one bad fetch.
  if (!res.ok) return { show() {} };
  const { nodes, links, groups = [] } = await res.json();

  // Index into the corpus-wide list so a group's colour is the same here as
  // on the /graph page.
  const colorOf = (g) =>
    PALETTE[Math.max(0, groups.indexOf(g)) % PALETTE.length];

  if (legendEl) {
    // Only the groups actually on screen — a legend listing absent colours
    // is noise in a pane this size.
    const present = [...new Set(nodes.map((n) => n.group))].sort();
    legendEl.innerHTML = present
      .map(
        (name) =>
          `<span><i style="background:${colorOf(name)}"></i>${name === "root" ? "repo root" : name}</span>`,
      )
      .join("");
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // In a neighbourhood view every node is one hop from the focus, so the
  // bare filename is unambiguous enough and keeps the pane uncluttered.
  seedPositions(nodes);
  for (const n of nodes) {
    n.label = (n.id.split("/").pop() ?? n.id).replace(/\.md$/, "");
    if (n.focus) n.r = Math.max(n.r, 9);
  }

  const springs = links
    .map((l) => ({
      a: byId.get(l.source),
      b: byId.get(l.target),
      explicit: l.explicit,
    }))
    .filter((s) => s.a && s.b);

  let alpha = prewarm(nodes, springs);
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let hovered = null;
  let dragging = null;
  let panFrom = null;
  let pressPos = null;
  // Exactly one requestAnimationFrame chain may be live. Re-selecting an
  // already-open tab used to start another, so N clicks stepped the physics
  // N times per frame.
  let running = false;
  let fitted = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return false;
    canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    return true;
  }

  function fit() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const { minX, minY, maxX, maxY } = bounds(nodes);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    scale = Math.max(
      0.1,
      Math.min((rect.width - 70) / w, (rect.height - 30) / h, 1.1),
    );
    panX = -((minX + maxX) / 2) * scale;
    panY = -((minY + maxY) / 2) * scale;
  }

  const measure = (text, size, bold) => {
    ctx.font = `${bold ? 600 : 400} ${size}px system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) {
      // Tab hidden — stop drawing rather than burning frames on 0×0.
      running = false;
      return;
    }
    if (alpha > 0.021 || dragging)
      alpha = step(nodes, springs, alpha, dragging);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width / 2 + panX, rect.height / 2 + panY);
    ctx.scale(scale, scale);

    for (const s of springs) {
      ctx.strokeStyle = s.explicit ? EDGE : EDGE_FAINT;
      ctx.lineWidth = (s.explicit ? 1.3 : 0.9) / scale;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      ctx.fillStyle = colorOf(n.group);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (n.focus || n === hovered) {
        ctx.strokeStyle = FOCUS_RING;
        ctx.lineWidth = (n.focus ? 2.5 : 1.5) / scale;
        ctx.stroke();
      }
    }
    ctx.restore();

    const view = { scale, panX, panY, width: rect.width, height: rect.height };
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    for (const l of placeLabels(nodes, view, measure, { hovered })) {
      ctx.font = `${l.emphasised || l.node.focus ? 600 : 400} ${l.size}px system-ui, sans-serif`;
      ctx.strokeStyle = HALO;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(l.node.label, l.x, l.y + l.size - 1);
      ctx.fillStyle = LABEL;
      ctx.fillText(l.node.label, l.x, l.y + l.size - 1);
    }
    requestAnimationFrame(draw);
  }

  const toWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - rect.width / 2 - panX) / scale,
      y: (ev.clientY - rect.top - rect.height / 2 - panY) / scale,
    };
  };
  const nodeAt = (p) => {
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
  };

  canvas.addEventListener("pointerdown", (ev) => {
    const n = nodeAt(toWorld(ev));
    pressPos = { x: ev.clientX, y: ev.clientY };
    if (n) {
      dragging = n;
      alpha = Math.max(alpha, 0.35);
    } else {
      panFrom = { x: ev.clientX - panX, y: ev.clientY - panY };
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
    if (n && moved !== null && moved < 4) location.href = pageHref(n.id);
  });
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = toWorld(ev);
    scale = Math.min(4, Math.max(0.1, scale * (ev.deltaY < 0 ? 1.12 : 0.89)));
    panX = ev.clientX - rect.left - rect.width / 2 - before.x * scale;
    panY = ev.clientY - rect.top - rect.height / 2 - before.y * scale;
  });

  return {
    show() {
      if (!resize()) return;
      if (running) return; // already drawing; do not restart or refit
      if (!fitted) {
        // Fit once. Refitting on every reopen would discard the pan and zoom
        // the reader had set.
        fitted = true;
        fit();
      }
      running = true;
      draw();
    },
  };
}

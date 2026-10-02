// The graph's layout core, kept free of DOM/canvas so its two guarantees can
// be TESTED rather than eyeballed in a screenshot:
//   1. no two node circles overlap once settled;
//   2. no placed label overlaps a node or another label.
// graph.mjs owns rendering and interaction and imports this; layout.test.ts
// asserts the guarantees directly.

/** Deterministic golden-angle spiral — same layout every load, no RNG. */
export function seedPositions(nodes) {
  nodes.forEach((n, i) => {
    const a = i * 2.399963;
    const r = 30 * Math.sqrt(i + 1);
    n.x = Math.cos(a) * r;
    n.y = Math.sin(a) * r;
    n.vx = 0;
    n.vy = 0;
    n.r = 5 + Math.sqrt(n.deg ?? 0) * 2.4;
  });
  return nodes;
}

export const PAD = 26;
export const REST_EXPLICIT = 120;
export const REST_MENTION = 190;

export function repulsionFor(count) {
  return 460 * Math.max(1, Math.sqrt(count / 40));
}

/** Floor for the inverse-square denominator — see the comment in step(). */
export const MIN_REPULSION_D2 = 400;

/**
 * One integration step. `pinned` (optional) is a node excluded from
 * position updates — the one being dragged.
 */
export function step(nodes, springs, alpha, pinned = null) {
  const repulsion = repulsionFor(nodes.length);

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        // Coincident nodes have no direction to separate along; nudge them
        // apart deterministically rather than dividing by zero.
        dx = (i - j) * 0.01;
        dy = 0.01;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      // Inverse-square repulsion evaluated at a near-zero separation returns
      // an astronomically large force and flings the layout off screen — a
      // node dropped exactly onto another measured peak |pos| ~1e5, and 0.1
      // units apart ~1e6. Clamp the denominator: past MIN_D2 the constraint
      // pass is what does the separating anyway.
      const f = (repulsion * (a.r + b.r)) / Math.max(d2, MIN_REPULSION_D2);
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
  }

  for (const s of springs) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const rest = s.explicit ? REST_EXPLICIT : REST_MENTION;
    const k = s.explicit ? 0.035 : 0.006;
    const f = k * (d - rest);
    s.a.vx += (dx / d) * f;
    s.a.vy += (dy / d) * f;
    s.b.vx -= (dx / d) * f;
    s.b.vy -= (dy / d) * f;
  }

  for (const n of nodes) {
    n.vx -= n.x * 0.006; // weak gravity keeps the graph on screen
    n.vy -= n.y * 0.006;
    if (n !== pinned) {
      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
    }
    n.vx *= 0.78;
    n.vy *= 0.78;
  }

  separate(nodes, pinned);
  return Math.max(0.02, alpha * 0.992);
}

/**
 * Hard non-overlap CONSTRAINT (not a force): no two circles may end a step
 * closer than rA + rB + PAD. Forces make overlap unlikely; this makes it
 * impossible in every state this graph reaches — at rest AND mid-animation.
 * `passes` is a CAP, not a guarantee: the loop stops as soon as a pass finds
 * nothing to move, so a settled layout costs one scan per frame while a
 * perturbed one gets as many passes as it needs. Two fixed passes were NOT
 * enough during animation (measured). A pathological input (dozens of nodes
 * exactly coincident) can still exhaust the cap — production never produces
 * one, since seeded positions are distinct and the constraint runs every
 * frame, but the honest statement is "converges in practice", not "cannot
 * fail".
 */
export function separate(nodes, pinned = null, passes = 40) {
  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r + PAD;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        // Exactly coincident nodes have no separation axis. Pushing them all
        // along +x would resolve a pile into a COLLINEAR pile that still
        // overlaps; give each pair its own deterministic angle instead.
        let ux;
        let uy;
        if (d2 === 0) {
          const angle = (i * 2.399963 + j) % (Math.PI * 2);
          ux = Math.cos(angle);
          uy = Math.sin(angle);
        } else {
          ux = dx / d;
          uy = dy / d;
        }
        // A pinned node does not yield; its partner simply keeps being
        // pushed on later passes until the pair clears.
        if (a !== pinned) {
          a.x -= ux * push;
          a.y -= uy * push;
        }
        if (b !== pinned) {
          b.x += ux * push;
          b.y += uy * push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return nodes;
}

/** Settle a fresh layout before first paint, so the page opens readable. */
export function prewarm(nodes, springs, ticks = 400) {
  let alpha = 1;
  // No trailing separate() — step() ends with one, so another is dead code
  // (verified: removing it changes no position).
  for (let i = 0; i < ticks; i += 1) alpha = step(nodes, springs, alpha);
  return alpha;
}

export function overlappingPairs(nodes, tolerance = 0.5) {
  const bad = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d + tolerance < a.r + b.r) bad.push([a.id, b.id, d]);
    }
  }
  return bad;
}

const intersects = (p, q) =>
  p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

/**
 * Greedy label placement. `occupied` starts as the node circles' bounding
 * boxes, so a label can never be drawn over a node; each accepted label then
 * joins the list, so labels cannot overlap each other either. Four candidate
 * positions per node (right, left, above, below); a label with no free spot
 * is dropped rather than stacked.
 */
export function placeLabels(nodes, view, measure, opts = {}) {
  const { scale, panX, panY, width, height } = view;
  const focus = opts.focus ?? null;
  const hovered = opts.hovered ?? null;

  const toScreen = (n) => ({
    x: width / 2 + panX + n.x * scale,
    y: height / 2 + panY + n.y * scale,
  });

  const occupied = nodes.map((n) => {
    const s = toScreen(n);
    const r = n.r * scale;
    return { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 };
  });

  const order = [...nodes].sort((a, b) => {
    const pa = a === hovered ? 2 : focus && focus.has(a) ? 1 : 0;
    const pb = b === hovered ? 2 : focus && focus.has(b) ? 1 : 0;
    return pb - pa || (b.deg ?? 0) - (a.deg ?? 0);
  });

  const placed = [];
  for (const n of order) {
    if (focus && !focus.has(n)) continue;
    const emphasised = n === hovered;
    const size = emphasised ? 13 : 11;
    const w = measure(n.label, size, emphasised);
    const h = size + 2;
    const s = toScreen(n);
    const gap = n.r * scale + 5;
    const spots = [
      [s.x + gap, s.y - h / 2],
      [s.x - gap - w, s.y - h / 2],
      [s.x - w / 2, s.y - gap - h],
      [s.x - w / 2, s.y + gap],
    ];
    const spot = spots.find(([x, y]) => {
      if (x < 0 || y < 0 || x + w > width || y + h > height) return false;
      const box = { x, y, w, h };
      return !occupied.some((o) => intersects(box, o));
    });
    if (spot === undefined) continue;
    const box = { x: spot[0], y: spot[1], w, h };
    occupied.push(box);
    placed.push({ node: n, size, emphasised, ...box });
  }
  return placed;
}

/** Bounding box of all nodes, for fit-to-view. */
export function bounds(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  return { minX, minY, maxX, maxY };
}

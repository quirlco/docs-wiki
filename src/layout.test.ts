// The graph promises two things the design promises: nodes must not
// overlap, and the picture must stay readable. Screenshots can show that on
// one run; these assert it as a property, on a wiki-shaped graph and on
// adversarial inputs (every node stacked on one point).

import { describe, expect, it } from "vitest";

import {
  bounds,
  overlappingPairs,
  placeLabels,
  prewarm,
  seedPositions,
  separate,
  step,
} from "./public/layout.mjs";
import type { LayoutNode as Node } from "./public/layout.mjs";

const itReal = it;

/** A deterministic wiki-shaped graph: a hub, a ring of notes, and a few
 *  cross links — the same node/spring shape the /api/graph.json route serves. */
function realGraph(): {
  nodes: Node[];
  springs: { a: Node; b: Node; explicit: boolean }[];
} {
  const count = 40;
  const links: [number, number, boolean][] = [];
  for (let i = 1; i < count; i += 1) links.push([0, i, true]); // hub links all
  for (let i = 1; i < count; i += 1)
    links.push([i, (i % (count - 1)) + 1, i % 3 !== 0]); // ring
  for (let i = 1; i < count; i += 5) links.push([i, (i * 7) % count, false]);
  const deg = new Array<number>(count).fill(0);
  for (const [a, b] of links) {
    if (a === b) continue;
    deg[a] += 1;
    deg[b] += 1;
  }
  const nodes: Node[] = deg.map((d, i) => ({
    id: `docs/page-${i}.md`,
    label: `page-${i}.md`,
    deg: d,
    x: 0,
    y: 0,
    r: 0,
  }));
  seedPositions(nodes);
  const springs = links
    .filter(([a, b]) => a !== b)
    .map(([a, b, explicit]) => ({ a: nodes[a], b: nodes[b], explicit }));
  return { nodes, springs };
}

describe("no node overlap", () => {
  itReal("holds on a wiki-shaped graph after the pre-warm the page ships", () => {
    const { nodes, springs } = realGraph();
    // A floor, not a measurement: enough nodes that separation is a real
    // constraint. The graph has 40 nodes.
    expect(nodes.length).toBeGreaterThan(25);
    prewarm(nodes, springs);
    expect(overlappingPairs(nodes)).toEqual([]);
  });

  itReal("holds after EVERY animation step, not just at rest", () => {
    // The page keeps stepping while it settles and during a drag. prewarm()
    // ends with its own separate() pass, so asserting only on the settled
    // layout cannot see the constraint being dropped from step() — which is
    // exactly the mutation that survived the first version of this suite.
    const { nodes, springs } = realGraph();
    let alpha = 1;
    for (let frame = 0; frame < 60; frame += 1) {
      alpha = step(nodes, springs, alpha);
      expect(overlappingPairs(nodes), `frame ${frame}`).toEqual([]);
    }
  });

  itReal("pushes neighbours out of the way of a node dragged into a crowd", () => {
    const { nodes, springs } = realGraph();
    prewarm(nodes, springs);
    const dragged = nodes[0];
    const target = nodes[Math.floor(nodes.length / 2)];
    dragged.x = target.x; // drop it right on top of another node
    dragged.y = target.y;
    const held = { x: dragged.x, y: dragged.y };
    const before = bounds(nodes);
    const spread = Math.max(
      before.maxX - before.minX,
      before.maxY - before.minY,
    );
    let alpha = 0.4;
    for (let frame = 0; frame < 30; frame += 1) {
      alpha = step(nodes, springs, alpha, dragged);
      // Inverse-square repulsion at near-zero separation returns an
      // astronomical force; without a floor on the denominator this measured
      // peak |pos| ~1e5 and blew the layout off screen. Bound it every frame.
      for (const n of nodes) {
        expect(Math.abs(n.x), `${n.id} x, frame ${frame}`).toBeLessThan(
          spread * 4,
        );
        expect(Math.abs(n.y), `${n.id} y, frame ${frame}`).toBeLessThan(
          spread * 4,
        );
      }
    }
    // The dragged node stays exactly where the cursor put it…
    expect(dragged.x).toBe(held.x);
    expect(dragged.y).toBe(held.y);
    // …and everything else has made room for it.
    expect(overlappingPairs(nodes)).toEqual([]);
  });

  it("separates nodes that start stacked on a single point", () => {
    const nodes: Node[] = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      label: `n${i}`,
      deg: 3,
      x: 0,
      y: 0,
      r: 10,
    }));
    separate(nodes, null, 40);
    expect(overlappingPairs(nodes)).toEqual([]);
  });

  it("keeps a dragged node pinned while separating the rest", () => {
    const nodes: Node[] = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      label: `n${i}`,
      deg: 1,
      x: i * 0.5,
      y: 0,
      r: 12,
    }));
    const pinned = nodes[0];
    const at = { x: pinned.x, y: pinned.y };
    separate(nodes, pinned, 30);
    expect(pinned.x).toBe(at.x);
    expect(pinned.y).toBe(at.y);
    expect(overlappingPairs(nodes)).toEqual([]);
  });

  itReal("produces a finite, bounded layout (no NaN escape)", () => {
    const { nodes, springs } = realGraph();
    prewarm(nodes, springs);
    for (const n of nodes) {
      expect(Number.isFinite(n.x), n.id).toBe(true);
      expect(Number.isFinite(n.y), n.id).toBe(true);
    }
    const b = bounds(nodes);
    expect(b.maxX - b.minX).toBeLessThan(20000);
  });
});

describe("label placement", () => {
  const view = { scale: 1, panX: 0, panY: 0, width: 1400, height: 900 };
  // Deterministic stand-in for canvas text metrics.
  const measure = (text: string, size: number): number =>
    text.length * size * 0.55;

  const overlaps = (
    p: { x: number; y: number; w: number; h: number },
    q: { x: number; y: number; w: number; h: number },
  ): boolean =>
    p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

  itReal("never places a label over a node or another label", () => {
    const { nodes, springs } = realGraph();
    prewarm(nodes, springs);
    const placed = placeLabels(nodes, view, measure, {}) as {
      node: Node;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    expect(placed.length).toBeGreaterThan(10);

    const nodeBoxes = nodes.map((n) => ({
      x: view.width / 2 + n.x - n.r,
      y: view.height / 2 + n.y - n.r,
      w: n.r * 2,
      h: n.r * 2,
    }));
    for (const l of placed) {
      for (const box of nodeBoxes) {
        expect(overlaps(l, box), `label ${l.node.id} covers a node`).toBe(
          false,
        );
      }
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(
          overlaps(placed[i], placed[j]),
          `${placed[i].node.id} overlaps ${placed[j].node.id}`,
        ).toBe(false);
      }
    }
  });

  itReal("keeps every label inside the viewport", () => {
    const { nodes, springs } = realGraph();
    prewarm(nodes, springs);
    const placed = placeLabels(nodes, view, measure, {}) as {
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    for (const l of placed) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.x + l.w).toBeLessThanOrEqual(view.width);
      expect(l.y + l.h).toBeLessThanOrEqual(view.height);
    }
  });

  itReal("labels only the focused neighbourhood when one is hovered", () => {
    const { nodes, springs } = realGraph();
    prewarm(nodes, springs);
    const focus = new Set(nodes.slice(0, 3));
    const placed = placeLabels(nodes, view, measure, {
      focus,
      hovered: nodes[0],
    }) as { node: Node }[];
    expect(placed.length).toBeLessThanOrEqual(3);
    for (const l of placed) expect(focus.has(l.node)).toBe(true);
  });
});

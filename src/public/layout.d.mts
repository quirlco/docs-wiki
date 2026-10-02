// Types for the browser layout core (layout.mjs). Hand-written rather than
// generated: the module ships to the browser as plain ESM with no build step,
// and layout.test.ts consumes it from Node — both want real types, not `any`.

export interface LayoutNode {
  id: string;
  label: string;
  deg: number;
  x: number;
  y: number;
  r: number;
  vx?: number;
  vy?: number;
}

export interface Spring<N = LayoutNode> {
  a: N;
  b: N;
  explicit: boolean;
}

export interface View {
  scale: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}

export interface PlacedLabel<N = LayoutNode> {
  node: N;
  size: number;
  emphasised: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PAD: number;
export const REST_EXPLICIT: number;
export const REST_MENTION: number;

export function seedPositions<N extends Partial<LayoutNode>>(nodes: N[]): N[];
export function repulsionFor(count: number): number;
export function step<N extends LayoutNode>(
  nodes: N[],
  springs: Spring<N>[],
  alpha: number,
  pinned?: N | null,
): number;
export function separate<N extends LayoutNode>(
  nodes: N[],
  pinned?: N | null,
  passes?: number,
): N[];
export function prewarm<N extends LayoutNode>(
  nodes: N[],
  springs: Spring<N>[],
  ticks?: number,
): number;
export function overlappingPairs<N extends LayoutNode>(
  nodes: N[],
  tolerance?: number,
): [string, string, number][];
export function placeLabels<N extends LayoutNode>(
  nodes: N[],
  view: View,
  measure: (text: string, size: number, bold: boolean) => number,
  opts?: { focus?: Set<N> | null; hovered?: N | null },
): PlacedLabel<N>[];
export function bounds<N extends LayoutNode>(
  nodes: N[],
): { minX: number; minY: number; maxX: number; maxY: number };

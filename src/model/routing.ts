import type { Side } from './graph';
import { sideNormal, type Point } from './shapes';

/** Edge routing: pure functions from anchors to polylines and SVG paths. No DOM here. */

/** Where an edge meets a node: the point on the outline and the side it belongs to. */
export interface Anchor extends Point {
  side: Side;
}

function isVertical(side: Side): boolean {
  return side === 'top' || side === 'bottom';
}

/** Sides to use when the edge does not fix them: the two faces that look at each other along the dominant axis. */
export function autoSides(from: Point, to: Point): { sourceSide: Side; targetSide: Side } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? { sourceSide: 'right', targetSide: 'left' } : { sourceSide: 'left', targetSide: 'right' };
  }
  return dy >= 0 ? { sourceSide: 'bottom', targetSide: 'top' } : { sourceSide: 'top', targetSide: 'bottom' };
}

/** Drops repeated points and points lying on the axis-aligned line through their neighbours. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    const collinear = last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y));
    if (collinear) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * Axis-aligned route between two anchors: a short stub perpendicular to each
 * side, joined by one elbow when the sides have different orientations and by
 * two when they have the same one. Opposite sides that face each other meet
 * halfway; otherwise the route goes round the outermost stub.
 */
export function orthogonalRoute(from: Anchor, to: Anchor, stub = 20): Point[] {
  const nf = sideNormal(from.side);
  const nt = sideNormal(to.side);
  const p1 = { x: from.x + nf.x * stub, y: from.y + nf.y * stub };
  const p2 = { x: to.x + nt.x * stub, y: to.y + nt.y * stub };
  const middle: Point[] = [];
  if (isVertical(from.side) && isVertical(to.side)) {
    const facing = from.side !== to.side && (p2.y - p1.y) * nf.y >= 0;
    const y = facing ? (p1.y + p2.y) / 2 : nf.y > 0 ? Math.max(p1.y, p2.y) : Math.min(p1.y, p2.y);
    middle.push({ x: p1.x, y }, { x: p2.x, y });
  } else if (!isVertical(from.side) && !isVertical(to.side)) {
    const facing = from.side !== to.side && (p2.x - p1.x) * nf.x >= 0;
    const x = facing ? (p1.x + p2.x) / 2 : nf.x > 0 ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x);
    middle.push({ x, y: p1.y }, { x, y: p2.y });
  } else if (isVertical(from.side)) {
    middle.push({ x: p1.x, y: p2.y });
  } else {
    middle.push({ x: p2.x, y: p1.y });
  }
  return simplify([from, p1, ...middle, p2, to]);
}

/** SVG path through the points, with each corner rounded by `radius` where the segments are long enough. */
export function roundedPath(points: Point[], radius = 8): string {
  if (points.length === 0) return '';
  const first = points[0];
  const parts = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) {
      parts.push(`L ${corner.x} ${corner.y}`);
      continue;
    }
    const a = { x: corner.x - ((corner.x - prev.x) / inLength) * r, y: corner.y - ((corner.y - prev.y) / inLength) * r };
    const b = { x: corner.x + ((next.x - corner.x) / outLength) * r, y: corner.y + ((next.y - corner.y) / outLength) * r };
    parts.push(`L ${a.x} ${a.y}`, `Q ${corner.x} ${corner.y} ${b.x} ${b.y}`);
  }
  if (points.length > 1) {
    const last = points[points.length - 1];
    parts.push(`L ${last.x} ${last.y}`);
  }
  return parts.join(' ');
}

/** Midpoint of the longest segment, pushed a little to its side so the text does not sit on the line. */
export function labelAnchor(points: Point[], offset = 12): Point {
  let best = 0;
  let bestLength = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    if (length > bestLength) {
      bestLength = length;
      best = i;
    }
  }
  const a = points[best] ?? { x: 0, y: 0 };
  const b = points[best + 1] ?? a;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  return { x: (a.x + b.x) / 2 - uy * offset, y: (a.y + b.y) / 2 + ux * offset };
}

/** Offset of the i-th of `count` edges sharing a side, so they fan out instead of overlapping. */
export function spread(index: number, count: number, gap = 14): number {
  return (index - (count - 1) / 2) * gap;
}

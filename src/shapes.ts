import type { NodeType, Side } from './graph';

/** Pure geometry of the flowchart symbols. No DOM here: the editor turns these into SVG. */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const HEIGHT = 40;
const DECISION_HEIGHT = 56;
const CORNER = 8;

/** Horizontal offset of the slanted sides of the input/output parallelogram. */
function ioSkew(height: number): number {
  return Math.round(height * 0.3);
}

/** Box needed by a node of the given type to fit a label of the given width, in canvas units. */
export function shapeSize(type: NodeType, textWidth: number): Size {
  const text = Math.ceil(textWidth);
  switch (type) {
    case 'terminal':
      return { width: Math.max(80, text + 40), height: HEIGHT };
    case 'decision':
      // A rhombus needs roughly 1.6 times the text width for the label to fit inside it.
      return { width: Math.max(96, Math.ceil(text * 1.6) + 24), height: DECISION_HEIGHT };
    case 'io':
      return { width: Math.max(88, text + 28 + 2 * ioSkew(HEIGHT)), height: HEIGHT };
    case 'process':
      return { width: Math.max(72, text + 28), height: HEIGHT };
  }
}

function roundedRectPath(size: Size, radius: number): string {
  const w = size.width / 2;
  const h = size.height / 2;
  const r = Math.min(radius, w, h);
  return [
    `M ${-w + r} ${-h}`,
    `H ${w - r}`,
    `A ${r} ${r} 0 0 1 ${w} ${-h + r}`,
    `V ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `H ${-w + r}`,
    `A ${r} ${r} 0 0 1 ${-w} ${h - r}`,
    `V ${-h + r}`,
    `A ${r} ${r} 0 0 1 ${-w + r} ${-h}`,
    'Z',
  ].join(' ');
}

/** SVG path data for the outline of a node of the given type, centred on the origin. */
export function shapePath(type: NodeType, size: Size): string {
  const w = size.width / 2;
  const h = size.height / 2;
  switch (type) {
    case 'terminal':
      return roundedRectPath(size, h);
    case 'decision':
      return `M 0 ${-h} L ${w} 0 L 0 ${h} L ${-w} 0 Z`;
    case 'io': {
      const skew = ioSkew(size.height);
      return `M ${-w + skew} ${-h} L ${w} ${-h} L ${w - skew} ${h} L ${-w} ${h} Z`;
    }
    case 'process':
      return roundedRectPath(size, Math.min(CORNER, size.height / 4));
  }
}

/** Distance from the centre of a rectangle to its border along the unit direction (ux, uy). */
function rectDistance(size: Size, ux: number, uy: number): number {
  const alongX = ux === 0 ? Infinity : size.width / 2 / Math.abs(ux);
  const alongY = uy === 0 ? Infinity : size.height / 2 / Math.abs(uy);
  return Math.min(alongX, alongY);
}

/** Distance from the centre of a pill (rectangle with semicircular ends) to its border. */
function pillDistance(size: Size, ux: number, uy: number): number {
  const r = size.height / 2;
  const s = Math.max(0, size.width / 2 - r); // half-length of the straight part
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  // The ray leaves through the flat top or bottom if it gets there before the straight part ends.
  if (ay > 0 && (r / ay) * ax <= s) return r / ay;
  // Otherwise it leaves through an end cap: a circle of radius r centred at (±s, 0).
  return s * ax + Math.sqrt(Math.max(0, r * r - s * s * ay * ay));
}

/** Distance from the centre of a rhombus with half-diagonals (a, b) to its border. */
function rhombusDistance(size: Size, ux: number, uy: number): number {
  const a = size.width / 2;
  const b = size.height / 2;
  return 1 / (Math.abs(ux) / a + Math.abs(uy) / b);
}

/** Outward unit vector of a side. */
export function sideNormal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'right':
      return { x: 1, y: 0 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
  }
}

/** Distance from the centre line to the outline on the given side, `offset` units along that side. */
function outlineExtent(type: NodeType, size: Size, side: Side, offset: number): number {
  const w = size.width / 2;
  const h = size.height / 2;
  const vertical = side === 'top' || side === 'bottom';
  const o = Math.abs(offset);
  switch (type) {
    case 'decision':
      return vertical ? h * (1 - o / w) : w * (1 - o / h);
    case 'terminal': {
      const r = h;
      const s = Math.max(0, w - r);
      if (vertical) return o <= s ? r : Math.sqrt(Math.max(0, r * r - (o - s) ** 2));
      return s + Math.sqrt(Math.max(0, r * r - o * o));
    }
    case 'io': {
      if (vertical) return h;
      // The right side runs from (w, -h) to (w - skew, h); the left one from (-w + skew, -h) to (-w, h).
      const t = (offset + h) / size.height; // 0 at the top, 1 at the bottom
      const skew = ioSkew(size.height);
      return side === 'right' ? w - skew * t : w - skew * (1 - t);
    }
    case 'process':
      return vertical ? h : w;
  }
}

/**
 * Point on the outline, relative to the centre, on the given side and `offset`
 * units along it (to the right for top/bottom, downwards for left/right).
 * The offset is clamped so the point stays on the shape.
 */
export function pointOnSide(type: NodeType, size: Size, side: Side, offset = 0): Point {
  const vertical = side === 'top' || side === 'bottom';
  const limit = Math.max(0, (vertical ? size.width : size.height) / 2 - 10);
  const o = clamp(offset, -limit, limit);
  const extent = outlineExtent(type, size, side, o);
  switch (side) {
    case 'top':
      return { x: o, y: -extent };
    case 'bottom':
      return { x: o, y: extent };
    case 'right':
      return { x: extent, y: o };
    case 'left':
      return { x: -extent, y: o };
  }
}

/**
 * Distance from the centre of a node to its outline along the unit direction (ux, uy).
 * Exact for every shape except the parallelogram, which is treated as its bounding box.
 */
export function boundaryDistance(type: NodeType, size: Size, ux: number, uy: number): number {
  switch (type) {
    case 'terminal':
      return pillDistance(size, ux, uy);
    case 'decision':
      return rhombusDistance(size, ux, uy);
    case 'io':
    case 'process':
      return rectDistance(size, ux, uy);
  }
}

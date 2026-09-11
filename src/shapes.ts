import type { NodeType } from './graph';

/** Pure geometry of the flowchart symbols. No DOM here: the editor turns these into SVG. */

export interface Size {
  width: number;
  height: number;
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

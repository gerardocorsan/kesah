import type { NodeType, Side } from './graph';

/** Pure geometry of the BPMN symbols. No DOM here: the view turns these into SVG. */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

const EVENT_DIAMETER = 36;
const TASK_MIN_WIDTH = 100;
const TASK_HEIGHT = 60;
const TASK_CORNER = 10;
const GATEWAY_SIZE = 50;
const ANNOTATION_HEIGHT = 40;
const DATA_OBJECT_SIZE: Size = { width: 36, height: 48 };
const LABEL_PADDING = 24;
const FOLD = 8;
const BRACKET_ARM = 12;
const MARKER_SIZE = 12;

/** Distance between the bottom of a shape and the centre line of a label drawn below it. */
export const LABEL_BELOW_GAP = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type Geometry = 'circle' | 'rect' | 'rhombus';

function geometryOf(type: NodeType): Geometry {
  switch (type) {
    case 'start-event':
    case 'intermediate-event':
    case 'end-event':
      return 'circle';
    case 'gateway':
      return 'rhombus';
    default:
      return 'rect';
  }
}

/** Whether the box of the shape widens to fit its label (otherwise the label is drawn below a fixed box). */
export function growsWithLabel(type: NodeType): boolean {
  return type === 'task' || type === 'subprocess' || type === 'annotation';
}

export type LabelPlacement = 'inside' | 'below';

export function labelPlacement(type: NodeType): LabelPlacement {
  return growsWithLabel(type) ? 'inside' : 'below';
}

/** Box of a node of the given type for a label of the given width, in canvas units. */
export function shapeSize(type: NodeType, textWidth: number): Size {
  const text = Math.ceil(textWidth);
  switch (type) {
    case 'start-event':
    case 'intermediate-event':
    case 'end-event':
      return { width: EVENT_DIAMETER, height: EVENT_DIAMETER };
    case 'task':
    case 'subprocess':
      return { width: Math.max(TASK_MIN_WIDTH, text + LABEL_PADDING), height: TASK_HEIGHT };
    case 'gateway':
      return { width: GATEWAY_SIZE, height: GATEWAY_SIZE };
    case 'annotation':
      return { width: Math.max(TASK_MIN_WIDTH, text + LABEL_PADDING), height: ANNOTATION_HEIGHT };
    case 'data-object':
      return { ...DATA_OBJECT_SIZE };
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

function circlePath(radius: number): string {
  return `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius} Z`;
}

/**
 * SVG path data for the outline of a node, centred on the origin. This is the
 * filled, clickable body; the annotation's visible bracket and other details
 * come from `decorations`.
 */
export function shapePath(type: NodeType, size: Size): string {
  const w = size.width / 2;
  const h = size.height / 2;
  switch (type) {
    case 'start-event':
    case 'intermediate-event':
    case 'end-event':
      return circlePath(h);
    case 'task':
    case 'subprocess':
      return roundedRectPath(size, Math.min(TASK_CORNER, h / 2));
    case 'gateway':
      return `M 0 ${-h} L ${w} 0 L 0 ${h} L ${-w} 0 Z`;
    case 'annotation':
      return `M ${-w} ${-h} H ${w} V ${h} H ${-w} Z`;
    case 'data-object':
      return `M ${-w} ${-h} H ${w - FOLD} L ${w} ${-h + FOLD} V ${h} H ${-w} Z`;
  }
}

export interface Decoration {
  /** What the stroke is for; the view styles each role differently. */
  role: 'inner' | 'disc' | 'marker' | 'bracket' | 'fold';
  d: string;
}

/** Extra strokes drawn over the outline: inner circle, terminate disc, sub-process marker, annotation bracket, folded corner. */
export function decorations(type: NodeType, variant: string, size: Size): Decoration[] {
  const w = size.width / 2;
  const h = size.height / 2;
  switch (type) {
    case 'intermediate-event':
      return [{ role: 'inner', d: circlePath(h - 3) }];
    case 'end-event':
      return variant === 'terminate' ? [{ role: 'disc', d: circlePath(h - 6) }] : [];
    case 'subprocess': {
      const top = h - MARKER_SIZE - 2;
      const half = MARKER_SIZE / 2;
      return [
        {
          role: 'marker',
          d: `M ${-half} ${top} H ${half} V ${top + MARKER_SIZE} H ${-half} Z M 0 ${top + 2} V ${top + MARKER_SIZE - 2} M ${-half + 2} ${top + half} H ${half - 2}`,
        },
      ];
    }
    case 'annotation':
      return [{ role: 'bracket', d: `M ${-w + BRACKET_ARM} ${-h} H ${-w} V ${h} H ${-w + BRACKET_ARM}` }];
    case 'data-object':
      return [{ role: 'fold', d: `M ${w - FOLD} ${-h} V ${-h + FOLD} H ${w}` }];
    default:
      return [];
  }
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
  switch (geometryOf(type)) {
    case 'rhombus':
      return vertical ? h * (1 - o / w) : w * (1 - o / h);
    case 'circle': {
      const r = Math.min(w, h);
      return Math.sqrt(Math.max(0, r * r - o * o));
    }
    case 'rect':
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

/** Distance from the centre of a rectangle to its border along the unit direction (ux, uy). */
function rectDistance(size: Size, ux: number, uy: number): number {
  const alongX = ux === 0 ? Infinity : size.width / 2 / Math.abs(ux);
  const alongY = uy === 0 ? Infinity : size.height / 2 / Math.abs(uy);
  return Math.min(alongX, alongY);
}

/** Distance from the centre of a rhombus with half-diagonals (a, b) to its border. */
function rhombusDistance(size: Size, ux: number, uy: number): number {
  const a = size.width / 2;
  const b = size.height / 2;
  return 1 / (Math.abs(ux) / a + Math.abs(uy) / b);
}

/**
 * Distance from the centre of a node to its outline along the unit direction (ux, uy).
 * Exact for circles and rhombi; the other symbols are treated as their bounding box.
 */
export function boundaryDistance(type: NodeType, size: Size, ux: number, uy: number): number {
  switch (geometryOf(type)) {
    case 'circle':
      return Math.min(size.width, size.height) / 2;
    case 'rhombus':
      return rhombusDistance(size, ux, uy);
    case 'rect':
      return rectDistance(size, ux, uy);
  }
}

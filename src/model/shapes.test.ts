import { describe, expect, it } from 'vitest';
import { NODE_TYPES, SIDES, type NodeType, type Side } from './graph';
import {
  LABEL_BELOW_GAP,
  boundaryDistance,
  decorations,
  growsWithLabel,
  labelPlacement,
  pointOnSide,
  shapePath,
  shapeSize,
  sideNormal,
  type Size,
} from './shapes';

/**
 * Expectations come from the agreed element table: events Ø36 with the label below, tasks and
 * sub-processes max(100, text+24)×60 with corner 10, gateways 50×50, annotations
 * max(100, text+24)×40 drawn as an open bracket, data objects 36×48 with a folded corner,
 * intermediate events with an inner circle, terminate end events with a filled disc,
 * sub-processes with a ⊞ marker at the bottom centre, labels below at 14 px.
 */

const SQRT_HALF = Math.SQRT1_2;
const EVENTS: NodeType[] = ['start-event', 'intermediate-event', 'end-event'];

function unit(angle: number): [number, number] {
  return [Math.cos(angle), Math.sin(angle)];
}

describe('shapeSize', () => {
  it('gives events, gateways and data objects a fixed box whatever the label', () => {
    for (const type of EVENTS) {
      expect(shapeSize(type, 0)).toEqual({ width: 36, height: 36 });
      expect(shapeSize(type, 300)).toEqual({ width: 36, height: 36 });
    }
    expect(shapeSize('gateway', 0)).toEqual({ width: 50, height: 50 });
    expect(shapeSize('gateway', 300)).toEqual({ width: 50, height: 50 });
    expect(shapeSize('data-object', 0)).toEqual({ width: 36, height: 48 });
    expect(shapeSize('data-object', 300)).toEqual({ width: 36, height: 48 });
  });

  it('widens tasks, sub-processes and annotations with the label, from a minimum of 100', () => {
    expect(shapeSize('task', 0)).toEqual({ width: 100, height: 60 });
    expect(shapeSize('task', 76)).toEqual({ width: 100, height: 60 });
    expect(shapeSize('task', 77)).toEqual({ width: 101, height: 60 });
    expect(shapeSize('task', 76.2)).toEqual({ width: 101, height: 60 });
    expect(shapeSize('task', 200)).toEqual({ width: 224, height: 60 });
    expect(shapeSize('subprocess', 200)).toEqual({ width: 224, height: 60 });
    expect(shapeSize('annotation', 0)).toEqual({ width: 100, height: 40 });
    expect(shapeSize('annotation', 200)).toEqual({ width: 224, height: 40 });
  });
});

describe('label placement', () => {
  it('keeps labels inside the shapes that grow with them and below the fixed ones', () => {
    for (const type of ['task', 'subprocess', 'annotation'] as const) {
      expect(growsWithLabel(type)).toBe(true);
      expect(labelPlacement(type)).toBe('inside');
    }
    for (const type of [...EVENTS, 'gateway', 'data-object'] as const) {
      expect(growsWithLabel(type)).toBe(false);
      expect(labelPlacement(type)).toBe('below');
    }
    expect(LABEL_BELOW_GAP).toBe(14);
  });
});

describe('shapePath', () => {
  it('draws a closed path starting with a move for every type', () => {
    for (const type of NODE_TYPES) {
      const d = shapePath(type, shapeSize(type, 0));
      expect(d.startsWith('M ')).toBe(true);
      expect(d.trim().endsWith('Z')).toBe(true);
    }
  });

  it('draws events as a circle of radius 18', () => {
    for (const type of EVENTS) {
      const d = shapePath(type, { width: 36, height: 36 });
      expect(d.startsWith('M 0 -18')).toBe(true);
      expect(d.match(/A 18 18 /g)).toHaveLength(2);
    }
  });

  it('draws tasks and sub-processes as rectangles with 10 px rounded corners', () => {
    for (const type of ['task', 'subprocess'] as const) {
      const d = shapePath(type, { width: 100, height: 60 });
      expect(d.match(/A 10 10 /g)).toHaveLength(4);
      expect(d).toContain('H 40');
      expect(d).toContain('V 20');
    }
  });

  it('draws the gateway as a rhombus through the four side midpoints', () => {
    expect(shapePath('gateway', { width: 50, height: 50 })).toBe('M 0 -25 L 25 0 L 0 25 L -25 0 Z');
  });

  it('draws the annotation body as a plain rectangle (the bracket is a decoration)', () => {
    expect(shapePath('annotation', { width: 100, height: 40 })).toBe('M -50 -20 H 50 V 20 H -50 Z');
  });

  it('draws the data object as a page with an 8 px folded top-right corner', () => {
    expect(shapePath('data-object', { width: 36, height: 48 })).toBe('M -18 -24 H 10 L 18 -16 V 24 H -18 Z');
  });
});

describe('decorations', () => {
  it('adds nothing to plain events, tasks, gateways', () => {
    expect(decorations('start-event', 'none', { width: 36, height: 36 })).toEqual([]);
    expect(decorations('start-event', 'message', { width: 36, height: 36 })).toEqual([]);
    expect(decorations('end-event', 'none', { width: 36, height: 36 })).toEqual([]);
    expect(decorations('task', 'user', { width: 100, height: 60 })).toEqual([]);
    expect(decorations('gateway', 'parallel', { width: 50, height: 50 })).toEqual([]);
  });

  it('gives intermediate events an inner circle 3 px inside the outline', () => {
    const [inner] = decorations('intermediate-event', 'none', { width: 36, height: 36 });
    expect(inner.role).toBe('inner');
    expect(inner.d).toMatch(/A 15 15 /);
  });

  it('gives terminate end events a filled disc 6 px inside the outline', () => {
    const [disc] = decorations('end-event', 'terminate', { width: 36, height: 36 });
    expect(disc.role).toBe('disc');
    expect(disc.d).toMatch(/A 12 12 /);
  });

  it('gives sub-processes a 12 px boxed plus at the bottom centre', () => {
    const [marker] = decorations('subprocess', 'none', { width: 100, height: 60 });
    expect(marker.role).toBe('marker');
    expect(marker.d).toBe('M -6 16 H 6 V 28 H -6 Z M 0 18 V 26 M -4 22 H 4');
  });

  it('gives annotations an open bracket on the left with 12 px arms', () => {
    const [bracket] = decorations('annotation', 'none', { width: 100, height: 40 });
    expect(bracket.role).toBe('bracket');
    expect(bracket.d).toBe('M -38 -20 H -50 V 20 H -38');
  });

  it('gives data objects the fold line of the corner', () => {
    const [fold] = decorations('data-object', 'none', { width: 36, height: 48 });
    expect(fold.role).toBe('fold');
    expect(fold.d).toBe('M 10 -24 V -16 H 18');
  });
});

describe('sideNormal', () => {
  it('points outwards from each side', () => {
    expect(sideNormal('top')).toEqual({ x: 0, y: -1 });
    expect(sideNormal('right')).toEqual({ x: 1, y: 0 });
    expect(sideNormal('bottom')).toEqual({ x: 0, y: 1 });
    expect(sideNormal('left')).toEqual({ x: -1, y: 0 });
  });
});

describe('boundaryDistance', () => {
  const task: Size = { width: 100, height: 60 };

  it('reaches the side midpoints of a task along the axes and its border on a diagonal', () => {
    expect(boundaryDistance('task', task, 1, 0)).toBe(50);
    expect(boundaryDistance('task', task, -1, 0)).toBe(50);
    expect(boundaryDistance('task', task, 0, 1)).toBe(30);
    expect(boundaryDistance('task', task, SQRT_HALF, SQRT_HALF)).toBeCloseTo(30 * Math.SQRT2, 6);
  });

  it('treats sub-processes, annotations and data objects as their bounding box', () => {
    expect(boundaryDistance('subprocess', task, 0, -1)).toBe(30);
    expect(boundaryDistance('annotation', { width: 100, height: 40 }, 1, 0)).toBe(50);
    expect(boundaryDistance('data-object', { width: 36, height: 48 }, 0, 1)).toBe(24);
    expect(boundaryDistance('data-object', { width: 36, height: 48 }, SQRT_HALF, SQRT_HALF)).toBeCloseTo(18 * Math.SQRT2, 6);
  });

  it('reaches the vertices of the gateway along the axes and its edges in between', () => {
    const size: Size = { width: 50, height: 50 };
    expect(boundaryDistance('gateway', size, 1, 0)).toBe(25);
    expect(boundaryDistance('gateway', size, 0, -1)).toBe(25);
    for (const angle of [0.3, 1, 2, 4, 5.5]) {
      const [ux, uy] = unit(angle);
      const t = boundaryDistance('gateway', size, ux, uy);
      expect(Math.abs(t * ux) / 25 + Math.abs(t * uy) / 25).toBeCloseTo(1, 9);
    }
  });

  it('is the radius in every direction for events', () => {
    for (const type of EVENTS) {
      for (const angle of [0, 0.7, 2.1, 3.9, 5]) {
        const [ux, uy] = unit(angle);
        expect(boundaryDistance(type, { width: 36, height: 36 }, ux, uy)).toBe(18);
      }
    }
  });
});

describe('pointOnSide', () => {
  const task: Size = { width: 100, height: 60 };

  it('returns the side midpoints of a task by default', () => {
    expect(pointOnSide('task', task, 'top')).toEqual({ x: 0, y: -30 });
    expect(pointOnSide('task', task, 'right')).toEqual({ x: 50, y: 0 });
    expect(pointOnSide('task', task, 'bottom')).toEqual({ x: 0, y: 30 });
    expect(pointOnSide('task', task, 'left')).toEqual({ x: -50, y: 0 });
  });

  it('slides along the side by the offset: rightwards on top/bottom, downwards on left/right', () => {
    expect(pointOnSide('task', task, 'top', 10)).toEqual({ x: 10, y: -30 });
    expect(pointOnSide('task', task, 'bottom', -10)).toEqual({ x: -10, y: 30 });
    expect(pointOnSide('task', task, 'right', 5)).toEqual({ x: 50, y: 5 });
    expect(pointOnSide('annotation', { width: 100, height: 40 }, 'left', -5)).toEqual({ x: -50, y: -5 });
  });

  it('follows the slanted edges of the gateway', () => {
    const size: Size = { width: 50, height: 50 };
    expect(pointOnSide('gateway', size, 'top')).toEqual({ x: 0, y: -25 });
    expect(pointOnSide('gateway', size, 'top', 10)).toEqual({ x: 10, y: -15 });
    expect(pointOnSide('gateway', size, 'right', 5)).toEqual({ x: 20, y: 5 });
  });

  it('follows the circle of an event', () => {
    const size: Size = { width: 36, height: 36 };
    expect(pointOnSide('end-event', size, 'right')).toEqual({ x: 18, y: 0 });
    expect(pointOnSide('start-event', size, 'bottom')).toEqual({ x: 0, y: 18 });
    const p = pointOnSide('start-event', size, 'top', 5);
    expect(p.x).toBe(5);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(18, 9);
    expect(p.y).toBeLessThan(0);
  });

  it('clamps offsets so the point stays on the shape', () => {
    for (const type of NODE_TYPES) {
      const size = shapeSize(type, 60);
      for (const side of SIDES) {
        const far = pointOnSide(type, size, side, 10_000);
        const near = pointOnSide(type, size, side, -10_000);
        expect(Math.abs(far.x)).toBeLessThanOrEqual(size.width / 2);
        expect(Math.abs(far.y)).toBeLessThanOrEqual(size.height / 2);
        expect(Math.abs(near.x)).toBeLessThanOrEqual(size.width / 2);
        expect(Math.abs(near.y)).toBeLessThanOrEqual(size.height / 2);
        expect(far).not.toEqual(near);
      }
    }
  });

  it('places every default handle on the outline given by boundaryDistance', () => {
    const cases: [NodeType, Side][] = NODE_TYPES.flatMap((type) => SIDES.map((side): [NodeType, Side] => [type, side]));
    for (const [type, side] of cases) {
      const size = shapeSize(type, 80);
      const p = pointOnSide(type, size, side);
      const n = sideNormal(side);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(boundaryDistance(type, size, n.x, n.y), 6);
    }
  });
});

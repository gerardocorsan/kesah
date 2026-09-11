import { describe, expect, it } from 'vitest';
import { NODE_TYPES, SIDES, type NodeType, type Side } from './graph';
import { boundaryDistance, pointOnSide, shapePath, shapeSize, sideNormal, type Size } from './shapes';

/**
 * Expectations come from the agreed sizing rules (process max(72, text+28)×40, terminal
 * max(80, text+40)×40, decision max(96, 1.6·text+24)×56, io max(88, text+52)×40 with a
 * 12 px skew, corner 8, pill corner = height/2) and from plain geometry of each outline.
 */

const SQRT_HALF = Math.SQRT1_2;

function unit(angle: number): [number, number] {
  return [Math.cos(angle), Math.sin(angle)];
}

describe('shapeSize', () => {
  it('gives each shape its minimum box for an empty label', () => {
    expect(shapeSize('process', 0)).toEqual({ width: 72, height: 40 });
    expect(shapeSize('terminal', 0)).toEqual({ width: 80, height: 40 });
    expect(shapeSize('decision', 0)).toEqual({ width: 96, height: 56 });
    expect(shapeSize('io', 0)).toEqual({ width: 88, height: 40 });
  });

  it('grows the width with the label and keeps the height', () => {
    expect(shapeSize('process', 100)).toEqual({ width: 128, height: 40 });
    expect(shapeSize('terminal', 100)).toEqual({ width: 140, height: 40 });
    expect(shapeSize('decision', 100)).toEqual({ width: 184, height: 56 });
    expect(shapeSize('io', 100)).toEqual({ width: 152, height: 40 });
  });

  it('keeps the minimum while the label still fits and rounds fractional widths up', () => {
    expect(shapeSize('process', 40)).toEqual({ width: 72, height: 40 });
    expect(shapeSize('process', 44)).toEqual({ width: 72, height: 40 });
    expect(shapeSize('process', 44.2)).toEqual({ width: 73, height: 40 });
    expect(shapeSize('decision', 45)).toEqual({ width: 96, height: 56 });
    expect(shapeSize('decision', 46)).toEqual({ width: 98, height: 56 });
  });
});

describe('shapePath', () => {
  it('draws a closed path starting with a move for every shape', () => {
    for (const type of NODE_TYPES) {
      const d = shapePath(type, shapeSize(type, 0));
      expect(d.startsWith('M ')).toBe(true);
      expect(d.trim().endsWith('Z')).toBe(true);
    }
  });

  it('draws the process as a rectangle with 8 px rounded corners', () => {
    const d = shapePath('process', { width: 72, height: 40 });
    expect(d.match(/A 8 8 /g)).toHaveLength(4);
    expect(d).toContain('H 28');
    expect(d).toContain('V 12');
  });

  it('draws the terminal as a pill whose corners use half the height', () => {
    const d = shapePath('terminal', { width: 80, height: 40 });
    expect(d.match(/A 20 20 /g)).toHaveLength(4);
    // Straight parts are only the top and bottom lines, from -20 to 20.
    expect(d).toContain('M -20 -20 H 20');
    expect(d).toContain('H -20');
  });

  it('draws the decision as a rhombus through the four side midpoints', () => {
    expect(shapePath('decision', { width: 96, height: 56 })).toBe('M 0 -28 L 48 0 L 0 28 L -48 0 Z');
  });

  it('draws the input/output as a parallelogram slanted by 12 px', () => {
    expect(shapePath('io', { width: 88, height: 40 })).toBe('M -32 -20 L 44 -20 L 32 20 L -44 20 Z');
  });

  it('scales the rounded corner down for tiny boxes such as icons', () => {
    const d = shapePath('process', { width: 28, height: 16 });
    expect(d).toMatch(/A 4 4 /);
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
  const rect: Size = { width: 100, height: 40 };

  it('reaches the side midpoints of a rectangle along the axes', () => {
    expect(boundaryDistance('process', rect, 1, 0)).toBe(50);
    expect(boundaryDistance('process', rect, -1, 0)).toBe(50);
    expect(boundaryDistance('process', rect, 0, 1)).toBe(20);
    expect(boundaryDistance('process', rect, 0, -1)).toBe(20);
  });

  it('hits the rectangle border on a diagonal (top/bottom edge first for a wide box)', () => {
    expect(boundaryDistance('process', rect, SQRT_HALF, SQRT_HALF)).toBeCloseTo(20 * Math.SQRT2, 6);
    expect(boundaryDistance('process', { width: 40, height: 100 }, SQRT_HALF, SQRT_HALF)).toBeCloseTo(20 * Math.SQRT2, 6);
  });

  it('treats the parallelogram as its bounding box', () => {
    expect(boundaryDistance('io', rect, 1, 0)).toBe(50);
    expect(boundaryDistance('io', rect, 0, 1)).toBe(20);
    expect(boundaryDistance('io', rect, SQRT_HALF, SQRT_HALF)).toBeCloseTo(20 * Math.SQRT2, 6);
  });

  it('reaches the vertices of the rhombus along the axes and its edges in between', () => {
    const size: Size = { width: 100, height: 60 };
    expect(boundaryDistance('decision', size, 1, 0)).toBe(50);
    expect(boundaryDistance('decision', size, 0, -1)).toBe(30);
    for (const angle of [0.3, 1, 2, 4, 5.5]) {
      const [ux, uy] = unit(angle);
      const t = boundaryDistance('decision', size, ux, uy);
      // The point lies on the rhombus |x|/a + |y|/b = 1.
      expect(Math.abs(t * ux) / 50 + Math.abs(t * uy) / 30).toBeCloseTo(1, 9);
    }
  });

  it('reaches the pill outline: flat part on the axes, end caps at shallow angles', () => {
    const size: Size = { width: 100, height: 40 };
    expect(boundaryDistance('terminal', size, 1, 0)).toBe(50);
    expect(boundaryDistance('terminal', size, 0, 1)).toBe(20);
    // Steep enough to leave through the flat top: same as a rectangle.
    expect(boundaryDistance('terminal', size, 0.6, -0.8)).toBeCloseTo(25, 6);
    // Shallow: leaves through the cap, a circle of radius 20 centred 30 from the middle.
    for (const angle of [0.1, 0.4, Math.PI - 0.2, Math.PI + 0.3]) {
      const [ux, uy] = unit(angle);
      const t = boundaryDistance('terminal', size, ux, uy);
      const x = t * ux;
      const y = t * uy;
      expect(Math.abs(x)).toBeGreaterThan(30);
      expect(Math.hypot(Math.abs(x) - 30, y)).toBeCloseTo(20, 6);
    }
  });

  it('degrades to a circle when the pill is as high as it is wide', () => {
    for (const angle of [0, 0.7, 2.1, 3.9]) {
      const [ux, uy] = unit(angle);
      expect(boundaryDistance('terminal', { width: 40, height: 40 }, ux, uy)).toBeCloseTo(20, 6);
    }
  });
});

describe('pointOnSide', () => {
  const rect: Size = { width: 100, height: 40 };

  it('returns the side midpoints of a rectangle by default', () => {
    expect(pointOnSide('process', rect, 'top')).toEqual({ x: 0, y: -20 });
    expect(pointOnSide('process', rect, 'right')).toEqual({ x: 50, y: 0 });
    expect(pointOnSide('process', rect, 'bottom')).toEqual({ x: 0, y: 20 });
    expect(pointOnSide('process', rect, 'left')).toEqual({ x: -50, y: 0 });
  });

  it('slides along the side by the offset: rightwards on top/bottom, downwards on left/right', () => {
    expect(pointOnSide('process', rect, 'top', 10)).toEqual({ x: 10, y: -20 });
    expect(pointOnSide('process', rect, 'bottom', -10)).toEqual({ x: -10, y: 20 });
    expect(pointOnSide('process', rect, 'right', 5)).toEqual({ x: 50, y: 5 });
    expect(pointOnSide('process', rect, 'left', -5)).toEqual({ x: -50, y: -5 });
  });

  it('follows the slanted edges of the rhombus', () => {
    const size: Size = { width: 100, height: 60 };
    expect(pointOnSide('decision', size, 'top')).toEqual({ x: 0, y: -30 });
    expect(pointOnSide('decision', size, 'top', 25)).toEqual({ x: 25, y: -15 });
    expect(pointOnSide('decision', size, 'right', 15)).toEqual({ x: 25, y: 15 });
  });

  it('follows the caps of the pill', () => {
    const size: Size = { width: 100, height: 40 };
    expect(pointOnSide('terminal', size, 'right')).toEqual({ x: 50, y: 0 });
    expect(pointOnSide('terminal', size, 'top', 20)).toEqual({ x: 20, y: -20 });
    const onCap = pointOnSide('terminal', size, 'top', 38);
    expect(onCap.x).toBe(38);
    expect(Math.hypot(onCap.x - 30, onCap.y)).toBeCloseTo(20, 6);
    const side = pointOnSide('terminal', size, 'right', 10);
    expect(Math.hypot(side.x - 30, side.y)).toBeCloseTo(20, 6);
  });

  it('follows the slanted left and right sides of the parallelogram', () => {
    const size: Size = { width: 88, height: 40 };
    expect(pointOnSide('io', size, 'right')).toEqual({ x: 38, y: 0 });
    expect(pointOnSide('io', size, 'left')).toEqual({ x: -38, y: 0 });
    // A quarter of the way up the right side (offset -10 on a 40 high box) the slant has moved 3 px.
    expect(pointOnSide('io', size, 'right', -10)).toEqual({ x: 41, y: -10 });
    expect(pointOnSide('io', size, 'left', 10)).toEqual({ x: -41, y: 10 });
    expect(pointOnSide('io', size, 'top', 5)).toEqual({ x: 5, y: -20 });
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

  it('places every default handle on the outline given by boundaryDistance (the parallelogram is exact here but boxed there)', () => {
    const exact: NodeType[] = ['process', 'terminal', 'decision'];
    const cases: [NodeType, Side][] = exact.flatMap((type) => SIDES.map((side): [NodeType, Side] => [type, side]));
    for (const [type, side] of cases) {
      const size = shapeSize(type, 80);
      const p = pointOnSide(type, size, side);
      const n = sideNormal(side);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(boundaryDistance(type, size, n.x, n.y), 6);
    }
  });
});

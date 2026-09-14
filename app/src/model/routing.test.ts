import { describe, expect, it } from 'vitest';
import type { Point } from './shapes';
import { autoSides, labelAnchor, orthogonalRoute, roundedPath, spread, type Anchor } from './routing';

/**
 * Expectations come from the agreed routing rules: 20 px stubs perpendicular to each side,
 * facing opposite sides meet halfway, equal sides go round the outermost stub, sides of
 * different orientation use one elbow, corners rounded by 8, labels on the longest segment,
 * fan-out gap of 14.
 */

function axisAligned(points: Point[]): boolean {
  return points.every((p, i) => i === 0 || p.x === points[i - 1].x || p.y === points[i - 1].y);
}

/** A route is defined by its coordinates; the endpoints may carry the anchor side, which is irrelevant here. */
function xy(points: Point[]): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

describe('autoSides', () => {
  it('uses the horizontal sides when the target is mostly to the right or left', () => {
    expect(autoSides({ x: 0, y: 0 }, { x: 100, y: 30 })).toEqual({ sourceSide: 'right', targetSide: 'left' });
    expect(autoSides({ x: 0, y: 0 }, { x: -100, y: -30 })).toEqual({ sourceSide: 'left', targetSide: 'right' });
  });

  it('uses the vertical sides when the target is mostly below or above', () => {
    expect(autoSides({ x: 0, y: 0 }, { x: 30, y: 100 })).toEqual({ sourceSide: 'bottom', targetSide: 'top' });
    expect(autoSides({ x: 0, y: 0 }, { x: -30, y: -100 })).toEqual({ sourceSide: 'top', targetSide: 'bottom' });
  });

  it('prefers the vertical sides on an exact diagonal and for coincident points', () => {
    expect(autoSides({ x: 0, y: 0 }, { x: 50, y: 50 })).toEqual({ sourceSide: 'bottom', targetSide: 'top' });
    expect(autoSides({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ sourceSide: 'bottom', targetSide: 'top' });
  });
});

describe('orthogonalRoute', () => {
  const anchor = (x: number, y: number, side: Anchor['side']): Anchor => ({ x, y, side });

  it('joins facing vertical sides with a horizontal segment halfway between the stubs', () => {
    expect(xy(orthogonalRoute(anchor(0, 0, 'bottom'), anchor(100, 100, 'top')))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ]);
  });

  it('joins facing horizontal sides with a vertical segment halfway between the stubs', () => {
    expect(xy(orthogonalRoute(anchor(0, 0, 'right'), anchor(100, 50, 'left')))).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('collapses to a straight line when the facing sides are aligned', () => {
    expect(xy(orthogonalRoute(anchor(0, 0, 'bottom'), anchor(0, 100, 'top')))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
  });

  it('goes round the outermost stub when both ends use the same side', () => {
    expect(xy(orthogonalRoute(anchor(0, 0, 'bottom'), anchor(100, 40, 'bottom')))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 40 },
    ]);
    expect(xy(orthogonalRoute(anchor(0, 0, 'left'), anchor(50, 100, 'left')))).toEqual([
      { x: 0, y: 0 },
      { x: -20, y: 0 },
      { x: -20, y: 100 },
      { x: 50, y: 100 },
    ]);
  });

  it('goes round the outermost stub when opposite sides do not face each other', () => {
    expect(xy(orthogonalRoute(anchor(0, 100, 'bottom'), anchor(100, 0, 'top')))).toEqual([
      { x: 0, y: 100 },
      { x: 0, y: 120 },
      { x: 100, y: 120 },
      { x: 100, y: 0 },
    ]);
  });

  it('uses a single elbow when the sides have different orientations', () => {
    expect(xy(orthogonalRoute(anchor(0, 0, 'bottom'), anchor(100, 100, 'left')))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(xy(orthogonalRoute(anchor(0, 0, 'right'), anchor(100, 100, 'top')))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it('honours a custom stub length', () => {
    expect(xy(orthogonalRoute(anchor(0, 0, 'bottom'), anchor(100, 40, 'bottom'), 5))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 45 },
      { x: 100, y: 45 },
      { x: 100, y: 40 },
    ]);
  });

  it('always starts and ends at the anchors with axis-aligned segments and no repeated points', () => {
    const sides: Anchor['side'][] = ['top', 'right', 'bottom', 'left'];
    for (const from of sides) {
      for (const to of sides) {
        // Coincident anchors would be a self-loop, which the editor does not support.
        for (const [tx, ty] of [
          [120, 80],
          [-90, 30],
          [15, -140],
          [0, 60],
        ]) {
          const route = xy(orthogonalRoute(anchor(0, 0, from), anchor(tx, ty, to)));
          expect(route[0]).toEqual({ x: 0, y: 0 });
          expect(route[route.length - 1]).toEqual({ x: tx, y: ty });
          expect(axisAligned(route)).toBe(true);
          const label = `${from} -> ${to} at (${tx}, ${ty}): ${JSON.stringify(route)}`;
          for (let i = 1; i < route.length; i++) expect(route[i], label).not.toEqual(route[i - 1]);
        }
      }
    }
  });
});

describe('roundedPath', () => {
  it('is empty without points and a single move for one point', () => {
    expect(roundedPath([])).toBe('');
    expect(roundedPath([{ x: 3, y: 4 }])).toBe('M 3 4');
  });

  it('draws one straight segment for two points', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe('M 0 0 L 100 0');
  });

  it('rounds each corner with a quadratic curve of the given radius', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(roundedPath(points)).toBe('M 0 0 L 92 0 Q 100 0 100 8 L 100 100');
    expect(roundedPath(points, 0)).toBe('M 0 0 L 100 0 L 100 100');
  });

  it('limits the radius to half of the shortest adjacent segment', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 100 },
      ]),
    ).toBe('M 0 0 L 5 0 Q 10 0 10 5 L 10 100');
  });

  it('rounds every corner of a longer route', () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ]);
    expect(d.match(/Q /g)).toHaveLength(2);
    expect(d.endsWith('L 100 100')).toBe(true);
  });
});

describe('labelAnchor', () => {
  it('sits beside the middle of the longest segment, not on the line', () => {
    const anchor = labelAnchor([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
    expect(anchor.x).toBe(50);
    expect(anchor.y).not.toBe(10);
    expect(Math.abs(anchor.y - 10)).toBeLessThan(20);
  });

  it('picks the vertical segment when it is the longest', () => {
    const anchor = labelAnchor([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 200 },
    ]);
    expect(anchor.y).toBe(100);
    expect(anchor.x).not.toBe(10);
  });

  it('returns finite coordinates for degenerate input', () => {
    for (const points of [[], [{ x: 5, y: 5 }]]) {
      const anchor = labelAnchor(points);
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
    }
  });
});

describe('spread', () => {
  it('centres a single edge and fans several out symmetrically with a 14 px gap', () => {
    expect(spread(0, 1)).toBe(0);
    expect(spread(0, 2)).toBe(-7);
    expect(spread(1, 2)).toBe(7);
    expect([spread(0, 3), spread(1, 3), spread(2, 3)]).toEqual([-14, 0, 14]);
  });

  it('honours a custom gap', () => {
    expect(spread(0, 2, 10)).toBe(-5);
    expect(spread(1, 2, 10)).toBe(5);
  });
});

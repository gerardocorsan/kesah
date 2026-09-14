import { describe, expect, it } from 'vitest';
import { Graph, type GraphNode } from './graph';
import { shapeSize, type Size } from './shapes';
import { anchorOf, freeSpot, layoutEdges, routeOf } from './layout';

/**
 * Expectations come from the agreed behaviour: automatic sides by dominant axis, fixed sides
 * kept, edges sharing a side fanned out (gap 14) in the order of their far ends, straight edges
 * trimmed at the outline, fixed sides starting at the handle, and new nodes placed without overlap.
 */

const defaultSize = (node: GraphNode): Size => shapeSize(node.type, 0);

/** A route is defined by its coordinates; the endpoints may carry the anchor side, which is irrelevant here. */
const xy = (points: { x: number; y: number }[]) => points.map((p) => ({ x: p.x, y: p.y }));

function line(graph: Graph, from: string, to: string, sides?: { sourceSide?: 'top' | 'right' | 'bottom' | 'left'; targetSide?: 'top' | 'right' | 'bottom' | 'left' }): string {
  const edge = graph.addEdge(from, to, '', sides);
  if (!edge) throw new Error('edge expected');
  return edge.id;
}

describe('layoutEdges', () => {
  it('chooses facing sides along the dominant axis when the edge fixes none', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(300, 20, 'B').id;
    const c = graph.addNode(10, 300, 'C').id;
    line(graph, a, b);
    line(graph, a, c);
    const [ab, ac] = layoutEdges(graph.nodeList, graph.edgeList);
    expect(ab).toMatchObject({ sourceSide: 'right', targetSide: 'left', sourceOffset: 0, targetOffset: 0 });
    expect(ac).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
  });

  it('keeps the sides the edge fixes, mixing them with automatic ones', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(300, 0, 'B').id;
    line(graph, a, b, { sourceSide: 'top' });
    const [layout] = layoutEdges(graph.nodeList, graph.edgeList);
    expect(layout.sourceSide).toBe('top');
    expect(layout.targetSide).toBe('left');
  });

  it('skips edges whose nodes are not in the list', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(300, 0, 'B').id;
    line(graph, a, b);
    expect(layoutEdges([graph.getNode(a) as GraphNode], graph.edgeList)).toEqual([]);
  });

  it('fans out edges leaving the same side, ordered by where they go', () => {
    const graph = new Graph();
    const top = graph.addNode(200, 0, 'Top').id;
    const left = graph.addNode(0, 300, 'Left').id;
    const right = graph.addNode(400, 300, 'Right').id;
    const toRight = line(graph, top, right, { sourceSide: 'bottom' });
    const toLeft = line(graph, top, left, { sourceSide: 'bottom' });
    const byId = new Map(layoutEdges(graph.nodeList, graph.edgeList).map((l) => [l.edge.id, l]));
    expect(byId.get(toLeft)?.sourceOffset).toBe(-7);
    expect(byId.get(toRight)?.sourceOffset).toBe(7);
    expect(byId.get(toLeft)?.targetOffset).toBe(0);
  });

  it('fans out edges arriving at the same side too, and spaces three of them by 14', () => {
    const graph = new Graph();
    const end = graph.addNode(200, 400, 'End').id;
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(200, 0, 'B').id;
    const c = graph.addNode(400, 0, 'C').id;
    const ea = line(graph, a, end, { targetSide: 'top' });
    const eb = line(graph, b, end, { targetSide: 'top' });
    const ec = line(graph, c, end, { targetSide: 'top' });
    const byId = new Map(layoutEdges(graph.nodeList, graph.edgeList).map((l) => [l.edge.id, l]));
    expect([byId.get(ea)?.targetOffset, byId.get(eb)?.targetOffset, byId.get(ec)?.targetOffset]).toEqual([-14, 0, 14]);
  });

  it('orders edges on a vertical side by the far end height', () => {
    const graph = new Graph();
    const hub = graph.addNode(0, 200, 'Hub').id;
    const upper = graph.addNode(300, 0, 'Upper').id;
    const lower = graph.addNode(300, 400, 'Lower').id;
    const toLower = line(graph, hub, lower, { sourceSide: 'right' });
    const toUpper = line(graph, hub, upper, { sourceSide: 'right' });
    const byId = new Map(layoutEdges(graph.nodeList, graph.edgeList).map((l) => [l.edge.id, l]));
    expect(byId.get(toUpper)?.sourceOffset).toBe(-7);
    expect(byId.get(toLower)?.sourceOffset).toBe(7);
  });
});

describe('anchorOf', () => {
  it('is the handle point moved one unit out of the outline', () => {
    const node: GraphNode = { id: 'n1', label: 'A', type: 'task', variant: 'none', x: 100, y: 50 };
    expect(anchorOf(node, 'top', 0, { width: 72, height: 40 })).toEqual({ x: 100, y: 29, side: 'top' });
    expect(anchorOf(node, 'right', 5, { width: 72, height: 40 })).toEqual({ x: 137, y: 55, side: 'right' });
  });
});

describe('routeOf', () => {
  it('draws a straight edge between the outlines when both sides are automatic', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(200, 0, 'B').id;
    line(graph, a, b);
    const [layout] = layoutEdges(graph.nodeList, graph.edgeList);
    expect(xy(routeOf(layout, 'straight', defaultSize))).toEqual([
      { x: 51, y: 0 },
      { x: 149, y: 0 },
    ]);
  });

  it('starts a straight edge at the handle when the source side is fixed', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(200, 0, 'B').id;
    line(graph, a, b, { sourceSide: 'top' });
    const [layout] = layoutEdges(graph.nodeList, graph.edgeList);
    const [start, end] = xy(routeOf(layout, 'straight', defaultSize));
    expect(start).toEqual({ x: 0, y: -31 });
    expect(end.x).toBeLessThan(200 - 50);
    expect(end.x).toBeGreaterThan(100);
  });

  it('shifts parallel straight edges sideways so they do not overlap', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(200, 0, 'B').id;
    line(graph, a, b);
    line(graph, a, b);
    const [first, second] = layoutEdges(graph.nodeList, graph.edgeList).map((l) => routeOf(l, 'straight', defaultSize));
    expect(first[0].y).toBe(-second[0].y);
    expect(Math.abs(first[0].y - second[0].y)).toBe(14);
    expect(first[1].y).toBe(first[0].y);
  });

  it('routes an orthogonal edge from handle to handle', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(200, 0, 'B').id;
    line(graph, a, b);
    const [layout] = layoutEdges(graph.nodeList, graph.edgeList);
    expect(xy(routeOf(layout, 'orthogonal', defaultSize))).toEqual([
      { x: 51, y: 0 },
      { x: 149, y: 0 },
    ]);
  });

  it('routes an orthogonal edge with an elbow between different orientations', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A').id;
    const b = graph.addNode(200, 200, 'B').id;
    line(graph, a, b, { sourceSide: 'bottom', targetSide: 'left' });
    const [layout] = layoutEdges(graph.nodeList, graph.edgeList);
    expect(xy(routeOf(layout, 'orthogonal', defaultSize))).toEqual([
      { x: 0, y: 31 },
      { x: 0, y: 200 },
      { x: 149, y: 200 },
    ]);
  });
});

describe('freeSpot', () => {
  it('returns the start when nothing is there', () => {
    expect(freeSpot([], { x: 10, y: 20 }, 'task')).toEqual({ x: 10, y: 20 });
  });

  it('moves away from an occupied start and never overlaps existing nodes', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', label: 'A', type: 'task', variant: 'none', x: 100, y: 100 },
      { id: 'n2', label: 'B', type: 'gateway', variant: 'exclusive', x: 140, y: 160 },
    ];
    for (const type of ['task', 'gateway', 'start-event', 'data-object'] as const) {
      const spot = freeSpot(nodes, { x: 100, y: 100 }, type);
      const { width, height } = shapeSize(type, 0);
      expect(spot).not.toEqual({ x: 100, y: 100 });
      for (const node of nodes) {
        const clear = Math.abs(node.x - spot.x) >= width || Math.abs(node.y - spot.y) >= height;
        expect(clear).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    const nodes: GraphNode[] = [{ id: 'n1', label: 'A', type: 'task', variant: 'none', x: 0, y: 0 }];
    expect(freeSpot(nodes, { x: 0, y: 0 }, 'data-object')).toEqual(freeSpot(nodes, { x: 0, y: 0 }, 'data-object'));
  });
});

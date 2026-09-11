import type { EdgeStyle, GraphEdge, GraphNode, NodeId, NodeType, Side } from './graph';
import { boundaryDistance, pointOnSide, shapeSize, sideNormal, type Point, type Size } from './shapes';
import { autoSides, orthogonalRoute, spread, type Anchor } from './routing';

/**
 * Edge layout and node placement: which side each edge uses at both ends, where
 * it sits when several edges share a side, and the points it passes through.
 * Pure functions; the view supplies the measured node sizes.
 */

export interface EdgeLayout {
  edge: GraphEdge;
  source: GraphNode;
  target: GraphNode;
  sourceSide: Side;
  targetSide: Side;
  sourceOffset: number;
  targetOffset: number;
}

export type SizeLookup = (node: GraphNode) => Size;

/** Resolves the side each edge uses at both ends and fans out the edges that share a side of a node. */
export function layoutEdges(nodes: GraphNode[], edges: GraphEdge[]): EdgeLayout[] {
  const byId = new Map<NodeId, GraphNode>(nodes.map((node) => [node.id, node]));
  const layouts: EdgeLayout[] = [];
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const auto = autoSides(source, target);
    layouts.push({
      edge,
      source,
      target,
      sourceSide: edge.sourceSide ?? auto.sourceSide,
      targetSide: edge.targetSide ?? auto.targetSide,
      sourceOffset: 0,
      targetOffset: 0,
    });
  }

  // Edges attached to the same side of the same node are ordered by where they go and spread apart.
  type End = { layout: EdgeLayout; end: 'source' | 'target' };
  const groups = new Map<string, End[]>();
  for (const layout of layouts) {
    for (const end of ['source', 'target'] as const) {
      const node = end === 'source' ? layout.source : layout.target;
      const side = end === 'source' ? layout.sourceSide : layout.targetSide;
      const key = `${node.id}:${side}`;
      const group = groups.get(key) ?? [];
      group.push({ layout, end });
      groups.set(key, group);
    }
  }
  const far = (item: End): GraphNode => (item.end === 'source' ? item.layout.target : item.layout.source);
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const vertical = key.endsWith(':top') || key.endsWith(':bottom');
    group.sort((a, b) => (vertical ? far(a).x - far(b).x : far(a).y - far(b).y));
    group.forEach((item, index) => {
      const offset = spread(index, group.length);
      if (item.end === 'source') item.layout.sourceOffset = offset;
      else item.layout.targetOffset = offset;
    });
  }
  return layouts;
}

/** Point where an edge meets the node outline, pushed one unit out so the arrowhead clears the stroke. */
export function anchorOf(node: GraphNode, side: Side, offset: number, size: Size): Anchor {
  const p = pointOnSide(node.type, size, side, offset);
  const n = sideNormal(side);
  return { x: node.x + p.x + n.x, y: node.y + p.y + n.y, side };
}

/** Points the edge passes through, from the source outline to the target outline. */
export function routeOf(layout: EdgeLayout, style: EdgeStyle, sizeOf: SizeLookup): Point[] {
  const { edge, source, target } = layout;
  if (style === 'orthogonal') {
    return orthogonalRoute(
      anchorOf(source, layout.sourceSide, layout.sourceOffset, sizeOf(source)),
      anchorOf(target, layout.targetSide, layout.targetOffset, sizeOf(target)),
    );
  }
  // Straight: a fixed side starts at its handle; an automatic one aims at the other end and is trimmed at the outline.
  let start: Point = edge.sourceSide ? anchorOf(source, layout.sourceSide, layout.sourceOffset, sizeOf(source)) : source;
  let end: Point = edge.targetSide ? anchorOf(target, layout.targetSide, layout.targetOffset, sizeOf(target)) : target;
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  if (!edge.sourceSide) {
    const gap = boundaryDistance(source.type, sizeOf(source), ux, uy) + 1;
    start = { x: source.x + ux * gap, y: source.y + uy * gap };
  }
  if (!edge.targetSide) {
    const gap = boundaryDistance(target.type, sizeOf(target), ux, uy) + 1;
    end = { x: target.x - ux * gap, y: target.y - uy * gap };
  }
  // Parallel straight edges with automatic sides are shifted sideways so they do not overlap.
  if (!edge.sourceSide && !edge.targetSide && layout.sourceOffset !== 0) {
    const shift = layout.sourceOffset;
    start = { x: start.x - uy * shift, y: start.y + ux * shift };
    end = { x: end.x - uy * shift, y: end.y + ux * shift };
  }
  return [start, end];
}

/** First spot at or near `start` where a node of the given type does not overlap an existing node. */
export function freeSpot(nodes: GraphNode[], start: Point, type: NodeType): Point {
  const size = shapeSize(type, 0);
  const spot = { ...start };
  for (let i = 0; i < 50; i++) {
    const taken = nodes.some(
      (node) => Math.abs(node.x - spot.x) < size.width + 8 && Math.abs(node.y - spot.y) < size.height + 8,
    );
    if (!taken) break;
    spot.x += size.width / 2;
    spot.y += size.height + 16;
  }
  return spot;
}

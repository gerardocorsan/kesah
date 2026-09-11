import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../../model/graph';
import { pointOnSide, shapePath } from '../../../model/shapes';
import { renderWithApp, seedPair } from '../../../test/render';
import { ArrowMarkers } from './ArrowMarkers';
import { EdgePath } from './EdgePath';
import { GridPattern } from './GridPattern';
import { NodeShape } from './NodeShape';

/**
 * The test environment measures text at 7 px per character, so a label of n characters
 * yields a box of max(minimum, 7n + padding) according to the agreed sizing rules.
 */

describe('GridPattern', () => {
  it('defines the dotted grid pattern that follows the camera transform', () => {
    const [transform, setTransform] = createSignal('translate(0 0) scale(1)');
    const { container } = render(() => (
      <svg>
        <defs>
          <GridPattern transform={transform()} />
        </defs>
      </svg>
    ));
    const pattern = container.querySelector('pattern#grid');
    expect(pattern).toHaveAttribute('patternUnits', 'userSpaceOnUse');
    expect(pattern).toHaveAttribute('patternTransform', 'translate(0 0) scale(1)');
    expect(pattern?.querySelector('circle.grid-dot')).not.toBeNull();
    setTransform('translate(10 20) scale(2)');
    expect(pattern).toHaveAttribute('patternTransform', 'translate(10 20) scale(2)');
  });
});

describe('ArrowMarkers', () => {
  it('defines a normal and a selected arrowhead oriented along the path', () => {
    const { container } = render(() => (
      <svg>
        <defs>
          <ArrowMarkers />
        </defs>
      </svg>
    ));
    const normal = container.querySelector('marker#arrow');
    const selected = container.querySelector('marker#arrow-selected');
    expect(normal).toHaveAttribute('orient', 'auto');
    expect(normal?.querySelector('path')).toHaveClass('arrow-head');
    expect(normal?.querySelector('path')).not.toHaveClass('selected');
    expect(selected?.querySelector('path')).toHaveClass('arrow-head', 'selected');
  });
});

describe('NodeShape', () => {
  function renderNode(prepare: (graph: import('../../../model/graph').Graph) => GraphNode) {
    let node!: GraphNode;
    const result = renderWithApp(
      () => (
        <svg>
          <NodeShape node={node} />
        </svg>
      ),
      (graph) => {
        node = prepare(graph);
      },
    );
    return { ...result, node, group: result.container.querySelector('g.node') as SVGGElement };
  }

  it('renders the node at its position with its type, label and outline sized to the label', () => {
    const { group, node, app } = renderNode((graph) => graph.addNode(120, 80, 'Process data'));
    expect(group).toHaveAttribute('data-id', node.id);
    expect(group).toHaveAttribute('data-type', 'process');
    expect(group).toHaveAttribute('transform', 'translate(120 80)');
    expect(group.querySelector('text')).toHaveTextContent('Process data');
    // 12 characters × 7 px = 84 px of text → 84 + 28 = 112 wide, 40 high.
    expect(app.sizeOf(node)).toEqual({ width: 112, height: 40 });
    expect(group.querySelector('path.shape')).toHaveAttribute('d', shapePath('process', { width: 112, height: 40 }));
  });

  it('keeps the minimum width for short labels', () => {
    const { node, app } = renderNode((graph) => graph.addNode(0, 0, 'A', 'decision'));
    expect(app.sizeOf(node)).toEqual({ width: 96, height: 56 });
  });

  it('places four side handles on the outline', () => {
    const { group } = renderNode((graph) => graph.addNode(0, 0, 'Process data'));
    const ports = [...group.querySelectorAll('circle.port')];
    expect(ports.map((p) => p.getAttribute('data-side'))).toEqual(['top', 'right', 'bottom', 'left']);
    const right = ports[1];
    const expected = pointOnSide('process', { width: 112, height: 40 }, 'right');
    expect(Number(right.getAttribute('cx'))).toBe(expected.x);
    expect(Number(right.getAttribute('cy'))).toBe(expected.y);
    expect(ports[0].getAttribute('cy')).toBe('-20');
  });

  it('follows moves, renames and shape changes', () => {
    const { group, node, app, graph } = renderNode((graph) => graph.addNode(0, 0, 'A'));
    graph.moveNode(node.id, 30, 40);
    expect(group).toHaveAttribute('transform', 'translate(30 40)');
    graph.setNodeLabel(node.id, 'A much longer name');
    expect(group.querySelector('text')).toHaveTextContent('A much longer name');
    expect(app.sizeOf(node).width).toBe(18 * 7 + 28);
    graph.setNodeType(node.id, 'terminal');
    expect(group).toHaveAttribute('data-type', 'terminal');
    expect(app.sizeOf(node)).toEqual({ width: 18 * 7 + 40, height: 40 });
    expect(group.querySelector('path.shape')?.getAttribute('d')).toContain('A ');
  });

  it('reflects the selection', () => {
    const { group, node, app } = renderNode((graph) => graph.addNode(0, 0, 'A'));
    expect(group).not.toHaveClass('selected');
    app.select({ kind: 'node', id: node.id });
    expect(group).toHaveClass('selected');
    app.select(null);
    expect(group).not.toHaveClass('selected');
  });
});

describe('EdgePath', () => {
  function renderEdge() {
    let ids!: { a: string; b: string; edge: string };
    let edge!: GraphEdge;
    const result = renderWithApp(
      () => (
        <svg>
          <EdgePath edge={edge} />
        </svg>
      ),
      (graph) => {
        ids = seedPair(graph);
        edge = graph.getEdge(ids.edge) as GraphEdge;
      },
    );
    return { ...result, ids, group: result.container.querySelector('g.edge') as SVGGElement };
  }

  it('draws a hit area and a visible line along the same path, with the label beside it', () => {
    const { group, ids } = renderEdge();
    expect(group).toHaveAttribute('data-id', ids.edge);
    const hit = group.querySelector('path.edge-hit');
    const line = group.querySelector('path.edge-line');
    expect(hit?.getAttribute('d')).toBe(line?.getAttribute('d'));
    expect(line?.getAttribute('d')).toMatch(/^M /);
    const label = group.querySelector('text.edge-label');
    expect(label).toHaveTextContent('Yes');
    const x = Number(label?.getAttribute('x'));
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(300);
  });

  it('shows an arrowhead only in directed graphs, highlighted when selected', () => {
    const { group, ids, app, graph } = renderEdge();
    const line = group.querySelector('path.edge-line');
    expect(line).toHaveAttribute('marker-end', 'url(#arrow)');
    app.select({ kind: 'edge', id: ids.edge });
    expect(group).toHaveClass('selected');
    expect(line).toHaveAttribute('marker-end', 'url(#arrow-selected)');
    graph.setDirected(false);
    expect(line).not.toHaveAttribute('marker-end');
  });

  it('re-routes when a node moves or the edge style changes', () => {
    const { group, ids, graph } = renderEdge();
    const line = group.querySelector('path.edge-line') as SVGPathElement;
    const before = line.getAttribute('d');
    graph.moveNode(ids.b, 300, 200);
    const moved = line.getAttribute('d');
    expect(moved).not.toBe(before);
    expect(moved).toContain('Q ');
    graph.setEdgeStyle('straight');
    expect(line.getAttribute('d')).not.toContain('Q ');
    expect(line.getAttribute('d')?.split('L')).toHaveLength(2);
  });

  it('updates its label text', () => {
    const { group, ids, graph } = renderEdge();
    graph.setEdgeLabel(ids.edge, 'No');
    expect(group.querySelector('text.edge-label')).toHaveTextContent('No');
  });
});

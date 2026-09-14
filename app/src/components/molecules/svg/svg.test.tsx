import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { Graph, GraphEdge, GraphNode, NodeType } from '../../../model/graph';
import { GLYPHS } from '../../../model/glyphs';
import { pointOnSide, shapePath } from '../../../model/shapes';
import { renderWithApp, seedPair } from '../../../test/render';
import { ArrowMarkers } from './ArrowMarkers';
import { EdgePath } from './EdgePath';
import { GridPattern } from './GridPattern';
import { NodeShape } from './NodeShape';

/**
 * The test environment measures text at 7 px per character, so a task with an n-character
 * label is max(100, 7n + 24) wide. Fixed symbols ignore the label and draw it 14 px below.
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
  it('defines every marker an edge can use, each with a selected twin, oriented along the path', () => {
    const { container } = render(() => (
      <svg>
        <defs>
          <ArrowMarkers />
        </defs>
      </svg>
    ));
    for (const id of ['arrow', 'arrow-open', 'flow-default', 'flow-conditional', 'message-start']) {
      const normal = container.querySelector(`marker#${id}`);
      const selected = container.querySelector(`marker#${id}-selected`);
      expect(normal).toHaveAttribute('orient', 'auto');
      expect(normal?.querySelector('path')).not.toHaveClass('selected');
      expect(selected?.querySelector('path')).toHaveClass('selected');
    }
    expect(container.querySelector('marker#arrow path')).toHaveClass('arrow-head');
    expect(container.querySelector('marker#arrow-open path')).toHaveClass('arrow-open');
    // The default-flow slash sits a little way along the first segment, not on the node border.
    expect(Number(container.querySelector('marker#flow-default')?.getAttribute('refX'))).toBeLessThan(0);
  });
});

describe('NodeShape', () => {
  function renderNode(prepare: (graph: Graph) => GraphNode) {
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
    const group = result.container.querySelector('g.node') as SVGGElement;
    return {
      ...result,
      node,
      group,
      text: group.querySelector('text') as SVGTextElement,
      glyph: () => group.querySelector('path.glyph'),
      decoration: (role: string) => group.querySelector(`path.decoration.${role}`),
    };
  }

  it('renders a task at its position, sized to its label, with the label inside', () => {
    const { group, node, app, text } = renderNode((graph) => graph.addNode(120, 80, 'Process data'));
    expect(group).toHaveAttribute('data-id', node.id);
    expect(group).toHaveAttribute('data-type', 'task');
    expect(group).toHaveAttribute('data-variant', 'none');
    expect(group).toHaveAttribute('transform', 'translate(120 80)');
    expect(text).toHaveTextContent('Process data');
    // 12 characters × 7 px = 84 px of text → 84 + 24 = 108 wide, 60 high.
    expect(app.sizeOf(node)).toEqual({ width: 108, height: 60 });
    expect(group.querySelector('path.shape')).toHaveAttribute('d', shapePath('task', { width: 108, height: 60 }));
    expect(text).toHaveAttribute('x', '0');
    expect(text).toHaveAttribute('y', '0');
    expect(text).not.toHaveClass('label-below');
    expect(group.querySelector('path.glyph')).toBeNull();
  });

  it('keeps events at their fixed size and draws the label below', () => {
    const { node, app, text, glyph } = renderNode((graph) => graph.addNode(0, 0, 'A rather long start label', 'start-event'));
    expect(app.sizeOf(node)).toEqual({ width: 36, height: 36 });
    expect(text).toHaveClass('label-below');
    expect(text).toHaveAttribute('y', '32');
    expect(glyph()).toBeNull();
  });

  it('shows the trigger glyph of an event centred in the circle', () => {
    const { glyph } = renderNode((graph) => graph.addNode(0, 0, 'Wait', 'intermediate-event', 'timer'));
    expect(glyph()).toHaveAttribute('d', GLYPHS.timer);
    expect(glyph()).toHaveAttribute('transform', 'translate(-8 -8) scale(1)');
  });

  it('draws the inner circle of intermediate events and the disc of terminate end events', () => {
    const intermediate = renderNode((graph) => graph.addNode(0, 0, 'I', 'intermediate-event'));
    expect(intermediate.decoration('inner')).not.toBeNull();
    const terminate = renderNode((graph) => graph.addNode(0, 0, 'T', 'end-event', 'terminate'));
    expect(terminate.decoration('disc')).not.toBeNull();
    expect(terminate.glyph()).toBeNull();
    const plainEnd = renderNode((graph) => graph.addNode(0, 0, 'E', 'end-event'));
    expect(plainEnd.decoration('disc')).toBeNull();
  });

  it('shows the gateway marker at one and a half times its size and follows a variant change', () => {
    const { glyph, node, graph } = renderNode((graph) => graph.addNode(0, 0, 'In stock?', 'gateway'));
    expect(glyph()).toHaveAttribute('d', GLYPHS.exclusive);
    expect(glyph()).toHaveAttribute('transform', 'translate(-12 -12) scale(1.5)');
    graph.setNodeVariant(node.id, 'parallel');
    expect(glyph()).toHaveAttribute('d', GLYPHS.parallel);
  });

  it('puts the task type glyph in the top-left corner', () => {
    const { glyph, group } = renderNode((graph) => graph.addNode(0, 0, 'Receive order', 'task', 'user'));
    // 13 characters → 91 + 24 = 115 wide: the corner is 6 px inside the left and top edges.
    expect(glyph()).toHaveAttribute('d', GLYPHS.user);
    expect(glyph()).toHaveAttribute('transform', 'translate(-51.5 -24) scale(1)');
    expect(group).toHaveAttribute('data-variant', 'user');
  });

  it('draws the sub-process marker, the annotation bracket with left-aligned text, and the data object fold', () => {
    const sub = renderNode((graph) => graph.addNode(0, 0, 'Details', 'subprocess'));
    expect(sub.decoration('marker')).not.toBeNull();
    const note = renderNode((graph) => graph.addNode(0, 0, 'Checked daily', 'annotation'));
    expect(note.decoration('bracket')).not.toBeNull();
    expect(note.text).toHaveClass('align-start');
    // 13 characters → 115 wide: the text starts 8 px inside the left edge.
    expect(note.text).toHaveAttribute('x', '-49.5');
    const data = renderNode((graph) => graph.addNode(0, 0, 'Order', 'data-object'));
    expect(data.decoration('fold')).not.toBeNull();
    expect(data.text).toHaveAttribute('y', '38');
  });

  it('places four side handles on the outline', () => {
    const { group } = renderNode((graph) => graph.addNode(0, 0, 'Process data'));
    const ports = [...group.querySelectorAll('circle.port')];
    expect(ports.map((p) => p.getAttribute('data-side'))).toEqual(['top', 'right', 'bottom', 'left']);
    const expected = pointOnSide('task', { width: 108, height: 60 }, 'right');
    expect(Number(ports[1].getAttribute('cx'))).toBe(expected.x);
    expect(Number(ports[1].getAttribute('cy'))).toBe(expected.y);
    expect(ports[0].getAttribute('cy')).toBe('-30');
  });

  it('follows moves, renames and type changes', () => {
    const { group, node, app, graph, text } = renderNode((graph) => graph.addNode(0, 0, 'A'));
    graph.moveNode(node.id, 30, 40);
    expect(group).toHaveAttribute('transform', 'translate(30 40)');
    graph.setNodeLabel(node.id, 'A much longer name');
    expect(text).toHaveTextContent('A much longer name');
    expect(app.sizeOf(node).width).toBe(18 * 7 + 24);
    graph.setNodeType(node.id, 'start-event');
    expect(group).toHaveAttribute('data-type', 'start-event');
    expect(app.sizeOf(node)).toEqual({ width: 36, height: 36 });
    expect(group.querySelector('path.shape')?.getAttribute('d')).toContain('A 18 18');
    expect(text).toHaveClass('label-below');
  });

  it('reflects the selection', () => {
    const { group, node, app } = renderNode((graph) => graph.addNode(0, 0, 'A'));
    expect(group).not.toHaveClass('selected');
    app.select({ kind: 'node', id: node.id });
    expect(group).toHaveClass('selected');
    app.select(null);
    expect(group).not.toHaveClass('selected');
  });

  it('renders every type without a glyph unless its variant has one', () => {
    const withGlyph: NodeType[] = [];
    for (const type of ['start-event', 'intermediate-event', 'end-event', 'task', 'subprocess', 'gateway', 'annotation', 'data-object'] as const) {
      const { glyph } = renderNode((graph) => graph.addNode(0, 0, 'X', type));
      if (glyph()) withGlyph.push(type);
    }
    expect(withGlyph).toEqual(['gateway']);
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
    const group = result.container.querySelector('g.edge') as SVGGElement;
    return { ...result, ids, group, line: group.querySelector('path.edge-line') as SVGPathElement };
  }

  it('draws a hit area and a visible line along the same path, with the label beside it', () => {
    const { group, ids, line } = renderEdge();
    expect(group).toHaveAttribute('data-id', ids.edge);
    expect(group.querySelector('path.edge-hit')?.getAttribute('d')).toBe(line.getAttribute('d'));
    expect(line.getAttribute('d')).toMatch(/^M /);
    const label = group.querySelector('text.edge-label');
    expect(label).toHaveTextContent('Yes');
    const x = Number(label?.getAttribute('x'));
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(300);
  });

  it('draws a sequence flow as a solid line with a filled arrowhead, highlighted when selected', () => {
    const { group, ids, app, line } = renderEdge();
    expect(group).toHaveClass('edge-sequence');
    expect(group).toHaveAttribute('data-kind', 'sequence');
    expect(line).toHaveAttribute('marker-end', 'url(#arrow)');
    expect(line).not.toHaveAttribute('marker-start');
    app.select({ kind: 'edge', id: ids.edge });
    expect(group).toHaveClass('selected');
    expect(line).toHaveAttribute('marker-end', 'url(#arrow-selected)');
  });

  it('marks default and conditional sequence flows at their source', () => {
    const { ids, graph, line } = renderEdge();
    graph.setEdgeCondition(ids.edge, 'default');
    expect(line).toHaveAttribute('marker-start', 'url(#flow-default)');
    graph.setEdgeCondition(ids.edge, 'conditional');
    expect(line).toHaveAttribute('marker-start', 'url(#flow-conditional)');
    graph.setEdgeCondition(ids.edge, 'none');
    expect(line).not.toHaveAttribute('marker-start');
  });

  it('draws a message flow dashed, with an open arrowhead and a dot at the source', () => {
    const { group, ids, graph, line, app } = renderEdge();
    graph.setEdgeKind(ids.edge, 'message');
    expect(group).toHaveClass('edge-message');
    expect(group).not.toHaveClass('edge-sequence');
    expect(line).toHaveAttribute('marker-end', 'url(#arrow-open)');
    expect(line).toHaveAttribute('marker-start', 'url(#message-start)');
    app.select({ kind: 'edge', id: ids.edge });
    expect(line).toHaveAttribute('marker-start', 'url(#message-start-selected)');
  });

  it('draws an association dotted with no arrowhead', () => {
    const { group, ids, graph, line } = renderEdge();
    graph.setEdgeKind(ids.edge, 'association');
    expect(group).toHaveClass('edge-association');
    expect(line).not.toHaveAttribute('marker-end');
    expect(line).not.toHaveAttribute('marker-start');
  });

  it('re-routes when a node moves or the edge style changes', () => {
    const { ids, graph, line } = renderEdge();
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

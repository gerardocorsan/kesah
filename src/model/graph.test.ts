import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_TYPE, Graph, isNodeType, isSide, NODE_TYPES, SIDES } from './graph';

/** Expectations come from the README (JSON format, defaults for old files) and the agreed behaviour. */

function twoNodes(): { graph: Graph; a: string; b: string } {
  const graph = new Graph();
  const a = graph.addNode(0, 0, 'A').id;
  const b = graph.addNode(100, 0, 'B').id;
  return { graph, a, b };
}

describe('Graph defaults', () => {
  it('starts empty, directed and with orthogonal edges', () => {
    const graph = new Graph();
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
    expect(graph.nodeList).toEqual([]);
    expect(graph.edgeList).toEqual([]);
    expect(graph.directed).toBe(true);
    expect(graph.edgeStyle).toBe('orthogonal');
  });

  it('exposes the four node types and the four sides with their guards', () => {
    expect(NODE_TYPES).toEqual(['terminal', 'process', 'decision', 'io']);
    expect(SIDES).toEqual(['top', 'right', 'bottom', 'left']);
    expect(DEFAULT_NODE_TYPE).toBe('process');
    expect(isNodeType('decision')).toBe(true);
    expect(isNodeType('circle')).toBe(false);
    expect(isNodeType(undefined)).toBe(false);
    expect(isSide('left')).toBe(true);
    expect(isSide('middle')).toBe(false);
    expect(isSide(3)).toBe(false);
  });
});

describe('nodes', () => {
  it('numbers ids n1, n2, … and uses the given label, type and position', () => {
    const graph = new Graph();
    const first = graph.addNode(10, 20, 'Start', 'terminal');
    const second = graph.addNode(30, 40, 'Check', 'decision');
    expect(first).toEqual({ id: 'n1', label: 'Start', type: 'terminal', x: 10, y: 20 });
    expect(second).toEqual({ id: 'n2', label: 'Check', type: 'decision', x: 30, y: 40 });
    expect(graph.nodeCount).toBe(2);
    expect(graph.getNode('n2')).toEqual(second);
  });

  it('defaults to a process node with a non-empty label that differs from the previous default', () => {
    const graph = new Graph();
    const first = graph.addNode(0, 0);
    const second = graph.addNode(1, 1);
    expect(first.type).toBe('process');
    expect(first.label).not.toBe('');
    expect(second.label).not.toBe(first.label);
  });

  it('moves, renames and retypes a node in place', () => {
    const graph = new Graph();
    const node = graph.addNode(0, 0, 'A');
    graph.moveNode(node.id, 50, 60);
    graph.setNodeLabel(node.id, 'Renamed');
    graph.setNodeType(node.id, 'io');
    expect(graph.getNode(node.id)).toEqual({ id: 'n1', label: 'Renamed', type: 'io', x: 50, y: 60 });
  });

  it('ignores updates to unknown ids', () => {
    const graph = new Graph();
    graph.addNode(0, 0, 'A');
    graph.moveNode('n9', 1, 1);
    graph.setNodeLabel('n9', 'x');
    graph.setNodeType('n9', 'io');
    graph.removeNode('n9');
    expect(graph.nodeList).toEqual([{ id: 'n1', label: 'A', type: 'process', x: 0, y: 0 }]);
  });

  it('removing a node also removes every edge touching it', () => {
    const { graph, a, b } = twoNodes();
    const c = graph.addNode(0, 100, 'C').id;
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(c, a);
    graph.removeNode(b);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeList.map((e) => [e.source, e.target])).toEqual([[c, a]]);
  });

  it('getNode returns undefined for unknown ids', () => {
    expect(new Graph().getNode('n1')).toBeUndefined();
  });
});

describe('edges', () => {
  it('numbers ids e1, e2, … and stores source, target and label', () => {
    const { graph, a, b } = twoNodes();
    const edge = graph.addEdge(a, b, 'Yes');
    expect(edge).toEqual({ id: 'e1', source: a, target: b, label: 'Yes' });
    expect(graph.getEdge('e1')).toEqual(edge);
    expect(graph.addEdge(b, a)?.id).toBe('e2');
  });

  it('records fixed sides only when given', () => {
    const { graph, a, b } = twoNodes();
    const fixed = graph.addEdge(a, b, '', { sourceSide: 'bottom', targetSide: 'top' });
    const partial = graph.addEdge(a, b, '', { sourceSide: 'left' });
    const auto = graph.addEdge(a, b);
    expect(fixed).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
    expect(partial).toMatchObject({ sourceSide: 'left' });
    expect(partial).not.toHaveProperty('targetSide');
    expect(auto).not.toHaveProperty('sourceSide');
    expect(auto).not.toHaveProperty('targetSide');
  });

  it('rejects self-loops and edges to missing nodes', () => {
    const { graph, a } = twoNodes();
    expect(graph.addEdge(a, a)).toBeNull();
    expect(graph.addEdge(a, 'n9')).toBeNull();
    expect(graph.addEdge('n9', a)).toBeNull();
    expect(graph.edgeCount).toBe(0);
  });

  it('allows several edges between the same two nodes', () => {
    const { graph, a, b } = twoNodes();
    graph.addEdge(a, b);
    graph.addEdge(a, b);
    graph.addEdge(b, a);
    expect(graph.edgeCount).toBe(3);
  });

  it('findEdge respects direction in directed graphs and ignores it in undirected ones', () => {
    const { graph, a, b } = twoNodes();
    const edge = graph.addEdge(a, b);
    expect(graph.findEdge(a, b)).toEqual(edge);
    expect(graph.findEdge(b, a)).toBeUndefined();
    graph.setDirected(false);
    expect(graph.findEdge(b, a)).toEqual(edge);
    expect(graph.findEdge(a, 'n9')).toBeUndefined();
  });

  it('labels edges and lets the label be emptied', () => {
    const { graph, a, b } = twoNodes();
    const edge = graph.addEdge(a, b);
    if (!edge) throw new Error('edge expected');
    graph.setEdgeLabel(edge.id, 'No');
    expect(graph.getEdge(edge.id)?.label).toBe('No');
    graph.setEdgeLabel(edge.id, '');
    expect(graph.getEdge(edge.id)?.label).toBe('');
  });

  it('fixes and clears the side of either end', () => {
    const { graph, a, b } = twoNodes();
    const edge = graph.addEdge(a, b);
    if (!edge) throw new Error('edge expected');
    graph.setEdgeSide(edge.id, 'source', 'right');
    graph.setEdgeSide(edge.id, 'target', 'left');
    expect(graph.getEdge(edge.id)).toMatchObject({ sourceSide: 'right', targetSide: 'left' });
    graph.setEdgeSide(edge.id, 'source', undefined);
    expect(graph.getEdge(edge.id)).not.toHaveProperty('sourceSide');
    expect(graph.getEdge(edge.id)?.targetSide).toBe('left');
  });

  it('removes an edge and ignores unknown ids', () => {
    const { graph, a, b } = twoNodes();
    const edge = graph.addEdge(a, b);
    if (!edge) throw new Error('edge expected');
    graph.removeEdge('e9');
    expect(graph.edgeCount).toBe(1);
    graph.removeEdge(edge.id);
    expect(graph.edgeCount).toBe(0);
    graph.setEdgeLabel('e9', 'x');
    graph.setEdgeSide('e9', 'source', 'top');
    expect(graph.getEdge('e9')).toBeUndefined();
  });
});

describe('document settings and clearing', () => {
  it('toggles directed and the edge style', () => {
    const graph = new Graph();
    graph.setDirected(false);
    graph.setEdgeStyle('straight');
    expect(graph.directed).toBe(false);
    expect(graph.edgeStyle).toBe('straight');
  });

  it('clear removes every node and edge', () => {
    const { graph, a, b } = twoNodes();
    graph.addEdge(a, b);
    graph.clear();
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });
});

describe('change notifications', () => {
  it('notifies once per change and stops after unsubscribing', () => {
    const graph = new Graph();
    let calls = 0;
    const unsubscribe = graph.onChange(() => calls++);
    const node = graph.addNode(0, 0, 'A');
    graph.moveNode(node.id, 5, 5);
    graph.setNodeLabel(node.id, 'B');
    graph.setDirected(false);
    expect(calls).toBe(4);
    unsubscribe();
    graph.addNode(1, 1);
    expect(calls).toBe(4);
  });

  it('does not notify when nothing actually changes', () => {
    const graph = new Graph();
    const node = graph.addNode(0, 0, 'A');
    let calls = 0;
    graph.onChange(() => calls++);
    graph.moveNode(node.id, 0, 0);
    graph.setNodeLabel(node.id, 'A');
    graph.setNodeType(node.id, 'process');
    graph.setDirected(true);
    graph.setEdgeStyle('orthogonal');
    expect(calls).toBe(0);
  });
});

describe('JSON export and import', () => {
  it('toJSON contains the settings, typed nodes and edges with their sides', () => {
    const { graph, a, b } = twoNodes();
    graph.addEdge(a, b, 'Yes', { sourceSide: 'bottom', targetSide: 'top' });
    expect(graph.toJSON()).toEqual({
      directed: true,
      edgeStyle: 'orthogonal',
      nodes: [
        { id: 'n1', label: 'A', type: 'process', x: 0, y: 0 },
        { id: 'n2', label: 'B', type: 'process', x: 100, y: 0 },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', label: 'Yes', sourceSide: 'bottom', targetSide: 'top' }],
    });
  });

  it('toJSON returns copies that do not alias the graph', () => {
    const { graph, a, b } = twoNodes();
    graph.addEdge(a, b);
    const data = graph.toJSON();
    data.nodes[0].label = 'changed';
    data.edges[0].label = 'changed';
    expect(graph.getNode('n1')?.label).toBe('A');
    expect(graph.getEdge('e1')?.label).toBe('');
  });

  it('round-trips through parse and load', () => {
    const { graph, a, b } = twoNodes();
    graph.addEdge(a, b, 'Yes', { sourceSide: 'right' });
    graph.setDirected(false);
    graph.setEdgeStyle('straight');
    const copy = new Graph();
    copy.load(Graph.parse(JSON.parse(JSON.stringify(graph.toJSON()))));
    expect(copy.toJSON()).toEqual(graph.toJSON());
  });

  it('continues numbering after the highest loaded id', () => {
    const graph = new Graph();
    graph.load(
      Graph.parse({
        nodes: [
          { id: 'n7', label: 'Seven', x: 0, y: 0 },
          { id: 'n3', label: 'Three', x: 1, y: 1 },
        ],
        edges: [{ id: 'e4', source: 'n7', target: 'n3' }],
      }),
    );
    expect(graph.addNode(0, 0).id).toBe('n8');
    expect(graph.addEdge('n7', 'n3')?.id).toBe('e5');
  });

  it('load replaces the previous content entirely', () => {
    const { graph, a, b } = twoNodes();
    graph.addEdge(a, b);
    graph.load(Graph.parse({ nodes: [{ id: 'x', label: 'X', x: 0, y: 0 }], edges: [] }));
    expect(graph.nodeList.map((n) => n.id)).toEqual(['x']);
    expect(graph.edgeCount).toBe(0);
  });
});

describe('Graph.parse validation', () => {
  it('rejects anything that is not an object with nodes and edges arrays', () => {
    expect(() => Graph.parse(null)).toThrow(/nodes/);
    expect(() => Graph.parse('text')).toThrow(/edges/);
    expect(() => Graph.parse({ nodes: [] })).toThrow();
    expect(() => Graph.parse({ edges: [] })).toThrow();
    expect(() => Graph.parse({ nodes: {}, edges: [] })).toThrow();
  });

  it('accepts an empty document', () => {
    expect(Graph.parse({ nodes: [], edges: [] })).toEqual({ directed: true, edgeStyle: 'straight', nodes: [], edges: [] });
  });

  it('loads files written before types, edge styles and sides existed', () => {
    const data = Graph.parse({
      nodes: [
        { id: 'n1', label: 'Old', x: 100, y: 100 },
        { id: 'n2', label: 'Older', x: 300, y: 100 },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', label: '' }],
    });
    expect(data.directed).toBe(true);
    expect(data.edgeStyle).toBe('straight');
    expect(data.nodes.map((n) => n.type)).toEqual(['process', 'process']);
    expect(data.edges[0]).toEqual({ id: 'e1', source: 'n1', target: 'n2', label: '' });
  });

  it('keeps explicit settings and falls back on unknown values', () => {
    const data = Graph.parse({
      directed: false,
      edgeStyle: 'orthogonal',
      nodes: [{ id: 'n1', type: 'hexagon', x: 0, y: 0 }],
      edges: [],
    });
    expect(data.directed).toBe(false);
    expect(data.edgeStyle).toBe('orthogonal');
    expect(data.nodes[0].type).toBe('process');
    expect(data.nodes[0].label).toBe('n1');
    expect(Graph.parse({ edgeStyle: 'curvy', nodes: [], edges: [] }).edgeStyle).toBe('straight');
  });

  it('drops malformed and duplicated nodes', () => {
    const data = Graph.parse({
      nodes: [
        { id: 'ok', label: 'Ok', x: 1, y: 2 },
        { label: 'no id', x: 0, y: 0 },
        { id: 'nan', label: 'bad coords', x: 'a', y: 0 },
        { id: 'inf', label: 'infinite', x: Infinity, y: 0 },
        { id: 'ok', label: 'duplicate', x: 9, y: 9 },
        'not an object',
        42,
      ],
      edges: [],
    });
    expect(data.nodes).toEqual([{ id: 'ok', label: 'Ok', type: 'process', x: 1, y: 2 }]);
  });

  it('drops edges that are malformed, duplicated, self-loops or point to missing nodes', () => {
    const data = Graph.parse({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 1 },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'ok', sourceSide: 'top', targetSide: 'nowhere' },
        { id: 'e1', source: 'b', target: 'a' },
        { id: 'e2', source: 'a', target: 'a' },
        { id: 'e3', source: 'a', target: 'zzz' },
        { id: 'e4', source: 7, target: 'b' },
        { source: 'a', target: 'b' },
        null,
      ],
    });
    expect(data.edges).toEqual([{ id: 'e1', source: 'a', target: 'b', label: 'ok', sourceSide: 'top' }]);
  });
});

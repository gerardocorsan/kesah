import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { Graph } from '../model/graph';
import { shapeSize } from '../model/shapes';
import { fakeRect } from '../test/dom';
import { createAppState, useApp, type AppState } from './app';

/**
 * Expectations come from the agreed behaviour of the editor: fit view centres the content with
 * 48 px of padding and never zooms in beyond 1, reveal pans only when the node is off-screen,
 * zooming keeps the point under the cursor fixed, the selection follows the document.
 */

/** Creates the state inside a root and runs the test after the root has settled, as the app does after render. */
function withState(run: (app: AppState, graph: Graph) => void, prepare?: (graph: Graph) => void): void {
  const graph = new Graph();
  prepare?.(graph);
  let app!: AppState;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    app = createAppState(graph);
  });
  try {
    run(app, graph);
  } finally {
    dispose();
  }
}

function canvas(app: AppState, width = 800, height = 600): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fakeRect(svg, { x: 0, y: 0, width, height });
  app.registerCanvas(svg);
  return svg;
}

describe('graph view', () => {
  it('reflects the graph and follows its changes', () => {
    withState((app, graph) => {
      expect(app.nodes()).toEqual([]);
      expect(app.nodeCount()).toBe(0);
      const a = graph.addNode(0, 0, 'A');
      const b = graph.addNode(100, 0, 'B');
      graph.addEdge(a.id, b.id);
      expect(app.nodes().map((n) => n.label)).toEqual(['A', 'B']);
      expect(app.edges()).toHaveLength(1);
      expect(app.nodeCount()).toBe(2);
      expect(app.edgeCount()).toBe(1);
      expect(app.directed()).toBe(true);
      expect(app.edgeStyle()).toBe('orthogonal');
      graph.setDirected(false);
      graph.setEdgeStyle('straight');
      expect(app.directed()).toBe(false);
      expect(app.edgeStyle()).toBe('straight');
    });
  });

  it('bumps the revision on every change', () => {
    withState((app, graph) => {
      const before = app.revision();
      graph.addNode(0, 0);
      expect(app.revision()).toBe(before + 1);
      graph.setDirected(true);
      expect(app.revision()).toBe(before + 1);
    });
  });

  it('lays out edges and forgets layouts of removed edges', () => {
    withState((app, graph) => {
      const a = graph.addNode(0, 0, 'A');
      const b = graph.addNode(300, 0, 'B');
      const edge = graph.addEdge(a.id, b.id);
      if (!edge) throw new Error('edge expected');
      expect(app.layoutOf(edge.id)).toMatchObject({ sourceSide: 'right', targetSide: 'left' });
      graph.removeEdge(edge.id);
      expect(app.layoutOf(edge.id)).toBeUndefined();
    });
  });
});

describe('node sizes', () => {
  it('falls back to the label-less box until a size is published', () => {
    withState((app, graph) => {
      const node = graph.addNode(0, 0, 'A', 'gateway');
      expect(app.sizeOf(node)).toEqual(shapeSize('gateway', 0));
      app.setSize(node.id, { width: 200, height: 56 });
      expect(app.sizeOf(node)).toEqual({ width: 200, height: 56 });
    });
  });

  it('forgets the size of a node once it is removed, even if the same id comes back', () => {
    withState((app, graph) => {
      const node = graph.addNode(0, 0, 'A');
      app.setSize(node.id, { width: 500, height: 40 });
      expect(app.sizeOf(node).width).toBe(500);
      graph.removeNode(node.id);
      graph.load(Graph.parse({ nodes: [{ id: node.id, label: 'A', x: 0, y: 0 }], edges: [] }));
      expect(app.sizeOf(app.nodes()[0])).toEqual(shapeSize('task', 0));
    });
  });
});

describe('selection', () => {
  it('selects nodes and edges, and clears with null', () => {
    withState((app, graph) => {
      const a = graph.addNode(0, 0, 'A');
      app.select({ kind: 'node', id: a.id });
      expect(app.selection()).toEqual({ kind: 'node', id: a.id });
      app.select(null);
      expect(app.selection()).toBeNull();
    });
  });

  it('is cleared when the selected element disappears from the graph', () => {
    withState((app, graph) => {
      const a = graph.addNode(0, 0, 'A');
      const b = graph.addNode(100, 0, 'B');
      const edge = graph.addEdge(a.id, b.id);
      if (!edge) throw new Error('edge expected');
      app.select({ kind: 'edge', id: edge.id });
      graph.removeEdge(edge.id);
      expect(app.selection()).toBeNull();
      app.select({ kind: 'node', id: a.id });
      graph.removeNode(a.id);
      expect(app.selection()).toBeNull();
    });
  });

  it('deleteSelection removes the selected node with its edges, or the selected edge', () => {
    withState((app, graph) => {
      const a = graph.addNode(0, 0, 'A');
      const b = graph.addNode(100, 0, 'B');
      const edge = graph.addEdge(a.id, b.id);
      if (!edge) throw new Error('edge expected');
      app.select({ kind: 'edge', id: edge.id });
      app.deleteSelection();
      expect(graph.edgeCount).toBe(0);
      expect(app.selection()).toBeNull();
      graph.addEdge(a.id, b.id);
      app.select({ kind: 'node', id: a.id });
      app.deleteSelection();
      expect(graph.nodeList.map((n) => n.id)).toEqual([b.id]);
      expect(graph.edgeCount).toBe(0);
      app.deleteSelection();
      expect(graph.nodeCount).toBe(1);
    });
  });

  it('counts edit requests', () => {
    withState((app) => {
      const before = app.editRequest();
      app.requestEdit();
      app.requestEdit();
      expect(app.editRequest()).toBe(before + 2);
    });
  });

  it('addNodeAt creates a node of the given type at the point and selects it', () => {
    withState((app, graph) => {
      const node = app.addNodeAt({ x: 40, y: 50 }, 'start-event');
      expect(graph.getNode(node.id)).toMatchObject({ x: 40, y: 50, type: 'start-event', variant: 'none' });
      expect(app.selection()).toEqual({ kind: 'node', id: node.id });
      expect(app.addNodeAt({ x: 0, y: 0 }).type).toBe('task');
    });
  });
});

describe('modes and transient state', () => {
  it('stores connect mode, connecting, preview line and front node', () => {
    withState((app) => {
      expect(app.connectMode()).toBe(false);
      app.setConnectMode(true);
      expect(app.connectMode()).toBe(true);
      app.setConnecting(true);
      expect(app.connecting()).toBe(true);
      app.setPreview({ x1: 1, y1: 2, x2: 3, y2: 4 });
      expect(app.preview()).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
      app.setPreview(null);
      expect(app.preview()).toBeNull();
      app.setFrontNode('n1');
      expect(app.frontNode()).toBe('n1');
    });
  });
});

describe('camera', () => {
  it('converts screen coordinates to canvas coordinates through the view', () => {
    withState((app) => {
      canvas(app);
      expect(app.toWorld(100, 50)).toEqual({ x: 100, y: 50 });
      app.setView({ scale: 2, tx: 10, ty: 20 });
      expect(app.toWorld(110, 120)).toEqual({ x: 50, y: 50 });
      expect(app.viewCenter()).toEqual({ x: 195, y: 140 });
    });
  });

  it('accounts for the canvas position on the page', () => {
    withState((app) => {
      const svg = canvas(app);
      fakeRect(svg, { x: 240, y: 50, width: 800, height: 600 });
      expect(app.toWorld(240, 50)).toEqual({ x: 0, y: 0 });
      expect(app.viewCenter()).toEqual({ x: 400, y: 300 });
    });
  });

  it('zooms in on wheel up and out on wheel down, keeping the point under the cursor fixed', () => {
    withState((app) => {
      canvas(app);
      app.setView({ scale: 1, tx: 30, ty: 40 });
      const before = app.toWorld(300, 200);
      app.zoomAt(300, 200, -100);
      expect(app.view().scale).toBeGreaterThan(1);
      expect(app.toWorld(300, 200).x).toBeCloseTo(before.x, 9);
      expect(app.toWorld(300, 200).y).toBeCloseTo(before.y, 9);
      app.zoomAt(300, 200, 100);
      expect(app.view().scale).toBeCloseTo(1, 9);
    });
  });

  it('keeps the zoom within limits in both directions', () => {
    withState((app) => {
      canvas(app);
      for (let i = 0; i < 100; i++) app.zoomAt(0, 0, -500);
      const maxScale = app.view().scale;
      app.zoomAt(0, 0, -500);
      expect(app.view().scale).toBe(maxScale);
      expect(maxScale).toBeGreaterThan(1);
      for (let i = 0; i < 100; i++) app.zoomAt(0, 0, 500);
      const minScale = app.view().scale;
      app.zoomAt(0, 0, 500);
      expect(app.view().scale).toBe(minScale);
      expect(minScale).toBeLessThan(1);
      expect(minScale).toBeGreaterThan(0);
    });
  });

  it('fitView centres a small graph at scale 1', () => {
    withState((app, graph) => {
      canvas(app);
      const node = graph.addNode(1000, -500, 'A');
      app.fitView();
      const view = app.view();
      expect(view.scale).toBe(1);
      expect(node.x * view.scale + view.tx).toBe(400);
      expect(node.y * view.scale + view.ty).toBe(300);
    });
  });

  it('fitView shrinks a wide graph so it fits with 48 px of padding on each side', () => {
    withState((app, graph) => {
      canvas(app);
      const left = graph.addNode(0, 0, 'L');
      const right = graph.addNode(2000, 0, 'R');
      app.fitView();
      const view = app.view();
      const half = shapeSize('task', 0).width / 2;
      expect(view.scale).toBeLessThan(1);
      expect((left.x - half) * view.scale + view.tx).toBeCloseTo(48, 6);
      expect((right.x + half) * view.scale + view.tx).toBeCloseTo(752, 6);
    });
  });

  it('fitView resets the camera when the graph is empty', () => {
    withState((app) => {
      canvas(app);
      app.setView({ scale: 2, tx: 5, ty: 5 });
      app.fitView();
      expect(app.view()).toEqual({ scale: 1, tx: 0, ty: 0 });
    });
  });

  it('revealNode leaves the view alone when the node is visible and centres it when it is not', () => {
    withState((app, graph) => {
      canvas(app);
      // Visible but off-centre, so an unnecessary pan would be noticed.
      const visible = graph.addNode(100, 100, 'V');
      const hidden = graph.addNode(5000, 5000, 'H');
      app.setView({ scale: 1, tx: 0, ty: 0 });
      app.revealNode(visible.id);
      expect(app.view()).toEqual({ scale: 1, tx: 0, ty: 0 });
      app.revealNode(hidden.id);
      const view = app.view();
      expect(view.scale).toBe(1);
      expect(hidden.x * view.scale + view.tx).toBe(400);
      expect(hidden.y * view.scale + view.ty).toBe(300);
      app.revealNode('n9');
      expect(app.view()).toEqual(view);
    });
  });
});

describe('undo and redo', () => {
  it('exposes availability and applies the history', () => {
    withState(
      (app, graph) => {
        expect(app.canUndo()).toBe(false);
        expect(app.canRedo()).toBe(false);
        graph.addNode(0, 0, 'B');
        expect(app.canUndo()).toBe(true);
        app.undo();
        expect(app.nodes().map((n) => n.label)).toEqual(['A']);
        expect(app.canRedo()).toBe(true);
        app.redo();
        expect(app.nodes().map((n) => n.label)).toEqual(['A', 'B']);
        app.history.begin();
        graph.addNode(1, 1, 'C');
        graph.addNode(2, 2, 'D');
        app.history.commit();
        app.undo();
        expect(app.nodes().map((n) => n.label)).toEqual(['A', 'B']);
      },
      (graph) => graph.addNode(0, 0, 'A'),
    );
  });
});

describe('useApp', () => {
  it('throws outside an AppProvider', () => {
    expect(() => createRoot(() => useApp())).toThrow(/AppProvider/);
  });
});

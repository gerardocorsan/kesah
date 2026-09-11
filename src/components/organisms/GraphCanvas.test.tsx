import { describe, expect, it } from 'vitest';
import { fakeRect, keydown, pointer, underPointer } from '../../test/dom';
import { renderWithApp, seedPair } from '../../test/render';
import { GraphCanvas } from './GraphCanvas';

/**
 * Agreed behaviour of the canvas: drag the background to pan, drag a node to move it (one undo
 * step), Shift+drag or connect mode to connect, side handles fix the sides, double-click to
 * create or edit, wheel to zoom, Delete/Backspace, Escape, C and the undo/redo shortcuts.
 * Coordinates: the canvas is 800×600 at the page origin with the camera at identity, so screen
 * and canvas coordinates coincide. A sits at (0,0) and B at (300,0).
 */

function setup() {
  let ids!: { a: string; b: string; edge: string };
  const result = renderWithApp(
    () => <GraphCanvas />,
    (graph) => {
      ids = seedPair(graph);
    },
  );
  const svg = result.container.querySelector('svg.graph-editor') as SVGSVGElement;
  fakeRect(svg, { x: 0, y: 0, width: 800, height: 600 });
  result.app.setView({ scale: 1, tx: 0, ty: 0 });
  const node = (id: string) => result.container.querySelector(`.node[data-id="${id}"]`) as SVGGElement;
  const port = (id: string, side: string) => node(id).querySelector(`.port[data-side="${side}"]`) as SVGCircleElement;
  const background = result.container.querySelector('rect.background') as SVGRectElement;
  const edgeHit = (id: string) => result.container.querySelector(`.edge[data-id="${id}"] .edge-hit`) as SVGPathElement;
  return { ...result, ids, svg, node, port, background, edgeHit };
}

describe('GraphCanvas rendering', () => {
  it('draws every node and edge and follows the modes and the preview line', () => {
    const { container, app } = setup();
    expect(container.querySelectorAll('.node')).toHaveLength(2);
    expect(container.querySelectorAll('.edge')).toHaveLength(1);
    const canvas = container.querySelector('#canvas') as HTMLElement;
    expect(canvas).not.toHaveClass('connect-mode');
    app.setConnectMode(true);
    expect(canvas).toHaveClass('connect-mode');
    expect(container.querySelector('.edge-preview')).toBeNull();
    app.setPreview({ x1: 1, y1: 2, x2: 30, y2: 40 });
    const preview = container.querySelector('.edge-preview');
    expect(preview).toHaveAttribute('x2', '30');
    expect(preview).toHaveAttribute('marker-end', 'url(#arrow)');
    app.setPreview(null);
    expect(container.querySelector('.edge-preview')).toBeNull();
  });

  it('moves the camera transform with the view', () => {
    const { container, app } = setup();
    app.setView({ scale: 2, tx: 10, ty: 20 });
    expect(container.querySelector('.viewport')).toHaveAttribute('transform', 'translate(10 20) scale(2)');
    expect(container.querySelector('pattern#grid')).toHaveAttribute('patternTransform', 'translate(10 20) scale(2)');
  });
});

describe('selection by pointer', () => {
  it('selects a node, an edge, or nothing when the background is pressed', () => {
    const { app, ids, node, edgeHit, background } = setup();
    pointer(node(ids.b), 'pointerdown', 300, 0);
    pointer(node(ids.b), 'pointerup', 300, 0);
    expect(app.selection()).toEqual({ kind: 'node', id: ids.b });
    pointer(edgeHit(ids.edge), 'pointerdown', 150, 0);
    expect(app.selection()).toEqual({ kind: 'edge', id: ids.edge });
    pointer(background, 'pointerdown', 500, 400);
    pointer(background, 'pointerup', 500, 400);
    expect(app.selection()).toBeNull();
  });

  it('ignores buttons other than the left and middle ones', () => {
    const { app, ids, node } = setup();
    pointer(node(ids.a), 'pointerdown', 0, 0, { button: 2 });
    expect(app.selection()).toBeNull();
  });
});

describe('panning', () => {
  it('drags the background to pan the camera', () => {
    const { app, background } = setup();
    pointer(background, 'pointerdown', 100, 100);
    pointer(background, 'pointermove', 150, 130);
    pointer(background, 'pointerup', 150, 130);
    expect(app.view()).toEqual({ scale: 1, tx: 50, ty: 30 });
  });

  it('pans with the middle button even over a node, without moving or selecting it', () => {
    const { app, ids, node, graph } = setup();
    pointer(node(ids.a), 'pointerdown', 0, 0, { button: 1 });
    pointer(node(ids.a), 'pointermove', 20, 10, { button: 1 });
    pointer(node(ids.a), 'pointerup', 20, 10, { button: 1 });
    expect(app.view()).toEqual({ scale: 1, tx: 20, ty: 10 });
    expect(graph.getNode(ids.a)).toMatchObject({ x: 0, y: 0 });
    expect(app.selection()).toBeNull();
  });
});

describe('moving nodes', () => {
  it('drags a node, keeps it in front and records the whole drag as one undo step', () => {
    const { app, ids, node, graph, container } = setup();
    pointer(node(ids.a), 'pointerdown', 0, 0);
    pointer(node(ids.a), 'pointermove', 10, 5);
    pointer(node(ids.a), 'pointermove', 40, 20);
    pointer(node(ids.a), 'pointerup', 40, 20);
    expect(graph.getNode(ids.a)).toMatchObject({ x: 40, y: 20 });
    expect(app.selection()).toEqual({ kind: 'node', id: ids.a });
    const drawn = [...container.querySelectorAll('g.nodes > .node')].map((el) => el.getAttribute('data-id'));
    expect(drawn[drawn.length - 1]).toBe(ids.a);
    app.undo();
    expect(graph.getNode(ids.a)).toMatchObject({ x: 0, y: 0 });
    expect(app.canUndo()).toBe(false);
  });

  it('keeps the grab offset so the node does not jump under the pointer', () => {
    const { ids, node, graph } = setup();
    pointer(node(ids.b), 'pointerdown', 310, 5);
    pointer(node(ids.b), 'pointermove', 360, 25);
    pointer(node(ids.b), 'pointerup', 360, 25);
    expect(graph.getNode(ids.b)).toMatchObject({ x: 350, y: 20 });
  });

  it('follows the camera scale while dragging', () => {
    const { app, ids, node, graph } = setup();
    app.setView({ scale: 2, tx: 0, ty: 0 });
    pointer(node(ids.a), 'pointerdown', 0, 0);
    pointer(node(ids.a), 'pointermove', 100, 50);
    pointer(node(ids.a), 'pointerup', 100, 50);
    expect(graph.getNode(ids.a)).toMatchObject({ x: 50, y: 25 });
  });
});

describe('connecting nodes', () => {
  it('creates an edge with automatic sides by Shift-dragging from one node to another', () => {
    const { app, ids, node, graph } = setup();
    pointer(node(ids.a), 'pointerdown', 0, 0, { shiftKey: true });
    pointer(node(ids.a), 'pointermove', 100, 0, { shiftKey: true });
    expect(app.connecting()).toBe(true);
    expect(app.preview()).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 0 });
    const restore = underPointer(node(ids.b));
    pointer(node(ids.a), 'pointerup', 300, 0, { shiftKey: true });
    restore();
    expect(graph.edgeCount).toBe(2);
    const created = graph.edgeList[1];
    expect(created).toMatchObject({ source: ids.a, target: ids.b });
    expect(created).not.toHaveProperty('sourceSide');
    expect(app.selection()).toEqual({ kind: 'edge', id: created.id });
    expect(app.connecting()).toBe(false);
    expect(app.preview()).toBeNull();
    expect(graph.getNode(ids.a)).toMatchObject({ x: 0, y: 0 });
  });

  it('connects with a plain drag while connect mode is on', () => {
    const { app, ids, node, graph } = setup();
    app.setConnectMode(true);
    pointer(node(ids.a), 'pointerdown', 0, 0);
    const restore = underPointer(node(ids.b));
    pointer(node(ids.a), 'pointerup', 300, 0);
    restore();
    expect(graph.edgeCount).toBe(2);
    expect(graph.getNode(ids.a)).toMatchObject({ x: 0, y: 0 });
  });

  it('fixes both sides when dragging from a handle to a handle', () => {
    const { ids, port, node, graph } = setup();
    pointer(port(ids.a, 'bottom'), 'pointerdown', 0, 20);
    const restore = underPointer(port(ids.b, 'top'));
    pointer(node(ids.a), 'pointerup', 300, -28);
    restore();
    expect(graph.edgeList[1]).toMatchObject({ source: ids.a, target: ids.b, sourceSide: 'bottom', targetSide: 'top' });
  });

  it('fixes only the source side when dropping on the body of the target', () => {
    const { ids, port, node, graph, app } = setup();
    pointer(port(ids.a, 'right'), 'pointerdown', 36, 0);
    expect(app.preview()).toMatchObject({ x1: 37, y1: 0 });
    const restore = underPointer(node(ids.b));
    pointer(node(ids.a), 'pointerup', 300, 0);
    restore();
    expect(graph.edgeList[1]).toMatchObject({ source: ids.a, target: ids.b, sourceSide: 'right' });
    expect(graph.edgeList[1]).not.toHaveProperty('targetSide');
  });

  it('creates nothing when dropped on the source node or on empty canvas', () => {
    const { ids, node, graph } = setup();
    pointer(node(ids.a), 'pointerdown', 0, 0, { shiftKey: true });
    const restore = underPointer(node(ids.a));
    pointer(node(ids.a), 'pointerup', 5, 5, { shiftKey: true });
    restore();
    pointer(node(ids.a), 'pointerdown', 0, 0, { shiftKey: true });
    pointer(node(ids.a), 'pointerup', 500, 500, { shiftKey: true });
    expect(graph.edgeCount).toBe(1);
  });

  it('abandons the gesture on pointer cancel', () => {
    const { app, ids, node, graph } = setup();
    pointer(node(ids.a), 'pointerdown', 0, 0, { shiftKey: true });
    pointer(node(ids.a), 'pointercancel', 0, 0);
    expect(app.connecting()).toBe(false);
    expect(app.preview()).toBeNull();
    expect(graph.edgeCount).toBe(1);
  });
});

describe('double-click', () => {
  const dblclick = (target: Element, x: number, y: number) =>
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));

  it('creates a process node under the pointer and selects it', () => {
    const { app, graph, background } = setup();
    dblclick(background, 200, 150);
    expect(graph.nodeCount).toBe(3);
    const created = graph.nodeList[2];
    expect(created).toMatchObject({ type: 'process', x: 200, y: 150 });
    expect(app.selection()).toEqual({ kind: 'node', id: created.id });
  });

  it('selects a node or an edge and asks to edit it', () => {
    const { app, ids, node, edgeHit } = setup();
    const before = app.editRequest();
    dblclick(node(ids.b), 300, 0);
    expect(app.selection()).toEqual({ kind: 'node', id: ids.b });
    expect(app.editRequest()).toBe(before + 1);
    dblclick(edgeHit(ids.edge), 150, 0);
    expect(app.selection()).toEqual({ kind: 'edge', id: ids.edge });
    expect(app.editRequest()).toBe(before + 2);
  });
});

describe('zoom', () => {
  it('zooms with the wheel around the pointer, also when the wheel reports lines', () => {
    const { app, svg } = setup();
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    expect(app.view().scale).toBeGreaterThan(1);
    const zoomedIn = app.view().scale;
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    expect(app.view().scale).toBeLessThan(zoomedIn);
  });
});

describe('keyboard', () => {
  it('deletes the selection with Delete or Backspace', () => {
    const { app, ids, graph } = setup();
    app.select({ kind: 'edge', id: ids.edge });
    keydown('Backspace');
    expect(graph.edgeCount).toBe(0);
    app.select({ kind: 'node', id: ids.a });
    keydown('Delete');
    expect(graph.getNode(ids.a)).toBeUndefined();
    keydown('Delete');
    expect(graph.nodeCount).toBe(1);
  });

  it('Escape leaves connect mode and clears the selection', () => {
    const { app, ids } = setup();
    app.setConnectMode(true);
    app.select({ kind: 'node', id: ids.a });
    keydown('Escape');
    expect(app.connectMode()).toBe(false);
    expect(app.selection()).toBeNull();
  });

  it('C toggles connect mode, but not with a modifier held', () => {
    const { app } = setup();
    keydown('c');
    expect(app.connectMode()).toBe(true);
    keydown('C');
    expect(app.connectMode()).toBe(false);
    keydown('c', { ctrlKey: true });
    keydown('c', { altKey: true });
    keydown('c', { metaKey: true });
    expect(app.connectMode()).toBe(false);
  });

  it('undoes and redoes with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y, also with the command key', () => {
    const { graph } = setup();
    graph.addNode(0, 0, 'C');
    expect(keydown('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(graph.nodeCount).toBe(2);
    keydown('z', { ctrlKey: true, shiftKey: true });
    expect(graph.nodeCount).toBe(3);
    keydown('Z', { metaKey: true });
    expect(graph.nodeCount).toBe(2);
    keydown('y', { ctrlKey: true });
    expect(graph.nodeCount).toBe(3);
    keydown('z');
    expect(graph.nodeCount).toBe(3);
  });

  it('ignores shortcuts while typing in a field', () => {
    const { app, ids, graph } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    app.select({ kind: 'node', id: ids.a });
    keydown('Delete', {}, input);
    keydown('c', {}, input);
    expect(graph.getNode(ids.a)).toBeDefined();
    expect(app.connectMode()).toBe(false);
    input.remove();
  });

  it('stops listening once the canvas is unmounted', () => {
    const { app, unmount } = setup();
    unmount();
    keydown('c');
    expect(app.connectMode()).toBe(false);
  });
});

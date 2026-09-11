import { batch } from 'solid-js';
import { isSide, type GraphNode, type NodeId, type Side } from '../../model/graph';
import type { Point } from '../../model/shapes';
import { anchorOf } from '../../model/layout';
import type { AppState } from '../../state/app';

/**
 * Pointer, wheel and keyboard handling for the canvas. Imperative on purpose:
 * gestures are sequences of events with transient state, and they talk to
 * the app state through actions rather than touching the DOM.
 */

/** Gesture in progress: what the pointer is doing between pointerdown and pointerup. */
type Gesture =
  | { kind: 'none' }
  | { kind: 'drag-node'; id: NodeId; offsetX: number; offsetY: number }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'connect'; source: NodeId; sourceSide?: Side };

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
  );
}

/** Attaches the handlers to the svg and the keyboard shortcuts to the window. Returns the cleanup. */
export function attachGestures(svg: SVGSVGElement, app: AppState): () => void {
  let gesture: Gesture = { kind: 'none' };

  const updatePreview = (source: GraphNode, side: Side | undefined, to: Point): void => {
    const from: Point = side ? anchorOf(source, side, 0, app.sizeOf(source)) : source;
    app.setPreview({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  };

  const startConnect = (source: GraphNode, sourceSide: Side | undefined, pointer: Point): void => {
    gesture = { kind: 'connect', source: source.id, sourceSide };
    batch(() => {
      // While connecting, every node shows its side handles so the drop targets are visible.
      app.setConnecting(true);
      updatePreview(source, sourceSide, pointer);
    });
  };

  const endGesture = (): void => {
    gesture = { kind: 'none' };
    batch(() => {
      app.setConnecting(false);
      app.setPreview(null);
    });
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target instanceof Element ? e.target : svg;
    const nodeEl = target.closest<SVGGElement>('.node');
    const nodeId = nodeEl?.dataset.id;
    const edgeId = target.closest<SVGGElement>('.edge')?.dataset.id;
    const portSide = target.closest<SVGCircleElement>('.port')?.dataset.side;

    if (e.button === 0 && nodeEl && nodeId) {
      const node = app.graph.getNode(nodeId);
      if (!node) return;
      const point = app.toWorld(e.clientX, e.clientY);
      app.select({ kind: 'node', id: nodeId });
      if (isSide(portSide)) {
        // Dragging from a side handle fixes the side the new edge leaves through.
        startConnect(node, portSide, point);
      } else if (app.connectMode() || e.shiftKey) {
        startConnect(node, undefined, point);
      } else {
        gesture = { kind: 'drag-node', id: nodeId, offsetX: point.x - node.x, offsetY: point.y - node.y };
        // Bring it to the front. Done before capturing: moving the element in the DOM would release the capture.
        app.setFrontNode(nodeId);
      }
      // Capture on the node itself (not the svg) so click and dblclick keep targeting it.
      nodeEl.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 0 && edgeId) {
      app.select({ kind: 'edge', id: edgeId });
      return;
    }

    // Left button on the background, or middle button anywhere: pan the canvas.
    if (e.button === 0) app.select(null);
    const view = app.view();
    gesture = { kind: 'pan', startX: e.clientX, startY: e.clientY, originX: view.tx, originY: view.ty };
    target.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'pan') {
      app.setView({
        scale: app.view().scale,
        tx: gesture.originX + (e.clientX - gesture.startX),
        ty: gesture.originY + (e.clientY - gesture.startY),
      });
      return;
    }
    const point = app.toWorld(e.clientX, e.clientY);
    if (gesture.kind === 'drag-node') {
      app.graph.moveNode(gesture.id, point.x - gesture.offsetX, point.y - gesture.offsetY);
    } else {
      const source = app.graph.getNode(gesture.source);
      if (source) updatePreview(source, gesture.sourceSide, point);
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    const current = gesture;
    // While captured, e.target is the source node, so look at what is really under the pointer
    // before the gesture ends and the side handles stop taking pointer events.
    const hit = current.kind === 'connect' ? document.elementFromPoint(e.clientX, e.clientY) : null;
    endGesture();
    if (current.kind !== 'connect') return;
    const targetId = hit?.closest<SVGGElement>('.node')?.dataset.id;
    if (!targetId || targetId === current.source) return;
    const targetSide = hit?.closest<SVGCircleElement>('.port')?.dataset.side;
    const edge = app.graph.addEdge(current.source, targetId, '', {
      sourceSide: current.sourceSide,
      targetSide: isSide(targetSide) ? targetSide : undefined,
    });
    if (edge) app.select({ kind: 'edge', id: edge.id });
  };

  const onPointerCancel = (): void => {
    endGesture();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const nodeId = target?.closest<SVGGElement>('.node')?.dataset.id;
    const edgeId = target?.closest<SVGGElement>('.edge')?.dataset.id;
    // Double-clicking an element selects it and asks the panel to edit it in place.
    if (nodeId || edgeId) {
      batch(() => {
        app.select(nodeId ? { kind: 'node', id: nodeId } : { kind: 'edge', id: edgeId ?? '' });
        app.requestEdit();
      });
      return;
    }
    app.addNodeAt(app.toWorld(e.clientX, e.clientY));
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    app.zoomAt(e.clientX, e.clientY, delta);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!app.selection()) return;
      e.preventDefault();
      app.deleteSelection();
    } else if (e.key === 'Escape') {
      batch(() => {
        endGesture();
        app.setConnectMode(false);
        app.select(null);
      });
    } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      app.setConnectMode(!app.connectMode());
    }
  };

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerCancel);
  svg.addEventListener('dblclick', onDoubleClick);
  svg.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  return () => {
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', onPointerUp);
    svg.removeEventListener('pointercancel', onPointerCancel);
    svg.removeEventListener('dblclick', onDoubleClick);
    svg.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
  };
}

import { Graph, SIDES, isSide, type EdgeId, type GraphEdge, type GraphNode, type NodeId, type Side } from './graph';
import { boundaryDistance, pointOnSide, shapePath, shapeSize, sideNormal, type Point, type Size } from './shapes';
import { autoSides, labelAnchor, orthogonalRoute, roundedPath, spread, type Anchor } from './routing';

const SVG_NS = 'http://www.w3.org/2000/svg';

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const GRID_SIZE = 24;
const PORT_RADIUS = 5;
const ELBOW_RADIUS = 8;

/** A selected element: a node or an edge. */
export type Selected = { kind: 'node'; id: NodeId } | { kind: 'edge'; id: EdgeId };
export type Selection = Selected | null;

/** Gesture in progress: what the pointer is doing between pointerdown and pointerup. */
type Gesture =
  | { kind: 'none' }
  | { kind: 'drag-node'; id: NodeId; offsetX: number; offsetY: number }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'connect'; source: NodeId; sourceSide?: Side };

/** An edge with the side resolved at both ends and the fan-out offset assigned to each. */
interface EdgeLayout {
  edge: GraphEdge;
  source: GraphNode;
  target: GraphNode;
  sourceSide: Side;
  targetSide: Side;
  sourceOffset: number;
  targetOffset: number;
}

function createSvg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
  );
}

/**
 * Visual editor: renders the graph in an <svg> and translates mouse and
 * touch input into operations on the model. The source of truth is `Graph`;
 * this class only holds the view, the selection and the gestures.
 */
export class GraphEditor {
  readonly svg: SVGSVGElement;
  private readonly viewport: SVGGElement;
  private readonly edgeLayer: SVGGElement;
  private readonly nodeLayer: SVGGElement;
  private readonly gridPattern: SVGPatternElement;
  private readonly preview: SVGLineElement;
  private readonly nodeEls = new Map<NodeId, SVGGElement>();
  private readonly edgeEls = new Map<EdgeId, SVGGElement>();
  /** Measured box of each drawn node; the model itself has no size. */
  private readonly nodeSizes = new Map<NodeId, Size>();
  private readonly selectionListeners = new Set<(selection: Selection) => void>();
  private readonly editListeners = new Set<(target: Selected) => void>();
  private readonly connectListeners = new Set<(on: boolean) => void>();

  private scale = 1;
  private tx = 0;
  private ty = 0;
  private gesture: Gesture = { kind: 'none' };
  private current: Selection = null;
  private connect = false;
  private renderQueued = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly graph: Graph,
  ) {
    this.svg = createSvg('svg', { class: 'graph-editor' });

    const defs = createSvg('defs');
    defs.append(this.createArrowMarker('arrow', false), this.createArrowMarker('arrow-selected', true));
    this.gridPattern = createSvg('pattern', {
      id: 'grid',
      width: GRID_SIZE,
      height: GRID_SIZE,
      patternUnits: 'userSpaceOnUse',
    });
    this.gridPattern.append(createSvg('circle', { class: 'grid-dot', cx: 1, cy: 1, r: 1 }));
    defs.append(this.gridPattern);

    const background = createSvg('rect', { class: 'background', width: '100%', height: '100%', fill: 'url(#grid)' });

    this.edgeLayer = createSvg('g', { class: 'edges' });
    this.nodeLayer = createSvg('g', { class: 'nodes' });
    this.preview = createSvg('line', { class: 'edge-preview' });
    this.preview.style.display = 'none';
    this.viewport = createSvg('g', { class: 'viewport' });
    this.viewport.append(this.edgeLayer, this.nodeLayer, this.preview);

    this.svg.append(defs, background, this.viewport);
    container.append(this.svg);

    this.svg.addEventListener('pointerdown', this.onPointerDown);
    this.svg.addEventListener('pointermove', this.onPointerMove);
    this.svg.addEventListener('pointerup', this.onPointerUp);
    this.svg.addEventListener('pointercancel', this.onPointerCancel);
    this.svg.addEventListener('dblclick', this.onDoubleClick);
    this.svg.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);

    graph.onChange(() => this.scheduleRender());
    this.applyTransform();
    this.render();
  }

  get selection(): Selection {
    return this.current;
  }

  get connectMode(): boolean {
    return this.connect;
  }

  /** With connect mode on, dragging from a node creates an edge instead of moving it. Toggled with the C key too. */
  set connectMode(value: boolean) {
    if (this.connect === value) return;
    this.connect = value;
    this.container.classList.toggle('connect-mode', value);
    for (const listener of this.connectListeners) listener(value);
  }

  /** Called whenever connect mode is switched on or off, from the UI or the keyboard. */
  onConnectModeChange(listener: (on: boolean) => void): () => void {
    this.connectListeners.add(listener);
    return () => {
      this.connectListeners.delete(listener);
    };
  }

  onSelectionChange(listener: (selection: Selection) => void): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  /** Called when the user asks to edit an element in place, for example by double-clicking it. */
  onEditRequest(listener: (target: Selected) => void): () => void {
    this.editListeners.add(listener);
    return () => {
      this.editListeners.delete(listener);
    };
  }

  select(selection: Selection): void {
    if (selection?.kind === this.current?.kind && selection?.id === this.current?.id) return;
    this.current = selection;
    this.scheduleRender();
    this.notifySelection();
  }

  deleteSelection(): void {
    const selected = this.current;
    if (!selected) return;
    this.select(null);
    if (selected.kind === 'node') this.graph.removeNode(selected.id);
    else this.graph.removeEdge(selected.id);
  }

  /** Fits every node in the canvas, without zooming in beyond scale 1. */
  fitView(padding = 48): void {
    const nodes = this.graph.nodeList;
    const { width, height } = this.svg.getBoundingClientRect();
    if (nodes.length === 0) {
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.applyTransform();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const { width: w, height: h } = this.sizeOf(node.id);
      minX = Math.min(minX, node.x - w / 2);
      minY = Math.min(minY, node.y - h / 2);
      maxX = Math.max(maxX, node.x + w / 2);
      maxY = Math.max(maxY, node.y + h / 2);
    }
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const fit = Math.min((width - 2 * padding) / contentWidth, (height - 2 * padding) / contentHeight, 1);
    this.scale = clamp(fit, MIN_SCALE, MAX_SCALE);
    this.tx = (width - contentWidth * this.scale) / 2 - minX * this.scale;
    this.ty = (height - contentHeight * this.scale) / 2 - minY * this.scale;
    this.applyTransform();
  }

  /** Canvas coordinates of the middle of the visible area. */
  viewCenter(): Point {
    const rect = this.svg.getBoundingClientRect();
    return this.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /** Pans so the node is visible, keeping the current zoom. Does nothing if it is already in view. */
  revealNode(id: NodeId): void {
    const node = this.graph.getNode(id);
    if (!node) return;
    const { width, height } = this.svg.getBoundingClientRect();
    const screenX = node.x * this.scale + this.tx;
    const screenY = node.y * this.scale + this.ty;
    const size = this.sizeOf(id);
    const marginX = (size.width / 2) * this.scale + 8;
    const marginY = (size.height / 2) * this.scale + 8;
    if (screenX >= marginX && screenX <= width - marginX && screenY >= marginY && screenY <= height - marginY) return;
    this.tx = width / 2 - node.x * this.scale;
    this.ty = height / 2 - node.y * this.scale;
    this.applyTransform();
  }

  /** Repaints right now. Usually `scheduleRender` is enough, since it batches changes per frame. */
  render(): void {
    const selected = this.current;
    const stillExists =
      selected === null ||
      (selected.kind === 'node' ? this.graph.getNode(selected.id) : this.graph.getEdge(selected.id)) !== undefined;
    if (!stillExists) {
      this.current = null;
      this.notifySelection();
    }

    const liveNodes = new Set<NodeId>();
    for (const node of this.graph.nodeList) {
      liveNodes.add(node.id);
      let el = this.nodeEls.get(node.id);
      if (!el) {
        el = this.createNodeEl(node.id);
        this.nodeEls.set(node.id, el);
        this.nodeLayer.append(el);
      }
      this.updateNodeEl(el, node);
    }
    for (const [id, el] of this.nodeEls) {
      if (!liveNodes.has(id)) {
        el.remove();
        this.nodeEls.delete(id);
        this.nodeSizes.delete(id);
      }
    }

    const liveEdges = new Set<EdgeId>();
    for (const layout of this.layoutEdges()) {
      liveEdges.add(layout.edge.id);
      let el = this.edgeEls.get(layout.edge.id);
      if (!el) {
        el = this.createEdgeEl(layout.edge.id);
        this.edgeEls.set(layout.edge.id, el);
        this.edgeLayer.append(el);
      }
      this.updateEdgeEl(el, layout);
    }
    for (const [id, el] of this.edgeEls) {
      if (!liveEdges.has(id)) {
        el.remove();
        this.edgeEls.delete(id);
      }
    }
  }

  // --- Gestures ---------------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target instanceof Element ? e.target : this.svg;
    const nodeEl = target.closest<SVGGElement>('.node');
    const nodeId = nodeEl?.dataset.id;
    const edgeId = target.closest<SVGGElement>('.edge')?.dataset.id;
    const portSide = target.closest<SVGCircleElement>('.port')?.dataset.side;

    if (e.button === 0 && nodeEl && nodeId) {
      const node = this.graph.getNode(nodeId);
      if (!node) return;
      const point = this.toWorld(e.clientX, e.clientY);
      this.select({ kind: 'node', id: nodeId });
      if (isSide(portSide)) {
        // Dragging from a side handle fixes the side the new edge leaves through.
        this.startConnect(node, portSide, point);
      } else if (this.connect || e.shiftKey) {
        this.startConnect(node, undefined, point);
      } else {
        this.gesture = { kind: 'drag-node', id: nodeId, offsetX: point.x - node.x, offsetY: point.y - node.y };
        // Bring it to the front. Done before capturing: moving the element in the DOM would release the capture.
        if (this.nodeLayer.lastElementChild !== nodeEl) this.nodeLayer.append(nodeEl);
      }
      // Capture on the node itself (not the svg) so click and dblclick keep targeting it.
      nodeEl.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 0 && edgeId) {
      this.select({ kind: 'edge', id: edgeId });
      return;
    }

    // Left button on the background, or middle button anywhere: pan the canvas.
    if (e.button === 0) this.select(null);
    this.gesture = { kind: 'pan', startX: e.clientX, startY: e.clientY, originX: this.tx, originY: this.ty };
    target.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'pan') {
      this.tx = gesture.originX + (e.clientX - gesture.startX);
      this.ty = gesture.originY + (e.clientY - gesture.startY);
      this.applyTransform();
      return;
    }
    const point = this.toWorld(e.clientX, e.clientY);
    if (gesture.kind === 'drag-node') {
      this.graph.moveNode(gesture.id, point.x - gesture.offsetX, point.y - gesture.offsetY);
    } else {
      const source = this.graph.getNode(gesture.source);
      if (source) this.updatePreview(source, gesture.sourceSide, point);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const gesture = this.gesture;
    // While captured, e.target is the source node, so look at what is really under the pointer
    // before the gesture ends and the side handles stop taking pointer events.
    const hit = gesture.kind === 'connect' ? document.elementFromPoint(e.clientX, e.clientY) : null;
    this.endGesture();
    if (gesture.kind !== 'connect') return;
    const targetId = hit?.closest<SVGGElement>('.node')?.dataset.id;
    if (!targetId || targetId === gesture.source) return;
    const targetSide = hit?.closest<SVGCircleElement>('.port')?.dataset.side;
    const edge = this.graph.addEdge(gesture.source, targetId, '', {
      sourceSide: gesture.sourceSide,
      targetSide: isSide(targetSide) ? targetSide : undefined,
    });
    if (edge) this.select({ kind: 'edge', id: edge.id });
  };

  private readonly onPointerCancel = (): void => {
    this.endGesture();
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    const nodeId = target?.closest<SVGGElement>('.node')?.dataset.id;
    const edgeId = target?.closest<SVGGElement>('.edge')?.dataset.id;

    // Double-clicking an element selects it and asks the surrounding UI to edit it in place.
    const hit: Selected | null = nodeId
      ? { kind: 'node', id: nodeId }
      : edgeId
        ? { kind: 'edge', id: edgeId }
        : null;
    if (hit) {
      this.select(hit);
      for (const listener of this.editListeners) listener(hit);
      return;
    }
    const point = this.toWorld(e.clientX, e.clientY);
    const node = this.graph.addNode(point.x, point.y);
    this.select({ kind: 'node', id: node.id });
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    const next = clamp(this.scale * Math.exp(-delta * 0.0015), MIN_SCALE, MAX_SCALE);
    const ratio = next / this.scale;
    // The world point under the cursor stays where it is.
    this.tx = mouseX - (mouseX - this.tx) * ratio;
    this.ty = mouseY - (mouseY - this.ty) * ratio;
    this.scale = next;
    this.applyTransform();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this.current) return;
      e.preventDefault();
      this.deleteSelection();
    } else if (e.key === 'Escape') {
      this.endGesture();
      this.connectMode = false;
      this.select(null);
    } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.connectMode = !this.connectMode;
    }
  };

  private startConnect(source: GraphNode, sourceSide: Side | undefined, pointer: Point): void {
    this.gesture = { kind: 'connect', source: source.id, sourceSide };
    // While connecting, every node shows its side handles so the drop targets are visible.
    this.container.classList.add('connecting');
    this.updatePreview(source, sourceSide, pointer);
  }

  private endGesture(): void {
    this.gesture = { kind: 'none' };
    this.container.classList.remove('connecting');
    this.hidePreview();
  }

  // --- Geometry and painting -------------------------------------------

  private toWorld(clientX: number, clientY: number): Point {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.tx) / this.scale,
      y: (clientY - rect.top - this.ty) / this.scale,
    };
  }

  private applyTransform(): void {
    const transform = `translate(${this.tx} ${this.ty}) scale(${this.scale})`;
    this.viewport.setAttribute('transform', transform);
    this.gridPattern.setAttribute('patternTransform', transform);
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private notifySelection(): void {
    for (const listener of this.selectionListeners) listener(this.current);
  }

  private updatePreview(source: GraphNode, side: Side | undefined, to: Point): void {
    const from: Point = side ? this.anchor(source, side, 0) : source;
    this.preview.setAttribute('x1', String(from.x));
    this.preview.setAttribute('y1', String(from.y));
    this.preview.setAttribute('x2', String(to.x));
    this.preview.setAttribute('y2', String(to.y));
    if (this.graph.directed) this.preview.setAttribute('marker-end', 'url(#arrow)');
    else this.preview.removeAttribute('marker-end');
    this.preview.style.display = '';
  }

  private hidePreview(): void {
    this.preview.style.display = 'none';
  }

  private createArrowMarker(id: string, selected: boolean): SVGMarkerElement {
    const marker = createSvg('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: 10,
      refY: 5,
      markerWidth: 12,
      markerHeight: 12,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto',
    });
    marker.append(createSvg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: selected ? 'arrow-head selected' : 'arrow-head' }));
    return marker;
  }

  private sizeOf(id: NodeId): Size {
    return this.nodeSizes.get(id) ?? shapeSize(this.graph.getNode(id)?.type ?? 'process', 0);
  }

  /** Point where an edge meets the node outline, pushed one unit out so the arrowhead clears the stroke. */
  private anchor(node: GraphNode, side: Side, offset: number): Anchor {
    const p = pointOnSide(node.type, this.sizeOf(node.id), side, offset);
    const n = sideNormal(side);
    return { x: node.x + p.x + n.x, y: node.y + p.y + n.y, side };
  }

  private createNodeEl(id: NodeId): SVGGElement {
    const group = createSvg('g', { class: 'node', 'data-id': id });
    group.append(createSvg('path', { class: 'shape' }), createSvg('text'));
    for (const side of SIDES) group.append(createSvg('circle', { class: 'port', 'data-side': side, r: PORT_RADIUS }));
    return group;
  }

  private updateNodeEl(el: SVGGElement, node: GraphNode): void {
    el.setAttribute('transform', `translate(${node.x} ${node.y})`);
    el.classList.toggle('selected', this.current?.kind === 'node' && this.current.id === node.id);
    const text = el.querySelector('text');
    const shape = el.querySelector('path');
    if (!text || !shape) return;
    if (text.textContent === node.label && el.dataset.type === node.type && this.nodeSizes.has(node.id)) return;
    // Measuring the text forces a layout, so the outline is only rebuilt when the label or the type changes.
    text.textContent = node.label;
    el.dataset.type = node.type;
    const size = shapeSize(node.type, text.getComputedTextLength());
    this.nodeSizes.set(node.id, size);
    shape.setAttribute('d', shapePath(node.type, size));
    for (const port of el.querySelectorAll<SVGCircleElement>('.port')) {
      const side = port.dataset.side;
      if (!isSide(side)) continue;
      const p = pointOnSide(node.type, size, side);
      port.setAttribute('cx', String(p.x));
      port.setAttribute('cy', String(p.y));
    }
  }

  /** Resolves the side each edge uses at both ends and fans out the edges that share a side. */
  private layoutEdges(): EdgeLayout[] {
    const layouts: EdgeLayout[] = [];
    for (const edge of this.graph.edgeList) {
      const source = this.graph.getNode(edge.source);
      const target = this.graph.getNode(edge.target);
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

  /** Points the edge passes through, from the source outline to the target outline. */
  private routeOf(layout: EdgeLayout): Point[] {
    const { edge, source, target } = layout;
    if (this.graph.edgeStyle === 'orthogonal') {
      return orthogonalRoute(
        this.anchor(source, layout.sourceSide, layout.sourceOffset),
        this.anchor(target, layout.targetSide, layout.targetOffset),
      );
    }
    // Straight: a fixed side starts at its handle; an automatic one aims at the other end and is trimmed at the outline.
    let start: Point = edge.sourceSide ? this.anchor(source, layout.sourceSide, layout.sourceOffset) : source;
    let end: Point = edge.targetSide ? this.anchor(target, layout.targetSide, layout.targetOffset) : target;
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const ux = (end.x - start.x) / length;
    const uy = (end.y - start.y) / length;
    if (!edge.sourceSide) {
      const gap = boundaryDistance(source.type, this.sizeOf(source.id), ux, uy) + 1;
      start = { x: source.x + ux * gap, y: source.y + uy * gap };
    }
    if (!edge.targetSide) {
      const gap = boundaryDistance(target.type, this.sizeOf(target.id), ux, uy) + 1;
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

  private createEdgeEl(id: EdgeId): SVGGElement {
    const group = createSvg('g', { class: 'edge', 'data-id': id });
    group.append(
      createSvg('path', { class: 'edge-hit' }),
      createSvg('path', { class: 'edge-line' }),
      createSvg('text', { class: 'edge-label' }),
    );
    return group;
  }

  private updateEdgeEl(el: SVGGElement, layout: EdgeLayout): void {
    const { edge } = layout;
    const selected = this.current?.kind === 'edge' && this.current.id === edge.id;
    el.classList.toggle('selected', selected);

    const points = this.routeOf(layout);
    const d = roundedPath(points, this.graph.edgeStyle === 'orthogonal' ? ELBOW_RADIUS : 0);
    for (const path of el.querySelectorAll('path')) path.setAttribute('d', d);

    const visible = el.querySelector<SVGPathElement>('.edge-line');
    if (visible) {
      if (this.graph.directed) visible.setAttribute('marker-end', selected ? 'url(#arrow-selected)' : 'url(#arrow)');
      else visible.removeAttribute('marker-end');
    }

    const label = el.querySelector<SVGTextElement>('.edge-label');
    if (label) {
      if (label.textContent !== edge.label) label.textContent = edge.label;
      const at = labelAnchor(points);
      label.setAttribute('x', String(at.x));
      label.setAttribute('y', String(at.y));
    }
  }
}

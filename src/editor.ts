import { Graph, type EdgeId, type GraphEdge, type GraphNode, type NodeId } from './graph';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Node box, in canvas units. The width grows with the label; the height is fixed. */
export const NODE_HEIGHT = 40;
export const NODE_MIN_WIDTH = 72;
const NODE_PADDING_X = 14;
const NODE_CORNER = 8;
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const GRID_SIZE = 24;
const LABEL_OFFSET = 12;

/** A selected element: a node or an edge. */
export type Selected = { kind: 'node'; id: NodeId } | { kind: 'edge'; id: EdgeId };
export type Selection = Selected | null;

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

/** Gesture in progress: what the pointer is doing between pointerdown and pointerup. */
type Gesture =
  | { kind: 'none' }
  | { kind: 'drag-node'; id: NodeId; offsetX: number; offsetY: number }
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'connect'; source: NodeId };

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

/** Distance from the centre of a box to its border along the unit direction (ux, uy). */
function boundaryDistance(size: Size, ux: number, uy: number): number {
  const alongX = ux === 0 ? Infinity : size.width / 2 / Math.abs(ux);
  const alongY = uy === 0 ? Infinity : size.height / 2 / Math.abs(uy);
  return Math.min(alongX, alongY);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
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

  /** With connect mode on, dragging from a node creates an edge instead of moving it. */
  set connectMode(value: boolean) {
    this.connect = value;
    this.container.classList.toggle('connect-mode', value);
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
    for (const edge of this.graph.edgeList) {
      const source = this.graph.getNode(edge.source);
      const target = this.graph.getNode(edge.target);
      if (!source || !target) continue;
      liveEdges.add(edge.id);
      let el = this.edgeEls.get(edge.id);
      if (!el) {
        el = this.createEdgeEl(edge.id);
        this.edgeEls.set(edge.id, el);
        this.edgeLayer.append(el);
      }
      this.updateEdgeEl(el, edge, source, target);
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

    if (e.button === 0 && nodeEl && nodeId) {
      const node = this.graph.getNode(nodeId);
      if (!node) return;
      const point = this.toWorld(e.clientX, e.clientY);
      this.select({ kind: 'node', id: nodeId });
      if (this.connect || e.shiftKey) {
        this.gesture = { kind: 'connect', source: nodeId };
        this.updatePreview(node, point);
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
      if (source) this.updatePreview(source, point);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const gesture = this.gesture;
    this.gesture = { kind: 'none' };
    this.hidePreview();
    if (gesture.kind !== 'connect') return;
    // While captured, e.target is the source node, so look at what is really under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const targetId = hit?.closest<SVGGElement>('.node')?.dataset.id;
    if (!targetId || targetId === gesture.source) return;
    const edge = this.graph.addEdge(gesture.source, targetId) ?? this.graph.findEdge(gesture.source, targetId);
    if (edge) this.select({ kind: 'edge', id: edge.id });
  };

  private readonly onPointerCancel = (): void => {
    this.gesture = { kind: 'none' };
    this.hidePreview();
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
      this.gesture = { kind: 'none' };
      this.hidePreview();
      this.select(null);
    }
  };

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

  private updatePreview(source: GraphNode, to: Point): void {
    this.preview.setAttribute('x1', String(source.x));
    this.preview.setAttribute('y1', String(source.y));
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
    return this.nodeSizes.get(id) ?? { width: NODE_MIN_WIDTH, height: NODE_HEIGHT };
  }

  private createNodeEl(id: NodeId): SVGGElement {
    const group = createSvg('g', { class: 'node', 'data-id': id });
    group.append(createSvg('rect', { rx: NODE_CORNER, ry: NODE_CORNER }), createSvg('text'));
    return group;
  }

  private updateNodeEl(el: SVGGElement, node: GraphNode): void {
    el.setAttribute('transform', `translate(${node.x} ${node.y})`);
    el.classList.toggle('selected', this.current?.kind === 'node' && this.current.id === node.id);
    const text = el.querySelector('text');
    const box = el.querySelector('rect');
    if (!text || !box) return;
    if (text.textContent === node.label && this.nodeSizes.has(node.id)) return;
    // Measuring the text forces a layout, so the box is only resized when the label changes.
    text.textContent = node.label;
    const width = Math.max(NODE_MIN_WIDTH, Math.ceil(text.getComputedTextLength()) + 2 * NODE_PADDING_X);
    this.nodeSizes.set(node.id, { width, height: NODE_HEIGHT });
    box.setAttribute('x', String(-width / 2));
    box.setAttribute('y', String(-NODE_HEIGHT / 2));
    box.setAttribute('width', String(width));
    box.setAttribute('height', String(NODE_HEIGHT));
  }

  private createEdgeEl(id: EdgeId): SVGGElement {
    const group = createSvg('g', { class: 'edge', 'data-id': id });
    group.append(
      createSvg('line', { class: 'edge-hit' }),
      createSvg('line', { class: 'edge-line' }),
      createSvg('text', { class: 'edge-label' }),
    );
    return group;
  }

  private updateEdgeEl(el: SVGGElement, edge: GraphEdge, source: GraphNode, target: GraphNode): void {
    const selected = this.current?.kind === 'edge' && this.current.id === edge.id;
    el.classList.toggle('selected', selected);

    // The line is trimmed at the border of each box so the arrowhead stays visible.
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const startGap = boundaryDistance(this.sizeOf(source.id), ux, uy) + 1;
    const endGap = boundaryDistance(this.sizeOf(target.id), ux, uy) + 1;
    const x1 = source.x + ux * startGap;
    const y1 = source.y + uy * startGap;
    const x2 = target.x - ux * endGap;
    const y2 = target.y - uy * endGap;

    for (const line of el.querySelectorAll('line')) {
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
    }

    const visible = el.querySelector<SVGLineElement>('.edge-line');
    if (visible) {
      if (this.graph.directed) visible.setAttribute('marker-end', selected ? 'url(#arrow-selected)' : 'url(#arrow)');
      else visible.removeAttribute('marker-end');
    }

    const label = el.querySelector<SVGTextElement>('.edge-label');
    if (label) {
      if (label.textContent !== edge.label) label.textContent = edge.label;
      label.setAttribute('x', String((x1 + x2) / 2 - uy * LABEL_OFFSET));
      label.setAttribute('y', String((y1 + y2) / 2 + ux * LABEL_OFFSET));
    }
  }
}

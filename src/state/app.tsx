import { batch, createContext, createEffect, createMemo, createSignal, useContext, type Accessor, type JSX } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Graph, type EdgeId, type EdgeStyle, type GraphEdge, type GraphNode, type NodeId, type NodeType } from '../model/graph';
import { shapeSize, type Point, type Size } from '../model/shapes';
import { layoutEdges, type EdgeLayout } from '../model/layout';

/**
 * Application state: a reactive view over the framework-free `Graph`, plus
 * everything the editor needs that is not part of the document (selection,
 * modes, camera, measured node sizes). Provided to components through context.
 */

/** A selected element: a node or an edge. */
export type Selected = { kind: 'node'; id: NodeId } | { kind: 'edge'; id: EdgeId };
export type Selection = Selected | null;

/** Camera: canvas units are scaled by `scale` and shifted by (tx, ty) screen pixels. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** Dashed line shown while an edge is being dragged out of a node. */
export interface PreviewLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

export interface AppState {
  readonly graph: Graph;
  /** Bumps on every graph change. Read it inside a computation to re-run when the graph mutates in place. */
  revision: Accessor<number>;
  nodes: Accessor<GraphNode[]>;
  edges: Accessor<GraphEdge[]>;
  directed: Accessor<boolean>;
  edgeStyle: Accessor<EdgeStyle>;
  nodeCount: Accessor<number>;
  edgeCount: Accessor<number>;
  layoutOf(id: EdgeId): EdgeLayout | undefined;
  /** Measured box of a drawn node, or the box its label-less shape would have. */
  sizeOf(node: GraphNode): Size;
  setSize(id: NodeId, size: Size): void;

  selection: Accessor<Selection>;
  select(selection: Selection): void;
  deleteSelection(): void;
  /** Counter bumped when the user asks to edit the selection in place (double-click, add node). */
  editRequest: Accessor<number>;
  requestEdit(): void;

  connectMode: Accessor<boolean>;
  setConnectMode(on: boolean): void;
  /** True while an edge is being dragged out of a node. */
  connecting: Accessor<boolean>;
  setConnecting(on: boolean): void;
  preview: Accessor<PreviewLine | null>;
  setPreview(line: PreviewLine | null): void;
  /** Node drawn last, i.e. on top of the others. */
  frontNode: Accessor<NodeId | null>;
  setFrontNode(id: NodeId | null): void;

  view: Accessor<View>;
  setView(view: View): void;
  registerCanvas(el: SVGSVGElement): void;
  toWorld(clientX: number, clientY: number): Point;
  viewCenter(): Point;
  zoomAt(clientX: number, clientY: number, deltaY: number): void;
  fitView(): void;
  revealNode(id: NodeId): void;
  addNodeAt(point: Point, type?: NodeType): GraphNode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createAppState(graph: Graph): AppState {
  const [revision, setRevision] = createSignal(0);
  graph.onChange(() => setRevision((v) => v + 1));

  // The graph mutates its objects in place, so these memos return fresh arrays of the same objects:
  // <For> keeps the DOM of each node and edge, and only what reads a changed field updates.
  const nodes = createMemo(() => (revision(), graph.nodeList));
  const edges = createMemo(() => (revision(), graph.edgeList));
  const directed = createMemo(() => (revision(), graph.directed));
  const edgeStyle = createMemo(() => (revision(), graph.edgeStyle));
  const nodeCount = createMemo(() => nodes().length);
  const edgeCount = createMemo(() => edges().length);

  const [sizes, setSizes] = createStore<Record<NodeId, Size>>({});
  const sizeOf = (node: GraphNode): Size => sizes[node.id] ?? shapeSize(node.type, 0);
  const setSize = (id: NodeId, size: Size): void => {
    const current = sizes[id];
    if (current && current.width === size.width && current.height === size.height) return;
    setSizes(id, size);
  };
  // Forget the size of nodes that no longer exist.
  createEffect(() => {
    const live = new Set(nodes().map((node) => node.id));
    const stale = Object.keys(sizes).filter((id) => !live.has(id));
    if (stale.length > 0) {
      setSizes(
        produce((draft) => {
          for (const id of stale) delete draft[id];
        }),
      );
    }
  });

  const layoutMap = createMemo(() => {
    const map = new Map<EdgeId, EdgeLayout>();
    for (const layout of layoutEdges(nodes(), edges())) map.set(layout.edge.id, layout);
    return map;
  });
  const layoutOf = (id: EdgeId): EdgeLayout | undefined => layoutMap().get(id);

  const [selection, setSelection] = createSignal<Selection>(null);
  const select = (next: Selection): void => {
    const current = selection();
    if (next?.kind === current?.kind && next?.id === current?.id) return;
    setSelection(next);
  };
  // Clear the selection when its element disappears.
  createEffect(() => {
    const selected = selection();
    if (!selected) return;
    revision();
    const exists = selected.kind === 'node' ? graph.getNode(selected.id) : graph.getEdge(selected.id);
    if (!exists) setSelection(null);
  });
  const deleteSelection = (): void => {
    const selected = selection();
    if (!selected) return;
    batch(() => {
      setSelection(null);
      if (selected.kind === 'node') graph.removeNode(selected.id);
      else graph.removeEdge(selected.id);
    });
  };
  const [editRequest, setEditRequest] = createSignal(0);
  const requestEdit = (): void => {
    setEditRequest((n) => n + 1);
  };

  const [connectMode, setConnectMode] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [preview, setPreview] = createSignal<PreviewLine | null>(null);
  const [frontNode, setFrontNode] = createSignal<NodeId | null>(null);
  const [view, setView] = createSignal<View>({ scale: 1, tx: 0, ty: 0 });

  let canvas: SVGSVGElement | null = null;
  const canvasRect = (): DOMRect => canvas?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
  const registerCanvas = (el: SVGSVGElement): void => {
    canvas = el;
  };

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = canvasRect();
    const v = view();
    return { x: (clientX - rect.left - v.tx) / v.scale, y: (clientY - rect.top - v.ty) / v.scale };
  };

  const viewCenter = (): Point => {
    const rect = canvasRect();
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const zoomAt = (clientX: number, clientY: number, deltaY: number): void => {
    const rect = canvasRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const v = view();
    const next = clamp(v.scale * Math.exp(-deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
    const ratio = next / v.scale;
    // The canvas point under the cursor stays where it is.
    setView({ scale: next, tx: mouseX - (mouseX - v.tx) * ratio, ty: mouseY - (mouseY - v.ty) * ratio });
  };

  /** Fits every node in the canvas, without zooming in beyond scale 1. */
  const fitView = (padding = 48): void => {
    const list = graph.nodeList;
    const { width, height } = canvasRect();
    if (list.length === 0) {
      setView({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of list) {
      const { width: w, height: h } = sizeOf(node);
      minX = Math.min(minX, node.x - w / 2);
      minY = Math.min(minY, node.y - h / 2);
      maxX = Math.max(maxX, node.x + w / 2);
      maxY = Math.max(maxY, node.y + h / 2);
    }
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const fit = Math.min((width - 2 * padding) / contentWidth, (height - 2 * padding) / contentHeight, 1);
    const scale = clamp(fit, MIN_SCALE, MAX_SCALE);
    setView({
      scale,
      tx: (width - contentWidth * scale) / 2 - minX * scale,
      ty: (height - contentHeight * scale) / 2 - minY * scale,
    });
  };

  /** Pans so the node is visible, keeping the current zoom. Does nothing if it is already in view. */
  const revealNode = (id: NodeId): void => {
    const node = graph.getNode(id);
    if (!node) return;
    const { width, height } = canvasRect();
    const v = view();
    const screenX = node.x * v.scale + v.tx;
    const screenY = node.y * v.scale + v.ty;
    const size = sizeOf(node);
    const marginX = (size.width / 2) * v.scale + 8;
    const marginY = (size.height / 2) * v.scale + 8;
    if (screenX >= marginX && screenX <= width - marginX && screenY >= marginY && screenY <= height - marginY) return;
    setView({ scale: v.scale, tx: width / 2 - node.x * v.scale, ty: height / 2 - node.y * v.scale });
  };

  const addNodeAt = (point: Point, type?: NodeType): GraphNode => {
    const node = graph.addNode(point.x, point.y, undefined, type);
    select({ kind: 'node', id: node.id });
    return node;
  };

  return {
    graph,
    revision,
    nodes,
    edges,
    directed,
    edgeStyle,
    nodeCount,
    edgeCount,
    layoutOf,
    sizeOf,
    setSize,
    selection,
    select,
    deleteSelection,
    editRequest,
    requestEdit,
    connectMode,
    setConnectMode,
    connecting,
    setConnecting,
    preview,
    setPreview,
    frontNode,
    setFrontNode,
    view,
    setView,
    registerCanvas,
    toWorld,
    viewCenter,
    zoomAt,
    fitView,
    revealNode,
    addNodeAt,
  };
}

const AppContext = createContext<AppState>();

export function AppProvider(props: { state: AppState; children: JSX.Element }) {
  return <AppContext.Provider value={props.state}>{props.children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('useApp must be called inside an AppProvider');
  return state;
}

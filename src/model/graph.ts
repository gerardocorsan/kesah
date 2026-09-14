export type NodeId = string;
export type EdgeId = string;

/** BPMN element drawn for a node, in palette order. */
export type NodeType =
  | 'start-event'
  | 'intermediate-event'
  | 'end-event'
  | 'task'
  | 'subprocess'
  | 'gateway'
  | 'annotation'
  | 'data-object';
export const NODE_TYPES: readonly NodeType[] = [
  'start-event',
  'intermediate-event',
  'end-event',
  'task',
  'subprocess',
  'gateway',
  'annotation',
  'data-object',
];
export const DEFAULT_NODE_TYPE: NodeType = 'task';

/**
 * Variants a type can take: the trigger or result of an event, the type of a task,
 * the kind of a gateway. Types without variants always use 'none'.
 */
export const NODE_VARIANTS: Record<NodeType, readonly string[]> = {
  'start-event': ['none', 'message', 'timer'],
  'intermediate-event': ['none', 'message', 'timer'],
  'end-event': ['none', 'message', 'terminate'],
  task: ['none', 'user', 'service', 'script'],
  subprocess: [],
  gateway: ['exclusive', 'parallel', 'inclusive'],
  annotation: [],
  'data-object': [],
};

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

export function defaultVariant(type: NodeType): string {
  return NODE_VARIANTS[type][0] ?? 'none';
}

export function isVariantOf(type: NodeType, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const variants = NODE_VARIANTS[type];
  return variants.length === 0 ? value === 'none' : variants.includes(value);
}

/** Types of the flowchart notation Kesah started with, mapped onto BPMN elements when an old file is loaded. */
const LEGACY_TYPES: Record<string, NodeType> = {
  terminal: 'start-event',
  process: 'task',
  decision: 'gateway',
  io: 'data-object',
};

/** The BPMN type for a stored type value: current names, legacy flowchart names, or the default. */
export function resolveNodeType(value: unknown): NodeType {
  if (isNodeType(value)) return value;
  if (typeof value === 'string' && Object.hasOwn(LEGACY_TYPES, value)) return LEGACY_TYPES[value];
  return DEFAULT_NODE_TYPE;
}

/** Side of a node through which an edge leaves or enters. */
export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export function isSide(value: unknown): value is Side {
  return typeof value === 'string' && (SIDES as readonly string[]).includes(value);
}

/** How edges are drawn: one straight segment, or axis-aligned segments joined by elbows. */
export type EdgeStyle = 'straight' | 'orthogonal';

/** BPMN connection drawn for an edge. */
export type EdgeKind = 'sequence' | 'message' | 'association';
export const EDGE_KINDS: readonly EdgeKind[] = ['sequence', 'message', 'association'];

export function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === 'string' && (EDGE_KINDS as readonly string[]).includes(value);
}

/** Marker at the source of a sequence flow: none, the default path out of a gateway, or a conditional path. */
export type FlowCondition = 'none' | 'default' | 'conditional';
export const FLOW_CONDITIONS: readonly FlowCondition[] = ['none', 'default', 'conditional'];

export function isFlowCondition(value: unknown): value is FlowCondition {
  return typeof value === 'string' && (FLOW_CONDITIONS as readonly string[]).includes(value);
}

export interface GraphNode {
  id: NodeId;
  label: string;
  type: NodeType;
  variant: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  label: string;
  kind: EdgeKind;
  /** Only meaningful for sequence flows; always 'none' otherwise. */
  condition: FlowCondition;
  /** Side of the source node the edge leaves through; chosen automatically when absent. */
  sourceSide?: Side;
  /** Side of the target node the edge enters through; chosen automatically when absent. */
  targetSide?: Side;
}

export interface EdgeOptions {
  sourceSide?: Side;
  targetSide?: Side;
  kind?: EdgeKind;
  condition?: FlowCondition;
}

/** Interchange format: what gets exported to and imported from JSON. */
export interface GraphData {
  /** Kept for files written when the notation had undirected graphs; the BPMN view ignores it. */
  directed: boolean;
  edgeStyle: EdgeStyle;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type Listener = () => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Highest numeric suffix among ids with the given prefix (n1, n2, …), so numbering can continue without repeats. */
function maxSequence(ids: Iterable<string>, prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * Graph model. Knows nothing about the DOM: it stores nodes and edges and
 * notifies subscribers whenever something changes.
 */
export class Graph {
  private directedFlag = true;
  private edgeStyleValue: EdgeStyle = 'orthogonal';
  private readonly nodes = new Map<NodeId, GraphNode>();
  private readonly edges = new Map<EdgeId, GraphEdge>();
  private readonly listeners = new Set<Listener>();
  private nodeSeq = 0;
  private edgeSeq = 0;

  get directed(): boolean {
    return this.directedFlag;
  }

  get edgeStyle(): EdgeStyle {
    return this.edgeStyleValue;
  }

  get nodeList(): GraphNode[] {
    return [...this.nodes.values()];
  }

  get edgeList(): GraphEdge[] {
    return [...this.edges.values()];
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  getNode(id: NodeId): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: EdgeId): GraphEdge | undefined {
    return this.edges.get(id);
  }

  /** Subscribes a listener to every change. Returns the unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setDirected(directed: boolean): void {
    if (this.directedFlag === directed) return;
    this.directedFlag = directed;
    this.emit();
  }

  setEdgeStyle(style: EdgeStyle): void {
    if (this.edgeStyleValue === style) return;
    this.edgeStyleValue = style;
    this.emit();
  }

  addNode(x: number, y: number, label?: string, type: NodeType = DEFAULT_NODE_TYPE, variant?: string): GraphNode {
    let id: NodeId;
    do {
      id = `n${++this.nodeSeq}`;
    } while (this.nodes.has(id));
    const node: GraphNode = {
      id,
      label: label ?? String(this.nodeSeq),
      type,
      variant: isVariantOf(type, variant) ? variant : defaultVariant(type),
      x,
      y,
    };
    this.nodes.set(id, node);
    this.emit();
    return node;
  }

  /** Changes the element type; the variant is kept when the new type accepts it and reset otherwise. */
  setNodeType(id: NodeId, type: NodeType): void {
    const node = this.nodes.get(id);
    if (!node || node.type === type) return;
    node.type = type;
    if (!isVariantOf(type, node.variant)) node.variant = defaultVariant(type);
    this.emit();
  }

  /** Sets the variant if the node's type accepts it; ignored otherwise. */
  setNodeVariant(id: NodeId, variant: string): void {
    const node = this.nodes.get(id);
    if (!node || node.variant === variant || !isVariantOf(node.type, variant)) return;
    node.variant = variant;
    this.emit();
  }

  moveNode(id: NodeId, x: number, y: number): void {
    const node = this.nodes.get(id);
    if (!node || (node.x === x && node.y === y)) return;
    node.x = x;
    node.y = y;
    this.emit();
  }

  setNodeLabel(id: NodeId, label: string): void {
    const node = this.nodes.get(id);
    if (!node || node.label === label) return;
    node.label = label;
    this.emit();
  }

  /** Removes the node together with every edge that touches it. */
  removeNode(id: NodeId): void {
    if (!this.nodes.delete(id)) return;
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) this.edges.delete(edgeId);
    }
    this.emit();
  }

  /** First edge joining source and target, if any. In undirected graphs either direction counts. */
  findEdge(source: NodeId, target: NodeId): GraphEdge | undefined {
    for (const edge of this.edges.values()) {
      if (edge.source === source && edge.target === target) return edge;
      if (!this.directedFlag && edge.source === target && edge.target === source) return edge;
    }
    return undefined;
  }

  /**
   * Creates an edge. Returns null for self-loops or missing nodes. Several
   * edges may join the same two nodes; they are told apart by their sides.
   */
  addEdge(source: NodeId, target: NodeId, label = '', options: EdgeOptions = {}): GraphEdge | null {
    if (source === target || !this.nodes.has(source) || !this.nodes.has(target)) return null;
    let id: EdgeId;
    do {
      id = `e${++this.edgeSeq}`;
    } while (this.edges.has(id));
    const kind = options.kind ?? 'sequence';
    const edge: GraphEdge = {
      id,
      source,
      target,
      label,
      kind,
      condition: kind === 'sequence' ? (options.condition ?? 'none') : 'none',
    };
    if (options.sourceSide) edge.sourceSide = options.sourceSide;
    if (options.targetSide) edge.targetSide = options.targetSide;
    this.edges.set(id, edge);
    this.emit();
    return edge;
  }

  setEdgeLabel(id: EdgeId, label: string): void {
    const edge = this.edges.get(id);
    if (!edge || edge.label === label) return;
    edge.label = label;
    this.emit();
  }

  /** Changes the connection kind. Leaving the sequence kind drops the flow condition. */
  setEdgeKind(id: EdgeId, kind: EdgeKind): void {
    const edge = this.edges.get(id);
    if (!edge || edge.kind === kind) return;
    edge.kind = kind;
    if (kind !== 'sequence') edge.condition = 'none';
    this.emit();
  }

  /** Sets the flow condition of a sequence flow; ignored for other kinds. */
  setEdgeCondition(id: EdgeId, condition: FlowCondition): void {
    const edge = this.edges.get(id);
    if (!edge || edge.kind !== 'sequence' || edge.condition === condition) return;
    edge.condition = condition;
    this.emit();
  }

  /** Fixes the side used at one end of the edge, or clears it (undefined) to pick it automatically. */
  setEdgeSide(id: EdgeId, end: 'source' | 'target', side: Side | undefined): void {
    const edge = this.edges.get(id);
    if (!edge) return;
    const key = end === 'source' ? 'sourceSide' : 'targetSide';
    if (edge[key] === side) return;
    if (side) edge[key] = side;
    else delete edge[key];
    this.emit();
  }

  removeEdge(id: EdgeId): void {
    if (!this.edges.delete(id)) return;
    this.emit();
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.nodeSeq = 0;
    this.edgeSeq = 0;
    this.emit();
  }

  toJSON(): GraphData {
    return {
      directed: this.directedFlag,
      edgeStyle: this.edgeStyleValue,
      nodes: this.nodeList.map((node) => ({ ...node })),
      edges: this.edgeList.map((edge) => ({ ...edge })),
    };
  }

  /** Replaces the whole content with `data` (already validated with `Graph.parse`). */
  load(data: GraphData): void {
    this.nodes.clear();
    this.edges.clear();
    this.directedFlag = data.directed;
    this.edgeStyleValue = data.edgeStyle;
    for (const node of data.nodes) this.nodes.set(node.id, { ...node });
    for (const edge of data.edges) this.edges.set(edge.id, { ...edge });
    this.nodeSeq = maxSequence(this.nodes.keys(), 'n');
    this.edgeSeq = maxSequence(this.edges.keys(), 'e');
    this.emit();
  }

  /**
   * Validates an unknown value (for example imported JSON) and turns it into
   * sanitized GraphData: malformed or duplicated nodes are dropped, as are
   * edges pointing at missing nodes. Flowchart-era types are mapped onto BPMN
   * elements, unknown types and variants take defaults, a missing edge kind is
   * a sequence flow, and a missing edge style means straight lines, so files
   * written before those fields existed still load. Throws if the basic
   * shape is wrong.
   */
  static parse(value: unknown): GraphData {
    if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
      throw new Error('The JSON must be an object with "nodes" and "edges" arrays.');
    }

    const nodes: GraphNode[] = [];
    const nodeIds = new Set<NodeId>();
    for (const raw of value.nodes) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || nodeIds.has(raw.id)) continue;
      if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) continue;
      nodeIds.add(raw.id);
      const type = resolveNodeType(raw.type);
      nodes.push({
        id: raw.id,
        label: typeof raw.label === 'string' ? raw.label : raw.id,
        type,
        variant: isVariantOf(type, raw.variant) ? raw.variant : defaultVariant(type),
        x: raw.x,
        y: raw.y,
      });
    }

    const edges: GraphEdge[] = [];
    const edgeIds = new Set<EdgeId>();
    for (const raw of value.edges) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || edgeIds.has(raw.id)) continue;
      if (typeof raw.source !== 'string' || typeof raw.target !== 'string') continue;
      if (raw.source === raw.target || !nodeIds.has(raw.source) || !nodeIds.has(raw.target)) continue;
      edgeIds.add(raw.id);
      const kind = isEdgeKind(raw.kind) ? raw.kind : 'sequence';
      const edge: GraphEdge = {
        id: raw.id,
        source: raw.source,
        target: raw.target,
        label: typeof raw.label === 'string' ? raw.label : '',
        kind,
        condition: kind === 'sequence' && isFlowCondition(raw.condition) ? raw.condition : 'none',
      };
      if (isSide(raw.sourceSide)) edge.sourceSide = raw.sourceSide;
      if (isSide(raw.targetSide)) edge.targetSide = raw.targetSide;
      edges.push(edge);
    }

    return {
      directed: value.directed !== false,
      edgeStyle: value.edgeStyle === 'orthogonal' ? 'orthogonal' : 'straight',
      nodes,
      edges,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

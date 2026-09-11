export type NodeId = string;
export type EdgeId = string;

/** Flowchart symbol drawn for a node. */
export type NodeType = 'terminal' | 'process' | 'decision' | 'io';
export const NODE_TYPES: readonly NodeType[] = ['terminal', 'process', 'decision', 'io'];
export const DEFAULT_NODE_TYPE: NodeType = 'process';

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

export interface GraphNode {
  id: NodeId;
  label: string;
  type: NodeType;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  label: string;
}

/** Interchange format: what gets exported to and imported from JSON. */
export interface GraphData {
  directed: boolean;
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
  private readonly nodes = new Map<NodeId, GraphNode>();
  private readonly edges = new Map<EdgeId, GraphEdge>();
  private readonly listeners = new Set<Listener>();
  private nodeSeq = 0;
  private edgeSeq = 0;

  get directed(): boolean {
    return this.directedFlag;
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

  addNode(x: number, y: number, label?: string, type: NodeType = DEFAULT_NODE_TYPE): GraphNode {
    let id: NodeId;
    do {
      id = `n${++this.nodeSeq}`;
    } while (this.nodes.has(id));
    const node: GraphNode = { id, label: label ?? String(this.nodeSeq), type, x, y };
    this.nodes.set(id, node);
    this.emit();
    return node;
  }

  setNodeType(id: NodeId, type: NodeType): void {
    const node = this.nodes.get(id);
    if (!node || node.type === type) return;
    node.type = type;
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

  /** Edge joining source and target, if any. In undirected graphs either direction counts. */
  findEdge(source: NodeId, target: NodeId): GraphEdge | undefined {
    for (const edge of this.edges.values()) {
      if (edge.source === source && edge.target === target) return edge;
      if (!this.directedFlag && edge.source === target && edge.target === source) return edge;
    }
    return undefined;
  }

  /** Creates an edge. Returns null for self-loops, missing nodes or an edge that already exists. */
  addEdge(source: NodeId, target: NodeId, label = ''): GraphEdge | null {
    if (source === target || !this.nodes.has(source) || !this.nodes.has(target)) return null;
    if (this.findEdge(source, target)) return null;
    let id: EdgeId;
    do {
      id = `e${++this.edgeSeq}`;
    } while (this.edges.has(id));
    const edge: GraphEdge = { id, source, target, label };
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
      nodes: this.nodeList.map((node) => ({ ...node })),
      edges: this.edgeList.map((edge) => ({ ...edge })),
    };
  }

  /** Replaces the whole content with `data` (already validated with `Graph.parse`). */
  load(data: GraphData): void {
    this.nodes.clear();
    this.edges.clear();
    this.directedFlag = data.directed;
    for (const node of data.nodes) this.nodes.set(node.id, { ...node });
    for (const edge of data.edges) this.edges.set(edge.id, { ...edge });
    this.nodeSeq = maxSequence(this.nodes.keys(), 'n');
    this.edgeSeq = maxSequence(this.edges.keys(), 'e');
    this.emit();
  }

  /**
   * Validates an unknown value (for example imported JSON) and turns it into
   * sanitized GraphData: malformed or duplicated nodes are dropped, as are
   * edges pointing at missing nodes. A missing or unknown node type becomes
   * the default one, so files written before types existed still load.
   * Throws if the basic shape is wrong.
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
      nodes.push({
        id: raw.id,
        label: typeof raw.label === 'string' ? raw.label : raw.id,
        type: isNodeType(raw.type) ? raw.type : DEFAULT_NODE_TYPE,
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
      edges.push({
        id: raw.id,
        source: raw.source,
        target: raw.target,
        label: typeof raw.label === 'string' ? raw.label : '',
      });
    }

    return { directed: value.directed !== false, nodes, edges };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

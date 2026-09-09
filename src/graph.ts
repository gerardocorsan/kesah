export type NodeId = string;
export type EdgeId = string;

export interface GraphNode {
  id: NodeId;
  label: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: EdgeId;
  source: NodeId;
  target: NodeId;
  label: string;
}

/** Formato de intercambio: lo que se exporta e importa como JSON. */
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

/** Mayor sufijo numérico entre los ids con el prefijo dado (n1, n2, …), para seguir numerando sin repetir. */
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
 * Modelo del grafo. No sabe nada del DOM: guarda nodos y aristas y avisa
 * a quien esté suscrito cada vez que algo cambia.
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

  /** Suscribe un oyente a cualquier cambio. Devuelve la función para desuscribirse. */
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

  addNode(x: number, y: number, label?: string): GraphNode {
    let id: NodeId;
    do {
      id = `n${++this.nodeSeq}`;
    } while (this.nodes.has(id));
    const node: GraphNode = { id, label: label ?? String(this.nodeSeq), x, y };
    this.nodes.set(id, node);
    this.emit();
    return node;
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

  /** Borra el nodo y todas las aristas que lo tocan. */
  removeNode(id: NodeId): void {
    if (!this.nodes.delete(id)) return;
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) this.edges.delete(edgeId);
    }
    this.emit();
  }

  /** Arista que une source con target, si existe. En grafos no dirigidos vale en cualquier sentido. */
  findEdge(source: NodeId, target: NodeId): GraphEdge | undefined {
    for (const edge of this.edges.values()) {
      if (edge.source === source && edge.target === target) return edge;
      if (!this.directedFlag && edge.source === target && edge.target === source) return edge;
    }
    return undefined;
  }

  /** Crea una arista. Devuelve null si sería un bucle, si falta algún nodo o si ya existía. */
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

  /** Sustituye todo el contenido por `data` (ya validado con `Graph.parse`). */
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
   * Valida un valor desconocido (por ejemplo JSON importado) y lo convierte en
   * GraphData saneado: descarta nodos mal formados o repetidos y aristas
   * que apunten a nodos inexistentes. Lanza un error si ni siquiera tiene la forma básica.
   */
  static parse(value: unknown): GraphData {
    if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
      throw new Error('El JSON debe ser un objeto con las listas "nodes" y "edges".');
    }

    const nodes: GraphNode[] = [];
    const nodeIds = new Set<NodeId>();
    for (const raw of value.nodes) {
      if (!isRecord(raw) || typeof raw.id !== 'string' || nodeIds.has(raw.id)) continue;
      if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) continue;
      nodeIds.add(raw.id);
      nodes.push({ id: raw.id, label: typeof raw.label === 'string' ? raw.label : raw.id, x: raw.x, y: raw.y });
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

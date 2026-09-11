import { Graph, type GraphData } from './graph';

type Listener = () => void;

/**
 * Undo/redo for a Graph, based on snapshots of its JSON form. Every change
 * becomes one step, unless it happens inside a transaction: then all the
 * changes made until the transaction is committed count as one step (a drag,
 * typing a name). Small graphs make whole snapshots cheap and simple.
 */
export class History {
  private past: GraphData[] = [];
  private future: GraphData[] = [];
  private current: GraphData;
  private openTransactions = 0;
  private dirty = false;
  private restoring = false;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly graph: Graph,
    private readonly limit = 100,
  ) {
    this.current = graph.toJSON();
    graph.onChange(() => this.onGraphChange());
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Subscribes to changes of the undo/redo availability. Returns the unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts grouping changes into one step. Transactions nest; the outermost commit records the step. */
  begin(): void {
    this.openTransactions++;
  }

  commit(): void {
    if (this.openTransactions === 0) return;
    this.openTransactions--;
    if (this.openTransactions === 0 && this.dirty) this.record();
  }

  undo(): void {
    const snapshot = this.past.pop();
    if (!snapshot) return;
    this.future.push(this.current);
    this.restore(snapshot);
  }

  redo(): void {
    const snapshot = this.future.pop();
    if (!snapshot) return;
    this.past.push(this.current);
    this.restore(snapshot);
  }

  private onGraphChange(): void {
    if (this.restoring) return;
    if (this.openTransactions > 0) {
      this.dirty = true;
      return;
    }
    this.record();
  }

  private record(): void {
    this.dirty = false;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = this.graph.toJSON();
    this.future = [];
    this.emit();
  }

  private restore(snapshot: GraphData): void {
    this.restoring = true;
    try {
      this.graph.load(snapshot);
    } finally {
      this.restoring = false;
    }
    this.current = snapshot;
    this.dirty = false;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

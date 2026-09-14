import { render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { Graph } from '../model/graph';
import { AppProvider, createAppState, type AppState } from '../state/app';

type Rendered = ReturnType<typeof render>;

/** Renders a component inside a fresh application state, optionally prepared with a graph. */
export function renderWithApp(ui: () => JSX.Element, prepare?: (graph: Graph) => void): Rendered & { app: AppState; graph: Graph } {
  const graph = new Graph();
  prepare?.(graph);
  let app!: AppState;
  const result = render(() => {
    app = createAppState(graph);
    return <AppProvider state={app}>{ui()}</AppProvider>;
  });
  return { ...result, app, graph };
}

/** A tiny process used by several component tests: A (task, 100×60) → B (exclusive gateway, 50×50), 300 px apart. */
export function seedPair(graph: Graph): { a: string; b: string; edge: string } {
  const a = graph.addNode(0, 0, 'A').id;
  const b = graph.addNode(300, 0, 'B', 'gateway').id;
  const edge = graph.addEdge(a, b, 'Yes');
  if (!edge) throw new Error('edge expected');
  return { a, b, edge: edge.id };
}

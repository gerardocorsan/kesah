import { render } from 'solid-js/web';
import './styles/tokens.css';
import { Graph } from './model/graph';
import { createAppState } from './state/app';
import { App } from './App';

const STORAGE_KEY = 'kesah:graph';

function loadSaved(graph: Graph): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    graph.load(Graph.parse(JSON.parse(raw)));
    return graph.nodeCount > 0;
  } catch (error) {
    console.warn('Could not restore the saved graph', error);
    return false;
  }
}

/** Sample flowchart so the canvas is not empty on the first visit. */
function seedExample(graph: Graph): void {
  const start = graph.addNode(300, 60, 'Start', 'terminal');
  const read = graph.addNode(300, 150, 'Read input', 'io');
  const valid = graph.addNode(300, 250, 'Valid?', 'decision');
  const process = graph.addNode(140, 360, 'Process data', 'process');
  const error = graph.addNode(460, 360, 'Show error', 'process');
  const end = graph.addNode(300, 470, 'End', 'terminal');
  graph.addEdge(start.id, read.id, '', { sourceSide: 'bottom', targetSide: 'top' });
  graph.addEdge(read.id, valid.id, '', { sourceSide: 'bottom', targetSide: 'top' });
  graph.addEdge(valid.id, process.id, 'Yes', { sourceSide: 'left', targetSide: 'top' });
  graph.addEdge(valid.id, error.id, 'No', { sourceSide: 'right', targetSide: 'top' });
  graph.addEdge(process.id, end.id, '', { sourceSide: 'bottom', targetSide: 'left' });
  graph.addEdge(error.id, end.id, '', { sourceSide: 'bottom', targetSide: 'right' });
}

const graph = new Graph();
if (!loadSaved(graph)) seedExample(graph);

let saveTimer: number | undefined;
graph.onChange(() => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph.toJSON()));
    } catch (error) {
      console.warn('Could not save the graph', error);
    }
  }, 300);
});

const root = document.getElementById('app');
if (!root) throw new Error('Missing element #app');

// The state is created inside the render root so its computations have an owner.
render(() => <App state={createAppState(graph)} />, root);

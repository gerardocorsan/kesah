import './style.css';
import { byId } from './dom';
import { Graph } from './graph';
import { GraphEditor } from './editor';
import { setupSidebar } from './sidebar';

const STORAGE_KEY = 'kesah:graph';

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

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

const editor = new GraphEditor(byId('canvas'), graph);
setupSidebar(graph, editor);

const btnNew = byId<HTMLButtonElement>('btn-new');
const chkDirected = byId<HTMLInputElement>('chk-directed');
const chkOrthogonal = byId<HTMLInputElement>('chk-orthogonal');
const btnFit = byId<HTMLButtonElement>('btn-fit');
const btnExport = byId<HTMLButtonElement>('btn-export');
const fileImport = byId<HTMLInputElement>('file-import');
const status = byId<HTMLElement>('status');

let saveTimer: number | undefined;
function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph.toJSON()));
    } catch (error) {
      console.warn('Could not save the graph', error);
    }
  }, 300);
}

function refresh(): void {
  status.textContent = `${count(graph.nodeCount, 'node', 'nodes')} · ${count(graph.edgeCount, 'edge', 'edges')}`;
  chkDirected.checked = graph.directed;
  chkOrthogonal.checked = graph.edgeStyle === 'orthogonal';
}

graph.onChange(() => {
  refresh();
  scheduleSave();
});

btnNew.addEventListener('click', () => {
  if (graph.nodeCount > 0 && !window.confirm('Discard the current graph and start over?')) return;
  graph.clear();
  editor.fitView();
});

chkDirected.addEventListener('change', () => graph.setDirected(chkDirected.checked));
chkOrthogonal.addEventListener('change', () => graph.setEdgeStyle(chkOrthogonal.checked ? 'orthogonal' : 'straight'));
btnFit.addEventListener('click', () => editor.fitView());

btnExport.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(graph.toJSON(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'graph.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

fileImport.addEventListener('change', async () => {
  const file = fileImport.files?.[0];
  fileImport.value = ''; // allows importing the same file again
  if (!file) return;
  try {
    graph.load(Graph.parse(JSON.parse(await file.text())));
    editor.select(null);
    editor.fitView();
  } catch (error) {
    window.alert(`Could not import the file: ${error instanceof Error ? error.message : String(error)}`);
  }
});

refresh();
editor.fitView();

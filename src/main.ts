import './style.css';
import { Graph } from './graph';
import { GraphEditor } from './editor';

const STORAGE_KEY = 'kesah:graph';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

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

/** Sample graph so the canvas is not empty on the first visit. */
function seedExample(graph: Graph): void {
  const a = graph.addNode(120, 160, 'A');
  const b = graph.addNode(320, 80, 'B');
  const c = graph.addNode(320, 240, 'C');
  const d = graph.addNode(520, 160, 'D');
  graph.addEdge(a.id, b.id);
  graph.addEdge(a.id, c.id);
  graph.addEdge(b.id, c.id);
  graph.addEdge(b.id, d.id);
  graph.addEdge(c.id, d.id);
}

const graph = new Graph();
if (!loadSaved(graph)) seedExample(graph);

const editor = new GraphEditor(byId('canvas'), graph);

const btnNew = byId<HTMLButtonElement>('btn-new');
const btnConnect = byId<HTMLButtonElement>('btn-connect');
const chkDirected = byId<HTMLInputElement>('chk-directed');
const btnDelete = byId<HTMLButtonElement>('btn-delete');
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
}

graph.onChange(() => {
  refresh();
  scheduleSave();
});

editor.onSelectionChange((selection) => {
  btnDelete.disabled = selection === null;
});

btnNew.addEventListener('click', () => {
  if (graph.nodeCount > 0 && !window.confirm('Discard the current graph and start over?')) return;
  graph.clear();
  editor.fitView();
});

btnConnect.addEventListener('click', () => {
  editor.connectMode = !editor.connectMode;
  btnConnect.setAttribute('aria-pressed', String(editor.connectMode));
});

chkDirected.addEventListener('change', () => graph.setDirected(chkDirected.checked));
btnDelete.addEventListener('click', () => editor.deleteSelection());
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

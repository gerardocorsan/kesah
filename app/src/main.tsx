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

/** Sample BPMN process so the canvas is not empty on the first visit. */
function seedExample(graph: Graph): void {
  const start = graph.addNode(60, 160, 'Start', 'start-event');
  const receive = graph.addNode(200, 160, 'Receive order', 'task', 'user');
  const inStock = graph.addNode(370, 160, 'In stock?', 'gateway', 'exclusive');
  const ship = graph.addNode(540, 160, 'Ship order', 'task', 'service');
  const end = graph.addNode(700, 160, 'End', 'end-event');
  const notify = graph.addNode(540, 290, 'Notify customer', 'task');
  const rejected = graph.addNode(700, 290, 'Order rejected', 'end-event', 'message');
  const note = graph.addNode(370, 50, 'Checked daily', 'annotation');
  // Execution properties, so the sample can be deployed to the server as it is.
  graph.setNodeScript(ship.id, 'log("shipping " + vars.item);');
  graph.setNodeScript(notify.id, 'vars.notified = true;');
  graph.setNodeMessage(rejected.id, 'rejected');
  graph.addEdge(start.id, receive.id, '', { sourceSide: 'right', targetSide: 'left' });
  graph.addEdge(receive.id, inStock.id, '', { sourceSide: 'right', targetSide: 'left' });
  const yes = graph.addEdge(inStock.id, ship.id, 'yes', { sourceSide: 'right', targetSide: 'left', condition: 'conditional' });
  if (yes) graph.setEdgeExpression(yes.id, 'vars.stock');
  graph.addEdge(inStock.id, notify.id, 'no', { sourceSide: 'bottom', targetSide: 'left', condition: 'default' });
  graph.addEdge(ship.id, end.id, '', { sourceSide: 'right', targetSide: 'left' });
  graph.addEdge(notify.id, rejected.id, '', { sourceSide: 'right', targetSide: 'left' });
  graph.addEdge(note.id, inStock.id, '', { sourceSide: 'bottom', targetSide: 'top', kind: 'association' });
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

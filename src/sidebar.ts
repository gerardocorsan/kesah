import { byId } from './dom';
import { Graph } from './graph';
import { GraphEditor, NODE_RADIUS } from './editor';

interface Point {
  x: number;
  y: number;
}

/** First spot at or near `start` that does not overlap an existing node. */
function freeSpot(graph: Graph, start: Point): Point {
  const minDistance = NODE_RADIUS * 2.5;
  const spot = { ...start };
  for (let i = 0; i < 50; i++) {
    const taken = graph.nodeList.some((node) => Math.hypot(node.x - spot.x, node.y - spot.y) < minDistance);
    if (!taken) break;
    spot.x += NODE_RADIUS * 2;
    spot.y += NODE_RADIUS * 2;
  }
  return spot;
}

/**
 * Left panel: editing tools, the properties of the selected element and the
 * node list. It only talks to the model and to the editor's selection.
 */
export function setupSidebar(graph: Graph, editor: GraphEditor): void {
  const btnAddNode = byId<HTMLButtonElement>('btn-add-node');
  const btnConnect = byId<HTMLButtonElement>('btn-connect');
  const btnDelete = byId<HTMLButtonElement>('btn-delete');
  const inspectorTitle = byId<HTMLElement>('inspector-title');
  const inspectorEmpty = byId<HTMLElement>('inspector-empty');
  const inspectorForm = byId<HTMLFormElement>('inspector-form');
  const inspectorInfo = byId<HTMLElement>('inspector-info');
  const labelText = byId<HTMLElement>('label-text');
  const labelInput = byId<HTMLInputElement>('inp-label');
  const nodeList = byId<HTMLUListElement>('node-list');
  const nodeCount = byId<HTMLElement>('node-count');
  let listSignature = '';

  function renderInspector(): void {
    const selected = editor.selection;
    if (!selected) {
      inspectorTitle.textContent = 'Selection';
      inspectorEmpty.hidden = false;
      inspectorForm.hidden = true;
      if (document.activeElement !== labelInput) labelInput.value = '';
      return;
    }
    let label = '';
    if (selected.kind === 'node') {
      const node = graph.getNode(selected.id);
      if (!node) return;
      const degree = graph.edgeList.filter((edge) => edge.source === node.id || edge.target === node.id).length;
      inspectorTitle.textContent = 'Node';
      labelText.textContent = 'Name';
      inspectorInfo.textContent = `${degree} ${degree === 1 ? 'edge' : 'edges'} connected`;
      label = node.label;
    } else {
      const edge = graph.getEdge(selected.id);
      if (!edge) return;
      const source = graph.getNode(edge.source)?.label ?? edge.source;
      const target = graph.getNode(edge.target)?.label ?? edge.target;
      inspectorTitle.textContent = 'Edge';
      labelText.textContent = 'Label';
      inspectorInfo.textContent = `${source} ${graph.directed ? '→' : '—'} ${target}`;
      label = edge.label;
    }
    inspectorEmpty.hidden = true;
    inspectorForm.hidden = false;
    // Never overwrite what the user is typing.
    if (document.activeElement !== labelInput) labelInput.value = label;
  }

  function renderList(): void {
    const nodes = graph.nodeList;
    nodeCount.textContent = String(nodes.length);
    // The list is rebuilt only when nodes appear, disappear or change name, not while dragging.
    const signature = nodes.map((node) => `${node.id}=${node.label}`).join('\n');
    if (signature !== listSignature) {
      listSignature = signature;
      nodeList.replaceChildren(
        ...nodes.map((node) => {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.id = node.id;
          button.textContent = node.label || node.id;
          item.append(button);
          return item;
        }),
      );
    }
    const selectedId = editor.selection?.kind === 'node' ? editor.selection.id : null;
    for (const button of nodeList.querySelectorAll<HTMLButtonElement>('button')) {
      button.classList.toggle('active', button.dataset.id === selectedId);
    }
  }

  function focusLabel(): void {
    renderInspector();
    labelInput.focus();
    labelInput.select();
  }

  btnAddNode.addEventListener('click', () => {
    const spot = freeSpot(graph, editor.viewCenter());
    const node = graph.addNode(spot.x, spot.y);
    editor.select({ kind: 'node', id: node.id });
    focusLabel();
  });

  btnConnect.addEventListener('click', () => {
    editor.connectMode = !editor.connectMode;
    btnConnect.setAttribute('aria-pressed', String(editor.connectMode));
  });

  btnDelete.addEventListener('click', () => editor.deleteSelection());

  labelInput.addEventListener('input', () => {
    const selected = editor.selection;
    if (!selected) return;
    const value = labelInput.value.trim();
    if (selected.kind === 'node') {
      if (value !== '') graph.setNodeLabel(selected.id, value);
    } else {
      graph.setEdgeLabel(selected.id, value);
    }
  });
  // On leaving the field, show what the model actually holds (an empty node name is not applied).
  labelInput.addEventListener('blur', renderInspector);
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      labelInput.blur();
    }
  });
  inspectorForm.addEventListener('submit', (e) => e.preventDefault());

  nodeList.addEventListener('click', (e) => {
    const button = e.target instanceof HTMLElement ? e.target.closest('button') : null;
    const id = button?.dataset.id;
    if (!id) return;
    editor.select({ kind: 'node', id });
    editor.revealNode(id);
  });

  graph.onChange(() => {
    renderList();
    renderInspector();
  });
  editor.onSelectionChange(() => {
    renderList();
    renderInspector();
  });
  editor.onEditRequest(() => focusLabel());

  renderList();
  renderInspector();
}

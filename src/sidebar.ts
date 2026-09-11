import { byId } from './dom';
import { Graph, NODE_TYPES, isNodeType, type NodeType } from './graph';
import { GraphEditor } from './editor';
import { shapePath, shapeSize } from './shapes';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Point {
  x: number;
  y: number;
}

/** Display name and description of each flowchart symbol. */
const NODE_TYPE_INFO: Record<NodeType, { name: string; title: string }> = {
  terminal: { name: 'Terminal', title: 'Start or end of the flow' },
  process: { name: 'Process', title: 'An action or step' },
  decision: { name: 'Decision', title: 'A question, with one outgoing edge per answer' },
  io: { name: 'Input / Output', title: 'Data entering or leaving the flow' },
};

/** Small inline SVG showing the outline of a node type. */
function shapeIcon(type: NodeType): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'shape-icon');
  svg.setAttribute('viewBox', '-16 -10 32 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shapePath(type, { width: 28, height: 16 }));
  svg.append(path);
  return svg;
}

/** First spot at or near `start` where a node of the given type does not overlap an existing node. */
function freeSpot(graph: Graph, start: Point, type: NodeType): Point {
  const size = shapeSize(type, 0);
  const spot = { ...start };
  for (let i = 0; i < 50; i++) {
    const taken = graph.nodeList.some(
      (node) => Math.abs(node.x - spot.x) < size.width + 8 && Math.abs(node.y - spot.y) < size.height + 8,
    );
    if (!taken) break;
    spot.x += size.width / 2;
    spot.y += size.height + 16;
  }
  return spot;
}

/**
 * Left panel: one "add" button per shape, the properties of the selected
 * element and the node list. It only talks to the model and to the editor's selection.
 */
export function setupSidebar(graph: Graph, editor: GraphEditor): void {
  const addNodeTools = byId<HTMLElement>('add-node-tools');
  const btnConnect = byId<HTMLButtonElement>('btn-connect');
  const btnDelete = byId<HTMLButtonElement>('btn-delete');
  const inspectorTitle = byId<HTMLElement>('inspector-title');
  const inspectorEmpty = byId<HTMLElement>('inspector-empty');
  const inspectorForm = byId<HTMLFormElement>('inspector-form');
  const inspectorInfo = byId<HTMLElement>('inspector-info');
  const labelText = byId<HTMLElement>('label-text');
  const labelInput = byId<HTMLInputElement>('inp-label');
  const typeField = byId<HTMLElement>('type-field');
  const typeSelect = byId<HTMLSelectElement>('sel-type');
  const nodeList = byId<HTMLUListElement>('node-list');
  const nodeCount = byId<HTMLElement>('node-count');
  let listSignature = '';

  // The same shapes drive the "add" buttons and the inspector's shape selector.
  for (const type of NODE_TYPES) {
    const info = NODE_TYPE_INFO[type];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'add-node';
    button.dataset.type = type;
    button.title = info.title;
    button.append(shapeIcon(type), document.createTextNode(info.name));
    addNodeTools.append(button);

    const option = document.createElement('option');
    option.value = type;
    option.textContent = info.name;
    typeSelect.append(option);
  }

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
      typeField.hidden = false;
      typeSelect.value = node.type;
      label = node.label;
    } else {
      const edge = graph.getEdge(selected.id);
      if (!edge) return;
      const source = graph.getNode(edge.source)?.label ?? edge.source;
      const target = graph.getNode(edge.target)?.label ?? edge.target;
      inspectorTitle.textContent = 'Edge';
      labelText.textContent = 'Label';
      inspectorInfo.textContent = `${source} ${graph.directed ? '→' : '—'} ${target}`;
      typeField.hidden = true;
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
    // The list is rebuilt only when nodes appear, disappear or change name or shape, not while dragging.
    const signature = nodes.map((node) => `${node.id}=${node.type}:${node.label}`).join('\n');
    if (signature !== listSignature) {
      listSignature = signature;
      nodeList.replaceChildren(
        ...nodes.map((node) => {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.id = node.id;
          const name = document.createElement('span');
          name.className = 'node-name';
          name.textContent = node.label || node.id;
          button.append(shapeIcon(node.type), name);
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

  addNodeTools.addEventListener('click', (e) => {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    const type = button?.dataset.type;
    if (!isNodeType(type)) return;
    const spot = freeSpot(graph, editor.viewCenter(), type);
    const node = graph.addNode(spot.x, spot.y, undefined, type);
    editor.select({ kind: 'node', id: node.id });
    focusLabel();
  });

  btnConnect.addEventListener('click', () => {
    editor.connectMode = !editor.connectMode;
    btnConnect.setAttribute('aria-pressed', String(editor.connectMode));
  });

  btnDelete.addEventListener('click', () => editor.deleteSelection());

  typeSelect.addEventListener('change', () => {
    const selected = editor.selection;
    if (selected?.kind === 'node' && isNodeType(typeSelect.value)) graph.setNodeType(selected.id, typeSelect.value);
  });

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
    const button = e.target instanceof Element ? e.target.closest('button') : null;
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

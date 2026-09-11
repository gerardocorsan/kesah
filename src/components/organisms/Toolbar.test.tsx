import { fireEvent } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeRect } from '../../test/dom';
import { renderWithApp, seedPair } from '../../test/render';
import type { AppState } from '../../state/app';
import { Toolbar } from './Toolbar';

/** Browser dialogs and object URLs are external to the component and are stubbed. */

function canvas(app: AppState): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fakeRect(svg, { x: 0, y: 0, width: 800, height: 600 });
  app.registerCanvas(svg);
}

function pickFile(input: HTMLInputElement, content: string): void {
  Object.defineProperty(input, 'files', { value: [new File([content], 'g.json', { type: 'application/json' })], configurable: true });
  fireEvent.change(input);
}

describe('Toolbar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports the number of nodes and edges, singular and plural', () => {
    const { container, graph } = renderWithApp(() => <Toolbar />);
    const status = container.querySelector('#status');
    expect(status).toHaveTextContent('0 nodes · 0 edges');
    const a = graph.addNode(0, 0, 'A');
    expect(status).toHaveTextContent('1 node · 0 edges');
    const b = graph.addNode(1, 1, 'B');
    graph.addEdge(a.id, b.id);
    expect(status).toHaveTextContent('2 nodes · 1 edge');
  });

  it('reflects and changes the directed and orthogonal settings', () => {
    const { container, graph } = renderWithApp(() => <Toolbar />);
    const directed = container.querySelector('#chk-directed') as HTMLInputElement;
    const orthogonal = container.querySelector('#chk-orthogonal') as HTMLInputElement;
    expect(directed.checked).toBe(true);
    expect(orthogonal.checked).toBe(true);
    fireEvent.click(directed);
    expect(graph.directed).toBe(false);
    fireEvent.click(orthogonal);
    expect(graph.edgeStyle).toBe('straight');
    graph.setDirected(true);
    graph.setEdgeStyle('orthogonal');
    expect(directed.checked).toBe(true);
    expect(orthogonal.checked).toBe(true);
  });

  it('New asks for confirmation when there is content and clears only when confirmed', () => {
    const { container, graph } = renderWithApp(() => <Toolbar />, seedPair);
    const button = container.querySelector('#btn-new') as HTMLButtonElement;
    let asked = 0;
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      asked++;
      return false;
    });
    fireEvent.click(button);
    expect(asked).toBe(1);
    expect(graph.nodeCount).toBe(2);
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    fireEvent.click(button);
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });

  it('New does not ask when the graph is already empty', () => {
    const { container, graph } = renderWithApp(() => <Toolbar />);
    let asked = 0;
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      asked++;
      return false;
    });
    fireEvent.click(container.querySelector('#btn-new') as HTMLButtonElement);
    expect(asked).toBe(0);
    expect(graph.nodeCount).toBe(0);
  });

  it('Fit view frames the graph in the canvas', () => {
    const { container, app, graph } = renderWithApp(() => <Toolbar />);
    canvas(app);
    const node = graph.addNode(1000, 1000, 'A');
    app.setView({ scale: 1, tx: 0, ty: 0 });
    fireEvent.click(container.querySelector('#btn-fit') as HTMLButtonElement);
    const view = app.view();
    expect(node.x * view.scale + view.tx).toBe(400);
    expect(node.y * view.scale + view.ty).toBe(300);
  });

  it('Undo and Redo are enabled only when available and apply the history', () => {
    const { container, graph } = renderWithApp(() => <Toolbar />);
    const undo = container.querySelector('#btn-undo') as HTMLButtonElement;
    const redo = container.querySelector('#btn-redo') as HTMLButtonElement;
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    graph.addNode(0, 0, 'A');
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    fireEvent.click(undo);
    expect(graph.nodeCount).toBe(0);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    expect(graph.nodeCount).toBe(1);
    expect(redo).toBeDisabled();
  });

  it('Export downloads the graph as graph.json and releases the object URL afterwards', async () => {
    vi.useFakeTimers();
    const { container, graph } = renderWithApp(() => <Toolbar />, seedPair);
    let blob: Blob | undefined;
    let download = '';
    let href = '';
    let revoked = '';
    const url = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    url.createObjectURL = (b: Blob) => {
      blob = b;
      return 'blob:kesah-test';
    };
    url.revokeObjectURL = (u: string) => {
      revoked = u;
    };
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
      href = this.href;
    });
    try {
      fireEvent.click(container.querySelector('#btn-export') as HTMLButtonElement);
      expect(download).toBe('graph.json');
      expect(href).toBe('blob:kesah-test');
      expect(blob?.type).toBe('application/json');
      expect(JSON.parse(await blob!.text())).toEqual(graph.toJSON());
      expect(revoked).toBe('');
      vi.advanceTimersByTime(5000);
      expect(revoked).toBe('blob:kesah-test');
    } finally {
      delete url.createObjectURL;
      delete url.revokeObjectURL;
    }
  });

  it('Import loads a valid file, clears the selection and fits the view', async () => {
    const { container, app, graph } = renderWithApp(() => <Toolbar />, seedPair);
    canvas(app);
    app.select({ kind: 'node', id: 'n1' });
    // The imported file keeps the id of the selected node, so only the import itself can clear the selection.
    pickFile(container.querySelector('#file-import') as HTMLInputElement, JSON.stringify({ nodes: [{ id: 'n1', label: 'X', x: 10, y: 10 }], edges: [] }));
    await vi.waitFor(() => expect(graph.nodeCount).toBe(1));
    expect(graph.getNode('n1')).toMatchObject({ label: 'X', x: 10, y: 10 });
    expect(app.selection()).toBeNull();
    const view = app.view();
    expect(10 * view.scale + view.tx).toBe(400);
  });

  it('Import warns and keeps the graph when the file is not a valid document', async () => {
    const { container, graph } = renderWithApp(() => <Toolbar />, seedPair);
    const messages: string[] = [];
    vi.spyOn(window, 'alert').mockImplementation((message?: unknown) => {
      messages.push(String(message));
    });
    const input = container.querySelector('#file-import') as HTMLInputElement;
    pickFile(input, '{not json');
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toMatch(/import/i);
    pickFile(input, JSON.stringify({ edges: [] }));
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages[1]).toMatch(/nodes/);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
  });
});

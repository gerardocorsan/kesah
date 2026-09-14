import { fireEvent } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { fakeRect } from '../../test/dom';
import { renderWithApp, seedPair } from '../../test/render';
import { NodeListPanel } from './NodeListPanel';

describe('NodeListPanel', () => {
  it('lists every node by name with its shape icon and shows the count', () => {
    const { container, graph } = renderWithApp(() => <NodeListPanel />, seedPair);
    expect(container.querySelector('#node-count')).toHaveTextContent('2');
    const rows = [...container.querySelectorAll('#node-list button')];
    expect(rows.map((r) => r.querySelector('.node-name')?.textContent)).toEqual(['A', 'B']);
    expect(rows.every((r) => r.querySelector('svg.shape-icon path'))).toBe(true);
    graph.addNode(0, 0, 'C', 'start-event');
    graph.setNodeLabel('n1', 'Alpha');
    expect(container.querySelector('#node-count')).toHaveTextContent('3');
    expect([...container.querySelectorAll('.node-name')].map((n) => n.textContent)).toEqual(['Alpha', 'B', 'C']);
    graph.removeNode('n2');
    expect([...container.querySelectorAll('.node-name')].map((n) => n.textContent)).toEqual(['Alpha', 'C']);
  });

  it('highlights the selected node', () => {
    const { container, app } = renderWithApp(() => <NodeListPanel />, seedPair);
    const [first, second] = [...container.querySelectorAll('#node-list button')];
    expect(first).not.toHaveClass('active');
    app.select({ kind: 'node', id: 'n2' });
    expect(second).toHaveClass('active');
    expect(first).not.toHaveClass('active');
    app.select({ kind: 'edge', id: 'e1' });
    expect(second).not.toHaveClass('active');
  });

  it('selects a node when its row is clicked and brings it into view', () => {
    const { container, app, graph } = renderWithApp(() => <NodeListPanel />, seedPair);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    fakeRect(svg, { x: 0, y: 0, width: 800, height: 600 });
    app.registerCanvas(svg);
    app.setView({ scale: 1, tx: 0, ty: 0 });
    graph.moveNode('n2', 5000, 5000);
    fireEvent.click(container.querySelectorAll('#node-list button')[1]);
    expect(app.selection()).toEqual({ kind: 'node', id: 'n2' });
    const view = app.view();
    expect(5000 * view.scale + view.tx).toBe(400);
    expect(5000 * view.scale + view.ty).toBe(300);
  });
});

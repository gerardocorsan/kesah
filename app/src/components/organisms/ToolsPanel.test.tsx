import { fireEvent } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { shapeSize } from '../../model/shapes';
import type { AppState } from '../../state/app';
import { fakeRect } from '../../test/dom';
import { renderWithApp } from '../../test/render';
import { ToolsPanel } from './ToolsPanel';

function canvas(app: AppState): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fakeRect(svg, { x: 0, y: 0, width: 800, height: 600 });
  app.registerCanvas(svg);
  app.setView({ scale: 1, tx: 0, ty: 0 });
}

describe('ToolsPanel', () => {
  it('adds a node of the chosen shape in the middle of the view, selects it and asks to edit it', () => {
    const { container, app, graph } = renderWithApp(() => <ToolsPanel />);
    canvas(app);
    const requests = app.editRequest();
    fireEvent.click(container.querySelector('#add-node-tools button[data-type="gateway"]') as HTMLButtonElement);
    expect(graph.nodeCount).toBe(1);
    const node = graph.nodeList[0];
    expect(node).toMatchObject({ type: 'gateway', variant: 'exclusive', x: 400, y: 300 });
    expect(app.selection()).toEqual({ kind: 'node', id: node.id });
    expect(app.editRequest()).toBe(requests + 1);
  });

  it('offers every element and places a second node somewhere free', () => {
    const { container, app, graph } = renderWithApp(() => <ToolsPanel />);
    canvas(app);
    const buttons = [...container.querySelectorAll('#add-node-tools button')];
    expect(buttons.map((b) => b.getAttribute('data-type'))).toEqual(['start-event', 'intermediate-event', 'end-event', 'task', 'subprocess', 'gateway', 'annotation', 'data-object']);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[0]);
    const [first, second] = graph.nodeList;
    const { width, height } = shapeSize('start-event', 0);
    expect(second.type).toBe('start-event');
    expect(Math.abs(first.x - second.x) >= width || Math.abs(first.y - second.y) >= height).toBe(true);
  });

  it('Connect toggles connect mode, shows it as pressed and follows changes made elsewhere', () => {
    const { container, app } = renderWithApp(() => <ToolsPanel />);
    const button = container.querySelector('#btn-connect') as HTMLButtonElement;
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('kbd')).toHaveTextContent('C');
    fireEvent.click(button);
    expect(app.connectMode()).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(app.connectMode()).toBe(false);
    app.setConnectMode(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

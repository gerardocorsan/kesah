import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { Graph } from './model/graph';
import { createAppState } from './state/app';
import { seedPair } from './test/render';

describe('App', () => {
  it('lays out the toolbar, the side panels, the canvas and the hint', () => {
    const { container } = render(() => {
      const graph = new Graph();
      seedPair(graph);
      return <App state={createAppState(graph)} />;
    });
    expect(container.querySelector('header.toolbar #status')).toHaveTextContent('2 nodes · 1 edge');
    const sidebar = container.querySelector('aside.sidebar');
    expect(sidebar?.querySelectorAll('section.panel')).toHaveLength(3);
    expect(sidebar?.querySelectorAll('#add-node-tools button')).toHaveLength(8);
    expect(sidebar?.querySelector('#inspector-form')).toHaveAttribute('hidden');
    expect(sidebar?.querySelectorAll('#node-list button')).toHaveLength(2);
    expect(container.querySelector('main#canvas svg.graph-editor .node')).not.toBeNull();
    const hint = container.querySelector('footer.hint')?.textContent ?? '';
    expect(hint).toContain('C: toggle connect mode');
    expect(hint).toContain('Ctrl+Z');
  });
});

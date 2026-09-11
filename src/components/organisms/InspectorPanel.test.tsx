import { fireEvent } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { renderWithApp, seedPair } from '../../test/render';
import { InspectorPanel } from './InspectorPanel';

/**
 * Agreed behaviour: the panel shows the selected element's properties; an empty node name is
 * never applied; Enter and Escape leave the name field; typing a name is one undo step; edges
 * expose "From side" and "To side" with an Auto option.
 */

function setup() {
  let ids!: { a: string; b: string; edge: string };
  const result = renderWithApp(
    () => <InspectorPanel />,
    (graph) => {
      ids = seedPair(graph);
    },
  );
  const q = <T extends Element>(selector: string): T => result.container.querySelector(selector) as T;
  return {
    ...result,
    ids,
    title: () => q<HTMLElement>('#inspector-title').textContent,
    empty: () => q<HTMLElement>('#inspector-empty'),
    form: () => q<HTMLFormElement>('#inspector-form'),
    input: () => q<HTMLInputElement>('#inp-label'),
    typeField: () => q<HTMLElement>('#type-field'),
    typeSelect: () => q<HTMLSelectElement>('#sel-type'),
    sourceField: () => q<HTMLElement>('#source-side-field'),
    sourceSelect: () => q<HTMLSelectElement>('#sel-source-side'),
    targetField: () => q<HTMLElement>('#target-side-field'),
    targetSelect: () => q<HTMLSelectElement>('#sel-target-side'),
    info: () => q<HTMLElement>('#inspector-info').textContent,
    deleteButton: () => q<HTMLButtonElement>('#btn-delete'),
    type: (value: string) => fireEvent.input(q('#inp-label'), { target: { value } }),
  };
}

describe('InspectorPanel with nothing selected', () => {
  it('shows a hint instead of the form', () => {
    const s = setup();
    expect(s.title()).toBe('Selection');
    expect(s.empty()).not.toHaveAttribute('hidden');
    expect(s.form()).toHaveAttribute('hidden');
    expect(s.input().value).toBe('');
  });
});

describe('InspectorPanel with a node selected', () => {
  it('shows the name, the shape and the number of connected edges', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    expect(s.title()).toBe('Node');
    expect(s.empty()).toHaveAttribute('hidden');
    expect(s.form()).not.toHaveAttribute('hidden');
    expect(s.input().value).toBe('A');
    expect(s.typeField()).not.toHaveAttribute('hidden');
    expect(s.typeSelect().value).toBe('process');
    expect(s.sourceField()).toHaveAttribute('hidden');
    expect(s.targetField()).toHaveAttribute('hidden');
    expect(s.info()).toBe('1 edge connected');
    s.graph.addEdge(s.ids.b, s.ids.a);
    expect(s.info()).toBe('2 edges connected');
    s.app.select({ kind: 'node', id: s.ids.b });
    expect(s.typeSelect().value).toBe('decision');
    expect(s.input().value).toBe('B');
  });

  it('applies the typed name trimmed while showing exactly what is typed until the field is left', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    fireEvent.focus(s.input());
    s.type('  Alpha ');
    expect(s.graph.getNode(s.ids.a)?.label).toBe('Alpha');
    expect(s.input().value).toBe('  Alpha ');
    fireEvent.blur(s.input());
    expect(s.input().value).toBe('Alpha');
  });

  it('never applies an empty name and restores the real one when the field is left', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    fireEvent.focus(s.input());
    s.type('');
    expect(s.graph.getNode(s.ids.a)?.label).toBe('A');
    expect(s.input().value).toBe('');
    s.type('   ');
    expect(s.graph.getNode(s.ids.a)?.label).toBe('A');
    fireEvent.blur(s.input());
    expect(s.input().value).toBe('A');
  });

  it('leaves the field on Enter and on Escape', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    for (const key of ['Enter', 'Escape']) {
      s.input().focus();
      expect(document.activeElement).toBe(s.input());
      fireEvent.keyDown(s.input(), { key });
      expect(document.activeElement).not.toBe(s.input());
    }
  });

  it('changes the shape from the select', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    fireEvent.change(s.typeSelect(), { target: { value: 'terminal' } });
    expect(s.graph.getNode(s.ids.a)?.type).toBe('terminal');
    expect(s.typeSelect().value).toBe('terminal');
  });

  it('deletes the node and its edges from the button', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    fireEvent.click(s.deleteButton());
    expect(s.graph.getNode(s.ids.a)).toBeUndefined();
    expect(s.graph.edgeCount).toBe(0);
    expect(s.form()).toHaveAttribute('hidden');
    expect(s.title()).toBe('Selection');
  });

  it('focuses and selects the name when an edit is requested', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    s.app.requestEdit();
    expect(document.activeElement).toBe(s.input());
    expect(s.input().selectionStart).toBe(0);
    expect(s.input().selectionEnd).toBe(1);
  });

  it('turns a whole typing session into a single undo step', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    fireEvent.focus(s.input());
    s.type('Al');
    s.type('Alp');
    s.type('Alpha');
    fireEvent.blur(s.input());
    expect(s.graph.getNode(s.ids.a)?.label).toBe('Alpha');
    s.app.undo();
    expect(s.graph.getNode(s.ids.a)?.label).toBe('A');
    expect(s.app.canUndo()).toBe(false);
    s.app.redo();
    expect(s.graph.getNode(s.ids.a)?.label).toBe('Alpha');
  });

  it('drops what was being typed when the selection changes', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    fireEvent.focus(s.input());
    s.type('Alpha');
    s.app.select({ kind: 'edge', id: s.ids.edge });
    expect(s.input().value).toBe('Yes');
  });
});

describe('InspectorPanel with an edge selected', () => {
  it('shows the label, the sides with Auto, and the ends of the edge', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    expect(s.title()).toBe('Edge');
    expect(s.input().value).toBe('Yes');
    expect(s.typeField()).toHaveAttribute('hidden');
    expect(s.sourceField()).not.toHaveAttribute('hidden');
    expect(s.targetField()).not.toHaveAttribute('hidden');
    expect(s.sourceSelect().value).toBe('');
    expect([...s.sourceSelect().options].map((o) => o.textContent)).toEqual(['Auto', 'Top', 'Right', 'Bottom', 'Left']);
    expect(s.info()).toBe('A → B');
    s.graph.setDirected(false);
    expect(s.info()).toBe('A — B');
  });

  it('fixes and clears the sides from the selects', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    fireEvent.change(s.sourceSelect(), { target: { value: 'bottom' } });
    fireEvent.change(s.targetSelect(), { target: { value: 'top' } });
    expect(s.graph.getEdge(s.ids.edge)).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
    fireEvent.change(s.sourceSelect(), { target: { value: '' } });
    expect(s.graph.getEdge(s.ids.edge)).not.toHaveProperty('sourceSide');
    expect(s.targetSelect().value).toBe('top');
  });

  it('shows fixed sides when the edge already has them', () => {
    const s = setup();
    const fixed = s.graph.addEdge(s.ids.a, s.ids.b, '', { sourceSide: 'left', targetSide: 'right' });
    s.app.select({ kind: 'edge', id: fixed?.id ?? '' });
    expect(s.sourceSelect().value).toBe('left');
    expect(s.targetSelect().value).toBe('right');
  });

  it('allows the label to be emptied', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    fireEvent.focus(s.input());
    s.type('');
    expect(s.graph.getEdge(s.ids.edge)?.label).toBe('');
    s.type(' No ');
    expect(s.graph.getEdge(s.ids.edge)?.label).toBe('No');
  });

  it('deletes the edge from the button', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    fireEvent.click(s.deleteButton());
    expect(s.graph.edgeCount).toBe(0);
    expect(s.graph.nodeCount).toBe(2);
  });
});

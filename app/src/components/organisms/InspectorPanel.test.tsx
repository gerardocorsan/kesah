import { fireEvent } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { renderWithApp, seedPair } from '../../test/render';
import { InspectorPanel } from './InspectorPanel';

/**
 * Agreed behaviour: the panel shows the selected element's properties; an empty node name is
 * never applied; Enter and Escape leave the name field; typing a name is one undo step; nodes
 * expose their type and, when the type has any, a variant; edges expose kind, condition (for
 * sequence flows), and "From side" / "To side" with an Auto option. Execution properties: Script
 * for tasks and sub-processes, Delay (ms) for timer events, Message for message events, Expression
 * for sequence flows; each is one undo step per focus and disappears from the document when blank.
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
  const hidden = (selector: string) => q<HTMLElement>(selector).hasAttribute('hidden');
  return {
    ...result,
    ids,
    title: () => q<HTMLElement>('#inspector-title').textContent,
    empty: () => q<HTMLElement>('#inspector-empty'),
    form: () => q<HTMLFormElement>('#inspector-form'),
    input: () => q<HTMLInputElement>('#inp-label'),
    hidden,
    typeSelect: () => q<HTMLSelectElement>('#sel-type'),
    variantField: () => q<HTMLElement>('#variant-field'),
    variantSelect: () => q<HTMLSelectElement>('#sel-variant'),
    kindSelect: () => q<HTMLSelectElement>('#sel-kind'),
    conditionSelect: () => q<HTMLSelectElement>('#sel-condition'),
    sourceSelect: () => q<HTMLSelectElement>('#sel-source-side'),
    targetSelect: () => q<HTMLSelectElement>('#sel-target-side'),
    info: () => q<HTMLElement>('#inspector-info').textContent,
    deleteButton: () => q<HTMLButtonElement>('#btn-delete'),
    type: (value: string) => fireEvent.input(q('#inp-label'), { target: { value } }),
    choose: (selector: string, value: string) => fireEvent.change(q(selector), { target: { value } }),
    typeInto: (selector: string, value: string) => fireEvent.input(q(selector), { target: { value } }),
    field: <T extends HTMLElement>(selector: string) => q<T>(selector),
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
  it('shows the name, the type, the variant and the number of connected edges', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    expect(s.title()).toBe('Node');
    expect(s.empty()).toHaveAttribute('hidden');
    expect(s.form()).not.toHaveAttribute('hidden');
    expect(s.input().value).toBe('A');
    expect(s.hidden('#type-field')).toBe(false);
    expect(s.typeSelect().value).toBe('task');
    expect(s.hidden('#variant-field')).toBe(false);
    expect(s.variantField().textContent).toContain('Task type');
    expect(s.variantSelect().value).toBe('none');
    expect([...s.variantSelect().options].map((o) => o.textContent)).toEqual(['None', 'User', 'Service', 'Script']);
    for (const field of ['#kind-field', '#condition-field', '#source-side-field', '#target-side-field']) expect(s.hidden(field)).toBe(true);
    expect(s.info()).toBe('1 edge connected');
    s.graph.addEdge(s.ids.b, s.ids.a);
    expect(s.info()).toBe('2 edges connected');
    s.app.select({ kind: 'node', id: s.ids.b });
    expect(s.typeSelect().value).toBe('gateway');
    expect(s.variantField().textContent).toContain('Gateway');
    expect(s.variantSelect().value).toBe('exclusive');
    expect(s.input().value).toBe('B');
  });

  it('hides the variant field for elements without variants and names it after the type', () => {
    const s = setup();
    const note = s.graph.addNode(0, 0, 'Note', 'annotation');
    s.app.select({ kind: 'node', id: note.id });
    expect(s.hidden('#variant-field')).toBe(true);
    s.graph.setNodeType(note.id, 'start-event');
    expect(s.hidden('#variant-field')).toBe(false);
    expect(s.variantField().textContent).toContain('Trigger');
    s.graph.setNodeType(note.id, 'end-event');
    expect(s.variantField().textContent).toContain('Result');
    expect([...s.variantSelect().options].map((o) => o.value)).toEqual(['none', 'message', 'terminate']);
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

  it('changes the type from the select, resetting a variant the new type does not accept', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    s.choose('#sel-variant', 'service');
    expect(s.graph.getNode(s.ids.a)?.variant).toBe('service');
    s.choose('#sel-type', 'start-event');
    expect(s.graph.getNode(s.ids.a)).toMatchObject({ type: 'start-event', variant: 'none' });
    expect(s.typeSelect().value).toBe('start-event');
    expect(s.variantSelect().value).toBe('none');
    s.choose('#sel-variant', 'timer');
    expect(s.graph.getNode(s.ids.a)?.variant).toBe('timer');
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

describe('InspectorPanel in a scrolling sidebar', () => {
  it('brings itself into view when something is selected, and not before', () => {
    const s = setup();
    const scrolled: HTMLElement[] = [];
    s.container.addEventListener('scroll-into-view', (e) => scrolled.push(e.target as HTMLElement));
    expect(scrolled).toEqual([]);
    s.app.select({ kind: 'node', id: s.ids.a });
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].contains(s.form())).toBe(true);
    s.app.select(null);
    expect(scrolled).toHaveLength(1);
    s.app.select({ kind: 'edge', id: s.ids.edge });
    expect(scrolled).toHaveLength(2);
  });
});

describe('InspectorPanel execution properties', () => {
  const executionFields = ['#script-field', '#delay-field', '#message-field', '#expression-field'];

  it('shows the script only for tasks and sub-processes and stores it on the node', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    expect(s.hidden('#script-field')).toBe(false);
    for (const field of ['#delay-field', '#message-field', '#expression-field']) expect(s.hidden(field)).toBe(true);
    expect(s.field<HTMLTextAreaElement>('#inp-script').value).toBe('');
    s.typeInto('#inp-script', 'vars.total = 2;');
    expect(s.graph.getNode(s.ids.a)?.script).toBe('vars.total = 2;');
    s.typeInto('#inp-script', '');
    expect(s.graph.getNode(s.ids.a)).not.toHaveProperty('script');
    s.choose('#sel-type', 'subprocess');
    expect(s.hidden('#script-field')).toBe(false);
    s.choose('#sel-type', 'gateway');
    expect(s.hidden('#script-field')).toBe(true);
    s.app.select({ kind: 'node', id: s.ids.b });
    expect(s.hidden('#script-field')).toBe(true);
  });

  it('shows the delay only for timer events and stores a number, clearing it when the text is not one', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    s.choose('#sel-type', 'start-event');
    expect(s.hidden('#delay-field')).toBe(true);
    s.choose('#sel-variant', 'timer');
    expect(s.hidden('#delay-field')).toBe(false);
    expect(s.hidden('#message-field')).toBe(true);
    expect(s.hidden('#script-field')).toBe(true);
    const delay = s.field<HTMLInputElement>('#inp-delay');
    fireEvent.focus(delay);
    s.typeInto('#inp-delay', '25');
    expect(s.graph.getNode(s.ids.a)?.delay).toBe(25);
    s.typeInto('#inp-delay', '25x');
    expect(s.graph.getNode(s.ids.a)).not.toHaveProperty('delay');
    expect(delay.value).toBe('25x');
    s.typeInto('#inp-delay', '250');
    fireEvent.blur(delay);
    expect(delay.value).toBe('250');
    s.choose('#sel-variant', 'message');
    expect(s.hidden('#delay-field')).toBe(true);
    expect(s.hidden('#message-field')).toBe(false);
    s.typeInto('#inp-message', 'order paid');
    expect(s.graph.getNode(s.ids.a)?.message).toBe('order paid');
    s.choose('#sel-type', 'intermediate-event');
    expect(s.hidden('#message-field')).toBe(false);
    expect(s.field<HTMLInputElement>('#inp-message').value).toBe('order paid');
  });

  it('shows the delay and the message stored on the node when it is selected', () => {
    const s = setup();
    const timer = s.graph.addNode(0, 200, 'T', 'intermediate-event', 'message');
    s.graph.setNodeMessage(timer.id, 'done');
    s.graph.setNodeDelay(timer.id, 40);
    s.app.select({ kind: 'node', id: timer.id });
    expect(s.field<HTMLInputElement>('#inp-message').value).toBe('done');
    expect(s.hidden('#delay-field')).toBe(true);
    s.graph.setNodeVariant(timer.id, 'timer');
    expect(s.hidden('#delay-field')).toBe(false);
    expect(s.field<HTMLInputElement>('#inp-delay').value).toBe('40');
  });

  it('shows the expression only for sequence flows and stores it on the edge', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    expect(s.hidden('#expression-field')).toBe(false);
    for (const field of ['#script-field', '#delay-field', '#message-field']) expect(s.hidden(field)).toBe(true);
    s.typeInto('#inp-expression', 'vars.stock');
    expect(s.graph.getEdge(s.ids.edge)?.expression).toBe('vars.stock');
    s.choose('#sel-kind', 'association');
    expect(s.hidden('#expression-field')).toBe(true);
    expect(s.graph.getEdge(s.ids.edge)).not.toHaveProperty('expression');
    s.choose('#sel-kind', 'sequence');
    expect(s.field<HTMLInputElement>('#inp-expression').value).toBe('');
  });

  it('hides every execution field when nothing is selected', () => {
    const s = setup();
    for (const field of executionFields) expect(s.hidden(field)).toBe(true);
  });

  it('groups what is typed into a field between focus and blur as one undo step', () => {
    const s = setup();
    s.app.select({ kind: 'node', id: s.ids.a });
    const script = s.field<HTMLTextAreaElement>('#inp-script');
    fireEvent.focus(script);
    s.typeInto('#inp-script', 'a');
    s.typeInto('#inp-script', 'ab');
    s.typeInto('#inp-script', 'abc');
    fireEvent.blur(script);
    expect(s.graph.getNode(s.ids.a)?.script).toBe('abc');
    s.app.undo();
    expect(s.graph.getNode(s.ids.a)).not.toHaveProperty('script');
    s.app.redo();
    expect(s.graph.getNode(s.ids.a)?.script).toBe('abc');

    s.app.select({ kind: 'edge', id: s.ids.edge });
    const expression = s.field<HTMLInputElement>('#inp-expression');
    fireEvent.focus(expression);
    s.typeInto('#inp-expression', 'x');
    s.typeInto('#inp-expression', 'xy');
    fireEvent.blur(expression);
    s.app.undo();
    expect(s.graph.getEdge(s.ids.edge)).not.toHaveProperty('expression');
  });
});

describe('InspectorPanel with an edge selected', () => {
  it('shows the label, the kind, the condition, the sides with Auto, and the ends of the edge', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    expect(s.title()).toBe('Edge');
    expect(s.input().value).toBe('Yes');
    expect(s.hidden('#type-field')).toBe(true);
    expect(s.hidden('#variant-field')).toBe(true);
    expect(s.hidden('#kind-field')).toBe(false);
    expect(s.kindSelect().value).toBe('sequence');
    expect([...s.kindSelect().options].map((o) => o.textContent)).toEqual(['Sequence flow', 'Message flow', 'Association']);
    expect(s.hidden('#condition-field')).toBe(false);
    expect(s.conditionSelect().value).toBe('none');
    expect([...s.conditionSelect().options].map((o) => o.textContent)).toEqual(['Normal', 'Default', 'Conditional']);
    expect(s.hidden('#source-side-field')).toBe(false);
    expect(s.hidden('#target-side-field')).toBe(false);
    expect(s.sourceSelect().value).toBe('');
    expect([...s.sourceSelect().options].map((o) => o.textContent)).toEqual(['Auto', 'Top', 'Right', 'Bottom', 'Left']);
    expect(s.info()).toBe('A → B');
  });

  it('changes the condition of a sequence flow', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    s.choose('#sel-condition', 'default');
    expect(s.graph.getEdge(s.ids.edge)?.condition).toBe('default');
    expect(s.conditionSelect().value).toBe('default');
  });

  it('changes the kind, hiding the condition for message flows and associations', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    s.choose('#sel-condition', 'conditional');
    s.choose('#sel-kind', 'message');
    expect(s.graph.getEdge(s.ids.edge)).toMatchObject({ kind: 'message', condition: 'none' });
    expect(s.kindSelect().value).toBe('message');
    expect(s.hidden('#condition-field')).toBe(true);
    s.choose('#sel-kind', 'association');
    expect(s.hidden('#condition-field')).toBe(true);
    s.choose('#sel-kind', 'sequence');
    expect(s.hidden('#condition-field')).toBe(false);
    expect(s.conditionSelect().value).toBe('none');
  });

  it('fixes and clears the sides from the selects', () => {
    const s = setup();
    s.app.select({ kind: 'edge', id: s.ids.edge });
    s.choose('#sel-source-side', 'bottom');
    s.choose('#sel-target-side', 'top');
    expect(s.graph.getEdge(s.ids.edge)).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
    s.choose('#sel-source-side', '');
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

import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { NodeType } from '../../model/graph';
import { Field } from './Field';
import { FileButton } from './FileButton';
import { NodeListItem } from './NodeListItem';
import { ShapePicker } from './ShapePicker';
import { ToolButton } from './ToolButton';

describe('Field', () => {
  it('captions a control and can be hidden', () => {
    const [hidden, setHidden] = createSignal(false);
    const { getByLabelText, container } = render(() => (
      <Field id="type-field" label="Shape" hidden={hidden()}>
        <select />
      </Field>
    ));
    expect(getByLabelText('Shape').tagName).toBe('SELECT');
    const label = container.querySelector('label');
    expect(label?.id).toBe('type-field');
    expect(label).not.toHaveAttribute('hidden');
    setHidden(true);
    expect(label).toHaveAttribute('hidden');
  });
});

describe('ToolButton', () => {
  it('shows the shape icon and name, and reports the shape when clicked', () => {
    const picked: NodeType[] = [];
    const { getByRole } = render(() => <ToolButton type="decision" onPick={(type) => picked.push(type)} />);
    const button = getByRole('button');
    expect(button).toHaveTextContent('Decision');
    expect(button).toHaveAttribute('data-type', 'decision');
    expect(button.getAttribute('title')).not.toBe('');
    expect(button.querySelector('svg.shape-icon path')).not.toBeNull();
    fireEvent.click(button);
    expect(picked).toEqual(['decision']);
  });
});

describe('ShapePicker', () => {
  it('offers the four flowchart shapes in order', () => {
    const { container, getAllByRole } = render(() => <ShapePicker onPick={() => undefined} />);
    expect(container.querySelector('#add-node-tools')).not.toBeNull();
    const buttons = getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-type'))).toEqual(['terminal', 'process', 'decision', 'io']);
    expect(buttons.map((b) => b.textContent)).toEqual(['Terminal', 'Process', 'Decision', 'Input / Output']);
  });

  it('reports the picked shape', () => {
    const picked: NodeType[] = [];
    const { getByText } = render(() => <ShapePicker onPick={(type) => picked.push(type)} />);
    fireEvent.click(getByText('Input / Output'));
    fireEvent.click(getByText('Terminal'));
    expect(picked).toEqual(['io', 'terminal']);
  });
});

describe('NodeListItem', () => {
  it('shows the icon and the name, highlights the active one and reports selection', () => {
    const selected: string[] = [];
    const [active, setActive] = createSignal(false);
    const { getByRole } = render(() => (
      <NodeListItem id="n3" type="terminal" label="Start" active={active()} onSelect={(id) => selected.push(id)} />
    ));
    const button = getByRole('button');
    expect(button.closest('li')).not.toBeNull();
    expect(button).toHaveAttribute('data-id', 'n3');
    expect(button.querySelector('.node-name')).toHaveTextContent('Start');
    expect(button.querySelector('svg.shape-icon')).not.toBeNull();
    expect(button).not.toHaveClass('active');
    setActive(true);
    expect(button).toHaveClass('active');
    fireEvent.click(button);
    expect(selected).toEqual(['n3']);
  });

  it('falls back to the id when the name is empty', () => {
    const { getByRole } = render(() => <NodeListItem id="n9" type="process" label="" active={false} onSelect={() => undefined} />);
    expect(getByRole('button').querySelector('.node-name')).toHaveTextContent('n9');
  });
});

describe('FileButton', () => {
  function pick(input: HTMLInputElement, file: File): void {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  }

  it('looks like a button and hides the file input behind it', () => {
    const { container } = render(() => <FileButton id="file-import" label="Import JSON" accept=".json" onFile={() => undefined} />);
    const label = container.querySelector('label');
    expect(label).toHaveTextContent('Import JSON');
    expect(label).toHaveClass('btn');
    const input = label?.querySelector('input') as HTMLInputElement;
    expect(input.id).toBe('file-import');
    expect(input.type).toBe('file');
    expect(input).toHaveAttribute('hidden');
    expect(input.accept).toBe('.json');
  });

  it('hands over the chosen file and clears the input so the same file can be chosen again', async () => {
    const received: File[] = [];
    const { container } = render(() => <FileButton id="f" label="Import" accept=".json" onFile={(file) => received.push(file)} />);
    const input = container.querySelector('input') as HTMLInputElement;
    // jsdom cannot show a file dialog, so the reset is observed as the value being written back to empty.
    const written: string[] = [];
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => written[written.length - 1] ?? '',
      set: (v: string) => {
        written.push(v);
      },
    });
    const file = new File(['{"nodes":[],"edges":[]}'], 'graph.json', { type: 'application/json' });
    pick(input, file);
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('graph.json');
    expect(await received[0].text()).toBe('{"nodes":[],"edges":[]}');
    expect(written).toEqual(['']);
    pick(input, file);
    expect(received).toHaveLength(2);
  });

  it('ignores a change without a file', () => {
    const received: File[] = [];
    const { container } = render(() => <FileButton id="f" label="Import" accept=".json" onFile={(file) => received.push(file)} />);
    const input = container.querySelector('input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    fireEvent.change(input);
    expect(received).toEqual([]);
  });
});

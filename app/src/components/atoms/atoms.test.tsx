import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { NODE_TYPES, type NodeType } from '../../model/graph';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Kbd } from './Kbd';
import { Muted } from './Muted';
import { Select } from './Select';
import { ShapeIcon } from './ShapeIcon';
import { TextArea } from './TextArea';
import { TextInput } from './TextInput';

describe('Button', () => {
  it('renders a non-submitting button with its content and extra classes', () => {
    const { getByRole } = render(() => <Button class="extra">Go</Button>);
    const button = getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveTextContent('Go');
    expect(button).toHaveClass('btn', 'extra');
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  it('marks the danger variant', () => {
    const { getByRole } = render(() => <Button variant="danger">Delete</Button>);
    expect(getByRole('button')).toHaveClass('danger');
  });

  it('exposes a toggle state through aria-pressed', () => {
    const [pressed, setPressed] = createSignal(false);
    const { getByRole } = render(() => <Button pressed={pressed()}>Connect</Button>);
    expect(getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    setPressed(true);
    expect(getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('runs the click handler and honours disabled', () => {
    let clicks = 0;
    const { getByRole } = render(() => (
      <Button disabled onClick={() => clicks++}>
        Off
      </Button>
    ));
    expect(getByRole('button')).toBeDisabled();
    fireEvent.click(getByRole('button'));
    expect(clicks).toBe(0);
  });

  it('passes through ids, titles and data attributes', () => {
    const { getByRole } = render(() => (
      <Button id="btn-x" title="Hint" data-type="io" onClick={() => undefined}>
        X
      </Button>
    ));
    const button = getByRole('button');
    expect(button).toHaveAttribute('id', 'btn-x');
    expect(button).toHaveAttribute('title', 'Hint');
    expect(button).toHaveAttribute('data-type', 'io');
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    fireEvent.click(button);
    expect(clicks).toBe(1);
  });
});

describe('Checkbox', () => {
  it('renders a labelled checkbox reflecting the checked state', () => {
    const [checked, setChecked] = createSignal(true);
    const { getByLabelText } = render(() => (
      <Checkbox id="chk" label="Directed" title="Arrows" checked={checked()} onChange={() => undefined} />
    ));
    const input = getByLabelText('Directed') as HTMLInputElement;
    expect(input.id).toBe('chk');
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(true);
    expect(input.closest('label')).toHaveAttribute('title', 'Arrows');
    setChecked(false);
    expect(input.checked).toBe(false);
  });

  it('reports the new state when toggled', () => {
    const received: boolean[] = [];
    const { getByLabelText } = render(() => (
      <Checkbox id="chk" label="Orthogonal" checked={false} onChange={(on) => received.push(on)} />
    ));
    fireEvent.click(getByLabelText('Orthogonal'));
    expect(received).toEqual([true]);
  });
});

describe('TextInput', () => {
  it('shows the value and reports what is typed', () => {
    const typed: string[] = [];
    const [value, setValue] = createSignal('Start');
    const { getByRole } = render(() => <TextInput id="inp" value={value()} onInput={(v) => typed.push(v)} />);
    const input = getByRole('textbox') as HTMLInputElement;
    expect(input.id).toBe('inp');
    expect(input.value).toBe('Start');
    fireEvent.input(input, { target: { value: 'Begin' } });
    expect(typed).toEqual(['Begin']);
    setValue('Other');
    expect(input.value).toBe('Other');
  });

  it('reports focus, blur and key presses, and hands over its element', () => {
    const events: string[] = [];
    let element: HTMLInputElement | undefined;
    const { getByRole } = render(() => (
      <TextInput
        value=""
        ref={(el) => (element = el)}
        onInput={() => undefined}
        onFocus={() => events.push('focus')}
        onBlur={() => events.push('blur')}
        onKeyDown={(e) => events.push(`key:${e.key}`)}
      />
    ));
    const input = getByRole('textbox');
    expect(element).toBe(input);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(events).toEqual(['focus', 'key:Enter', 'blur']);
  });
});

describe('TextArea', () => {
  it('shows the value in a multi-line field, reports what is typed, focus and blur', () => {
    const typed: string[] = [];
    const events: string[] = [];
    const [value, setValue] = createSignal('log(1);');
    const { getByRole } = render(() => (
      <TextArea
        id="code"
        rows={6}
        placeholder="vars.x = 1;"
        value={value()}
        onInput={(v) => typed.push(v)}
        onFocus={() => events.push('focus')}
        onBlur={() => events.push('blur')}
      />
    ));
    const area = getByRole('textbox') as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.id).toBe('code');
    expect(area.rows).toBe(6);
    expect(area.placeholder).toBe('vars.x = 1;');
    expect(area.value).toBe('log(1);');
    fireEvent.input(area, { target: { value: 'log(2);\nlog(3);' } });
    expect(typed).toEqual(['log(2);\nlog(3);']);
    setValue('other');
    expect(area.value).toBe('other');
    fireEvent.focus(area);
    fireEvent.blur(area);
    expect(events).toEqual(['focus', 'blur']);
  });

  it('defaults to a few rows', () => {
    const { getByRole } = render(() => <TextArea value="" onInput={() => undefined} />);
    expect((getByRole('textbox') as HTMLTextAreaElement).rows).toBeGreaterThanOrEqual(2);
  });
});

describe('Select', () => {
  const options = [
    { value: '', label: 'Auto' },
    { value: 'top', label: 'Top' },
    { value: 'left', label: 'Left' },
  ];

  it('lists the options in order and selects the one matching the value', () => {
    const [value, setValue] = createSignal('top');
    const { getByRole, getAllByRole } = render(() => <Select id="sel" value={value()} options={options} onChange={() => undefined} />);
    const select = getByRole('combobox') as HTMLSelectElement;
    expect(select.id).toBe('sel');
    expect(getAllByRole('option').map((o) => o.textContent)).toEqual(['Auto', 'Top', 'Left']);
    expect(select.value).toBe('top');
    setValue('');
    expect(select.value).toBe('');
  });

  it('reports the chosen value', () => {
    const chosen: string[] = [];
    const { getByRole } = render(() => <Select value="" options={options} onChange={(v) => chosen.push(v)} />);
    fireEvent.change(getByRole('combobox'), { target: { value: 'left' } });
    expect(chosen).toEqual(['left']);
  });
});

describe('Kbd', () => {
  it('renders a keyboard shortcut label', () => {
    const { container } = render(() => <Kbd>C</Kbd>);
    const kbd = container.querySelector('kbd');
    expect(kbd).toHaveTextContent('C');
    expect(kbd).toHaveClass('kbd');
  });
});

describe('ShapeIcon', () => {
  it('draws a closed outline for every element, tagged with its type and hidden from assistive technology', () => {
    for (const type of NODE_TYPES) {
      const { container } = render(() => <ShapeIcon type={type} />);
      const svg = container.querySelector('svg.shape-icon');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('data-type', type);
      const d = svg?.querySelector('path.outline')?.getAttribute('d') ?? '';
      expect(d.startsWith('M')).toBe(true);
      expect(d.trim().endsWith('Z')).toBe(true);
    }
  });

  it('uses the BPMN geometry: circles for events, a rhombus for gateways, and the marks of each element', () => {
    const icon = (type: NodeType, variant?: string) => render(() => <ShapeIcon type={type} variant={variant} />).container.querySelector('svg') as SVGSVGElement;
    expect(icon('start-event').querySelector('path.outline')?.getAttribute('d')).toContain('A 18 18');
    expect(icon('gateway').querySelector('path.outline')?.getAttribute('d')).toBe('M 0 -25 L 25 0 L 0 25 L -25 0 Z');
    expect(icon('task').querySelector('path.outline')?.getAttribute('d')).toContain('A 10 10');
    expect(icon('intermediate-event').querySelector('path.decoration.inner')).not.toBeNull();
    expect(icon('end-event', 'terminate').querySelector('path.decoration.disc')).not.toBeNull();
    expect(icon('subprocess').querySelector('path.decoration.marker')).not.toBeNull();
    expect(icon('annotation').querySelector('path.decoration.bracket')).not.toBeNull();
    expect(icon('data-object').querySelector('path.decoration.fold')).not.toBeNull();
    expect(icon('gateway').querySelector('path.glyph')).not.toBeNull();
    expect(icon('task').querySelector('path.glyph')).toBeNull();
    expect(icon('task', 'user').querySelector('path.glyph')).not.toBeNull();
  });
});

describe('Muted', () => {
  it('renders secondary text that can be hidden', () => {
    const [hidden, setHidden] = createSignal(false);
    const { getByText } = render(() => (
      <Muted id="hint" hidden={hidden()}>
        Nothing selected
      </Muted>
    ));
    const p = getByText('Nothing selected');
    expect(p).toHaveClass('muted');
    expect(p.id).toBe('hint');
    expect(p).not.toHaveAttribute('hidden');
    setHidden(true);
    expect(p).toHaveAttribute('hidden');
  });
});

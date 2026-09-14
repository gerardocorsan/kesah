import { For } from 'solid-js';
import './controls.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

/** Atom: a drop-down. The selected option follows `value`. */
export function Select(props: SelectProps) {
  return (
    <select id={props.id} class="control" onChange={(e) => props.onChange(e.currentTarget.value)}>
      <For each={props.options}>
        {(option) => (
          <option value={option.value} selected={option.value === props.value}>
            {option.label}
          </option>
        )}
      </For>
    </select>
  );
}

import './controls.css';

export interface CheckboxProps {
  id: string;
  label: string;
  checked: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}

/** Atom: a labelled checkbox. */
export function Checkbox(props: CheckboxProps) {
  return (
    <label class="checkbox" title={props.title}>
      <input id={props.id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />{' '}
      {props.label}
    </label>
  );
}

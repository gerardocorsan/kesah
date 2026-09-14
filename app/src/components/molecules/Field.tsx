import type { JSX } from 'solid-js';
import './field.css';

/** Molecule: a caption above a control. */
export function Field(props: { id?: string; label: string; hidden?: boolean; children: JSX.Element }) {
  return (
    <label id={props.id} class="field" hidden={props.hidden}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

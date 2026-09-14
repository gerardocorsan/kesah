import type { JSX } from 'solid-js';

/** Atom: secondary text (hints, counts, descriptions). */
export function Muted(props: { id?: string; hidden?: boolean; children?: JSX.Element }) {
  return (
    <p id={props.id} class="muted" hidden={props.hidden}>
      {props.children}
    </p>
  );
}

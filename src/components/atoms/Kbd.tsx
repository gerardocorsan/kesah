import type { JSX } from 'solid-js';
import './kbd.css';

/** Atom: a keyboard shortcut label, shown next to the action it triggers. */
export function Kbd(props: { children: JSX.Element }) {
  return <kbd class="kbd">{props.children}</kbd>;
}

import { splitProps, type JSX } from 'solid-js';
import './button.css';

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'danger';
  /** For toggle buttons: renders aria-pressed so the state is visible and accessible. */
  pressed?: boolean;
}

/** Atom: a plain button. Everything else that looks like a button builds on it. */
export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['variant', 'pressed', 'class']);
  return (
    <button
      type="button"
      class={['btn', local.variant === 'danger' ? 'danger' : '', local.class ?? ''].join(' ').trim()}
      aria-pressed={local.pressed === undefined ? undefined : local.pressed ? 'true' : 'false'}
      {...rest}
    />
  );
}

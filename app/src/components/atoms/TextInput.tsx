import './controls.css';

export interface TextInputProps {
  id?: string;
  value: string;
  ref?: (el: HTMLInputElement) => void;
  onInput: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

/** Atom: a single-line text field. */
export function TextInput(props: TextInputProps) {
  return (
    <input
      id={props.id}
      ref={props.ref}
      class="control"
      type="text"
      autocomplete="off"
      spellcheck={false}
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      onFocus={() => props.onFocus?.()}
      onBlur={() => props.onBlur?.()}
      onKeyDown={(e) => props.onKeyDown?.(e)}
    />
  );
}

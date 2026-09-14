import './controls.css';

export interface TextAreaProps {
  id?: string;
  value: string;
  rows?: number;
  placeholder?: string;
  onInput: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** Atom: a multi-line text field for code, in a monospaced face. */
export function TextArea(props: TextAreaProps) {
  return (
    <textarea
      id={props.id}
      class="control control-code"
      rows={props.rows ?? 4}
      placeholder={props.placeholder}
      autocomplete="off"
      spellcheck={false}
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      onFocus={() => props.onFocus?.()}
      onBlur={() => props.onBlur?.()}
    />
  );
}

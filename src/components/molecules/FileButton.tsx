import '../atoms/button.css';

export interface FileButtonProps {
  id: string;
  label: string;
  accept: string;
  onFile: (file: File) => void;
}

/** Molecule: a button that opens the file picker and hands over the chosen file. */
export function FileButton(props: FileButtonProps) {
  return (
    <label class="btn file-button">
      {props.label}
      <input
        id={props.id}
        type="file"
        accept={props.accept}
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ''; // allows picking the same file again
          if (file) props.onFile(file);
        }}
      />
    </label>
  );
}

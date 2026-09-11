import { For } from 'solid-js';
import { NODE_TYPES, type NodeType } from '../../model/graph';
import { ToolButton } from './ToolButton';
import './tool-button.css';

/** Molecule: one "add" button per node shape. */
export function ShapePicker(props: { onPick: (type: NodeType) => void }) {
  return (
    <div id="add-node-tools" class="tool-grid">
      <For each={NODE_TYPES}>{(type) => <ToolButton type={type} onPick={props.onPick} />}</For>
    </div>
  );
}

import { For } from 'solid-js';
import type { NodeType } from '../../model/graph';
import { NODE_GROUPS, typesInGroup } from '../labels';
import { ToolButton } from './ToolButton';
import './tool-button.css';

/** Molecule: one "add" button per BPMN element, grouped as events, activities, gateways and artifacts. */
export function ShapePicker(props: { onPick: (type: NodeType) => void }) {
  return (
    <div id="add-node-tools" class="tool-groups">
      <For each={NODE_GROUPS}>
        {(group) => (
          <div class="tool-group">
            <h3>{group}</h3>
            <div class="tool-grid">
              <For each={typesInGroup(group)}>{(type) => <ToolButton type={type} onPick={props.onPick} />}</For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

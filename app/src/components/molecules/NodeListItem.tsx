import type { NodeId, NodeType } from '../../model/graph';
import { Button } from '../atoms/Button';
import { ShapeIcon } from '../atoms/ShapeIcon';
import './node-list-item.css';

export interface NodeListItemProps {
  id: NodeId;
  type: NodeType;
  label: string;
  active: boolean;
  onSelect: (id: NodeId) => void;
}

/** Molecule: one row of the node list, with the shape icon and the name. */
export function NodeListItem(props: NodeListItemProps) {
  return (
    <li>
      <Button class="node-item" classList={{ active: props.active }} data-id={props.id} onClick={() => props.onSelect(props.id)}>
        <ShapeIcon type={props.type} />
        <span class="node-name">{props.label || props.id}</span>
      </Button>
    </li>
  );
}

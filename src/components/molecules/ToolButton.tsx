import type { NodeType } from '../../model/graph';
import { Button } from '../atoms/Button';
import { ShapeIcon } from '../atoms/ShapeIcon';
import { NODE_TYPE_INFO } from '../labels';
import './tool-button.css';

/** Molecule: a button that adds a node of one shape, showing the shape and its name. */
export function ToolButton(props: { type: NodeType; onPick: (type: NodeType) => void }) {
  const info = () => NODE_TYPE_INFO[props.type];
  return (
    <Button class="tool-button add-node" data-type={props.type} title={info().title} onClick={() => props.onPick(props.type)}>
      <ShapeIcon type={props.type} />
      {info().name}
    </Button>
  );
}

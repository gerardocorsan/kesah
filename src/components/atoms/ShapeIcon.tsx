import type { NodeType } from '../../model/graph';
import { shapePath } from '../../model/shapes';
import './shape-icon.css';

/** Atom: a small outline of a node type, drawn with the same geometry as the canvas. */
export function ShapeIcon(props: { type: NodeType }) {
  return (
    <svg class="shape-icon" viewBox="-16 -10 32 20" aria-hidden="true">
      <path d={shapePath(props.type, { width: 28, height: 16 })} />
    </svg>
  );
}

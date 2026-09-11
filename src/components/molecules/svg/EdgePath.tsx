import { createMemo } from 'solid-js';
import type { GraphEdge } from '../../../model/graph';
import { routeOf } from '../../../model/layout';
import { labelAnchor, roundedPath } from '../../../model/routing';
import { useApp } from '../../../state/app';
import './svg.css';

const ELBOW_RADIUS = 8;

/** Molecule (SVG): an edge on the canvas — a wide invisible hit area, the visible line and its label. */
export function EdgePath(props: { edge: GraphEdge }) {
  const app = useApp();

  const selected = createMemo(() => {
    const s = app.selection();
    return s?.kind === 'edge' && s.id === props.edge.id;
  });
  const label = createMemo(() => (app.revision(), props.edge.label));
  const points = createMemo(() => {
    const layout = app.layoutOf(props.edge.id);
    return layout ? routeOf(layout, app.edgeStyle(), app.sizeOf) : [];
  });
  const d = createMemo(() => roundedPath(points(), app.edgeStyle() === 'orthogonal' ? ELBOW_RADIUS : 0));
  const at = createMemo(() => labelAnchor(points()));
  const marker = () => (app.directed() ? (selected() ? 'url(#arrow-selected)' : 'url(#arrow)') : undefined);

  return (
    <g class="edge" classList={{ selected: selected() }} data-id={props.edge.id}>
      <path class="edge-hit" d={d()} />
      <path class="edge-line" d={d()} marker-end={marker()} />
      <text class="edge-label" x={at().x} y={at().y}>
        {label()}
      </text>
    </g>
  );
}

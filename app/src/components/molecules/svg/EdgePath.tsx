import { createMemo } from 'solid-js';
import type { GraphEdge } from '../../../model/graph';
import { routeOf } from '../../../model/layout';
import { labelAnchor, roundedPath } from '../../../model/routing';
import { useApp } from '../../../state/app';
import './svg.css';

const ELBOW_RADIUS = 8;

/**
 * Molecule (SVG): an edge on the canvas — a wide invisible hit area, the visible line
 * with the markers of its kind, and its label. Sequence flows end in a filled arrowhead
 * and may start with a default or conditional marker; message flows are dashed with an
 * open arrowhead and a dot at the source; associations are dotted with no arrowhead.
 */
export function EdgePath(props: { edge: GraphEdge }) {
  const app = useApp();

  const selected = createMemo(() => {
    const s = app.selection();
    return s?.kind === 'edge' && s.id === props.edge.id;
  });
  const label = createMemo(() => (app.revision(), props.edge.label));
  const kind = createMemo(() => (app.revision(), props.edge.kind));
  const condition = createMemo(() => (app.revision(), props.edge.condition));
  const points = createMemo(() => {
    const layout = app.layoutOf(props.edge.id);
    return layout ? routeOf(layout, app.edgeStyle(), app.sizeOf) : [];
  });
  const d = createMemo(() => roundedPath(points(), app.edgeStyle() === 'orthogonal' ? ELBOW_RADIUS : 0));
  const at = createMemo(() => labelAnchor(points()));

  const marker = (id: string | null): string | undefined => (id ? `url(#${id}${selected() ? '-selected' : ''})` : undefined);
  const markerEnd = () => marker(kind() === 'association' ? null : kind() === 'message' ? 'arrow-open' : 'arrow');
  const markerStart = () => {
    if (kind() === 'message') return marker('message-start');
    if (kind() !== 'sequence') return undefined;
    return marker(condition() === 'default' ? 'flow-default' : condition() === 'conditional' ? 'flow-conditional' : null);
  };

  return (
    <g
      class="edge"
      classList={{
        selected: selected(),
        'edge-sequence': kind() === 'sequence',
        'edge-message': kind() === 'message',
        'edge-association': kind() === 'association',
      }}
      data-id={props.edge.id}
      data-kind={kind()}
    >
      <path class="edge-hit" d={d()} />
      <path class="edge-line" d={d()} marker-end={markerEnd()} marker-start={markerStart()} />
      <text class="edge-label" x={at().x} y={at().y}>
        {label()}
      </text>
    </g>
  );
}

import { For } from 'solid-js';
import './svg.css';

interface MarkerSpec {
  id: string;
  viewBox: string;
  width: number;
  height: number;
  refX: number;
  refY: number;
  d: string;
  /** Class of the path; the stylesheet colours each role. */
  role: string;
}

/** Every marker an edge can reference: arrowheads at the target, flow marks and the message dot at the source. */
const MARKERS: MarkerSpec[] = [
  { id: 'arrow', viewBox: '0 0 10 10', width: 12, height: 12, refX: 10, refY: 5, d: 'M 0 0 L 10 5 L 0 10 z', role: 'arrow-head' },
  { id: 'arrow-open', viewBox: '0 0 10 10', width: 12, height: 12, refX: 10, refY: 5, d: 'M 0 0 L 10 5 L 0 10', role: 'arrow-open' },
  // Drawn a little way along the first segment, so refX is negative.
  { id: 'flow-default', viewBox: '0 0 10 10', width: 10, height: 10, refX: -6, refY: 5, d: 'M 2 9 L 8 1', role: 'flow-mark' },
  { id: 'flow-conditional', viewBox: '0 0 14 10', width: 14, height: 10, refX: 0, refY: 5, d: 'M 0 5 L 7 0 L 14 5 L 7 10 Z', role: 'flow-diamond' },
  { id: 'message-start', viewBox: '0 0 10 10', width: 10, height: 10, refX: 1, refY: 5, d: 'M 5 1.5 A 3.5 3.5 0 1 1 5 8.5 A 3.5 3.5 0 1 1 5 1.5 Z', role: 'message-dot' },
];

function Marker(props: { spec: MarkerSpec; selected: boolean }) {
  return (
    <marker
      id={props.selected ? `${props.spec.id}-selected` : props.spec.id}
      viewBox={props.spec.viewBox}
      refX={props.spec.refX}
      refY={props.spec.refY}
      markerWidth={props.spec.width}
      markerHeight={props.spec.height}
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      <path d={props.spec.d} class={props.spec.role} classList={{ selected: props.selected }} />
    </marker>
  );
}

/** Molecule (SVG): the markers referenced by edges via marker-start and marker-end, each with a selected twin. Goes inside <defs>. */
export function ArrowMarkers() {
  return (
    <For each={MARKERS}>
      {(spec) => (
        <>
          <Marker spec={spec} selected={false} />
          <Marker spec={spec} selected={true} />
        </>
      )}
    </For>
  );
}

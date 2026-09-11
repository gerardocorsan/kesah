import './svg.css';

function ArrowMarker(props: { id: string; selected: boolean }) {
  return (
    <marker
      id={props.id}
      viewBox="0 0 10 10"
      refX={10}
      refY={5}
      markerWidth={12}
      markerHeight={12}
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head" classList={{ selected: props.selected }} />
    </marker>
  );
}

/** Molecule (SVG): the arrowheads referenced by edges via marker-end. Goes inside <defs>. */
export function ArrowMarkers() {
  return (
    <>
      <ArrowMarker id="arrow" selected={false} />
      <ArrowMarker id="arrow-selected" selected={true} />
    </>
  );
}

import './svg.css';

const GRID_SIZE = 24;

/** Molecule (SVG): the dotted background, moving with the camera. Goes inside <defs>. */
export function GridPattern(props: { transform: string }) {
  return (
    <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse" patternTransform={props.transform}>
      <circle class="grid-dot" cx={1} cy={1} r={1} />
    </pattern>
  );
}

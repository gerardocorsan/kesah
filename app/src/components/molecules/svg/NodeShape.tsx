import { createEffect, createMemo, For, Show } from 'solid-js';
import { SIDES, type GraphNode } from '../../../model/graph';
import { LABEL_BELOW_GAP, decorations, growsWithLabel, labelPlacement, pointOnSide, shapePath, shapeSize } from '../../../model/shapes';
import { glyphFor } from '../../../model/glyphs';
import { useApp } from '../../../state/app';
import './svg.css';

const PORT_RADIUS = 5;
const ANNOTATION_TEXT_INSET = 8;

/**
 * Molecule (SVG): a node on the canvas — outline, decorations, glyph, label and the
 * four side handles. Measures its label when the shape grows with it and publishes
 * the resulting box to the app state, where edges, fit-to-view and placement read it.
 */
export function NodeShape(props: { node: GraphNode }) {
  const app = useApp();
  let textEl!: SVGTextElement;

  // The graph mutates nodes in place, so each field is re-read on every revision;
  // memos stop the propagation when the value did not actually change.
  const label = createMemo(() => (app.revision(), props.node.label));
  const type = createMemo(() => (app.revision(), props.node.type));
  const variant = createMemo(() => (app.revision(), props.node.variant));
  const x = createMemo(() => (app.revision(), props.node.x));
  const y = createMemo(() => (app.revision(), props.node.y));
  const selected = createMemo(() => {
    const s = app.selection();
    return s?.kind === 'node' && s.id === props.node.id;
  });
  const size = () => app.sizeOf(props.node);
  const below = () => labelPlacement(type()) === 'below';
  const alignStart = () => type() === 'annotation';
  const labelX = () => (alignStart() ? -size().width / 2 + ANNOTATION_TEXT_INSET : 0);
  const labelY = () => (below() ? size().height / 2 + LABEL_BELOW_GAP : 0);

  // Only shapes that grow with their label need measuring; the others have a fixed box.
  createEffect(() => {
    const currentType = type();
    label();
    const width = growsWithLabel(currentType) ? textEl.getComputedTextLength() : 0;
    app.setSize(props.node.id, shapeSize(currentType, width));
  });

  return (
    <g
      class="node"
      classList={{ selected: selected() }}
      data-id={props.node.id}
      data-type={type()}
      data-variant={variant()}
      transform={`translate(${x()} ${y()})`}
    >
      <path class="shape" d={shapePath(type(), size())} />
      <For each={decorations(type(), variant(), size())}>{(decoration) => <path class={`decoration ${decoration.role}`} d={decoration.d} />}</For>
      <Show when={glyphFor(type(), variant(), size())}>
        {(glyph) => <path class="glyph" d={glyph().d} transform={`translate(${glyph().x} ${glyph().y}) scale(${glyph().scale})`} />}
      </Show>
      <text ref={textEl} classList={{ 'label-below': below(), 'align-start': alignStart() }} x={labelX()} y={labelY()}>
        {label()}
      </text>
      <For each={SIDES}>
        {(side) => {
          const p = () => pointOnSide(type(), size(), side);
          return <circle class="port" data-side={side} r={PORT_RADIUS} cx={p().x} cy={p().y} />;
        }}
      </For>
    </g>
  );
}

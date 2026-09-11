import { createEffect, createMemo, For } from 'solid-js';
import { SIDES, type GraphNode } from '../../../model/graph';
import { pointOnSide, shapePath, shapeSize } from '../../../model/shapes';
import { useApp } from '../../../state/app';
import './svg.css';

const PORT_RADIUS = 5;

/**
 * Molecule (SVG): a node on the canvas — outline, label and the four side handles.
 * Measures its label once per change and publishes the resulting box to the app state,
 * where edges, fit-to-view and node placement read it.
 */
export function NodeShape(props: { node: GraphNode }) {
  const app = useApp();
  let textEl!: SVGTextElement;

  // The graph mutates nodes in place, so each field is re-read on every revision;
  // memos stop the propagation when the value did not actually change.
  const label = createMemo(() => (app.revision(), props.node.label));
  const type = createMemo(() => (app.revision(), props.node.type));
  const x = createMemo(() => (app.revision(), props.node.x));
  const y = createMemo(() => (app.revision(), props.node.y));
  const selected = createMemo(() => {
    const s = app.selection();
    return s?.kind === 'node' && s.id === props.node.id;
  });
  const size = () => app.sizeOf(props.node);

  // Measuring the text forces a layout, so it only happens when the label or the type changes.
  createEffect(() => {
    const currentType = type();
    label();
    app.setSize(props.node.id, shapeSize(currentType, textEl.getComputedTextLength()));
  });

  return (
    <g class="node" classList={{ selected: selected() }} data-id={props.node.id} data-type={type()} transform={`translate(${x()} ${y()})`}>
      <path class="shape" d={shapePath(type(), size())} />
      <text ref={textEl}>{label()}</text>
      <For each={SIDES}>
        {(side) => {
          const p = () => pointOnSide(type(), size(), side);
          return <circle class="port" data-side={side} r={PORT_RADIUS} cx={p().x} cy={p().y} />;
        }}
      </For>
    </g>
  );
}

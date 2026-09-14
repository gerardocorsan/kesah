import { For, Show } from 'solid-js';
import { defaultVariant, type NodeType } from '../../model/graph';
import { glyphFor } from '../../model/glyphs';
import { decorations, shapePath, shapeSize } from '../../model/shapes';
import './shape-icon.css';

const ICON_MARGIN = 4;

/** Atom: a small picture of a node type, drawn with the same geometry as the canvas and scaled into the icon box. */
export function ShapeIcon(props: { type: NodeType; variant?: string }) {
  const size = () => shapeSize(props.type, 0);
  const variant = () => props.variant ?? defaultVariant(props.type);
  const viewBox = () => {
    const { width, height } = size();
    return `${-width / 2 - ICON_MARGIN} ${-height / 2 - ICON_MARGIN} ${width + 2 * ICON_MARGIN} ${height + 2 * ICON_MARGIN}`;
  };
  return (
    <svg class="shape-icon" viewBox={viewBox()} data-type={props.type} aria-hidden="true">
      <path class="outline" d={shapePath(props.type, size())} vector-effect="non-scaling-stroke" />
      <For each={decorations(props.type, variant(), size())}>
        {(decoration) => <path class={`decoration ${decoration.role}`} d={decoration.d} vector-effect="non-scaling-stroke" />}
      </For>
      <Show when={glyphFor(props.type, variant(), size())}>
        {(glyph) => (
          <path class="glyph" d={glyph().d} transform={`translate(${glyph().x} ${glyph().y}) scale(${glyph().scale})`} vector-effect="non-scaling-stroke" />
        )}
      </Show>
    </svg>
  );
}

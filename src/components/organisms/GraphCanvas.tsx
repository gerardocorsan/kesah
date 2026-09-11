import { createMemo, For, onCleanup, onMount, Show } from 'solid-js';
import { useApp } from '../../state/app';
import { ArrowMarkers } from '../molecules/svg/ArrowMarkers';
import { GridPattern } from '../molecules/svg/GridPattern';
import { NodeShape } from '../molecules/svg/NodeShape';
import { EdgePath } from '../molecules/svg/EdgePath';
import { attachGestures } from './gestures';
import './graph-canvas.css';

/** Organism: the drawing surface — grid, edges, nodes and the edge being dragged. */
export function GraphCanvas() {
  const app = useApp();
  let svg!: SVGSVGElement;

  const transform = () => {
    const v = app.view();
    return `translate(${v.tx} ${v.ty}) scale(${v.scale})`;
  };

  // The node being dragged is rendered last so it stays above the others.
  const orderedNodes = createMemo(() => {
    const list = app.nodes();
    const front = app.frontNode();
    const index = front === null ? -1 : list.findIndex((node) => node.id === front);
    if (index < 0 || index === list.length - 1) return list;
    return [...list.slice(0, index), ...list.slice(index + 1), list[index]];
  });

  const canvas = (
    <main id="canvas" class="canvas" classList={{ 'connect-mode': app.connectMode(), connecting: app.connecting() }}>
      <svg ref={svg} class="graph-editor">
        <defs>
          <ArrowMarkers />
          <GridPattern transform={transform()} />
        </defs>
        <rect class="background" width="100%" height="100%" fill="url(#grid)" />
        <g class="viewport" transform={transform()}>
          <g class="edges">
            <For each={app.edges()}>{(edge) => <EdgePath edge={edge} />}</For>
          </g>
          <g class="nodes">
            <For each={orderedNodes()}>{(node) => <NodeShape node={node} />}</For>
          </g>
          <Show when={app.preview()}>
            {(line) => (
              <line
                class="edge-preview"
                x1={line().x1}
                y1={line().y1}
                x2={line().x2}
                y2={line().y2}
                marker-end={app.directed() ? 'url(#arrow)' : undefined}
              />
            )}
          </Show>
        </g>
      </svg>
    </main>
  );

  // Registered after the children are created, so their measuring effects run before the first fit.
  onMount(() => {
    app.registerCanvas(svg);
    app.fitView();
    onCleanup(attachGestures(svg, app));
  });

  return canvas;
}

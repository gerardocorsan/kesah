import { For } from 'solid-js';
import { useApp } from '../../state/app';
import { NodeListItem } from '../molecules/NodeListItem';
import './panel.css';

/** Organism: every node by name; clicking one selects it and brings it into view. */
export function NodeListPanel() {
  const app = useApp();
  const selectedId = () => {
    const s = app.selection();
    return s?.kind === 'node' ? s.id : null;
  };

  return (
    <section class="panel panel-grow">
      <h2>
        Nodes <span id="node-count" class="count">{app.nodeCount()}</span>
      </h2>
      <ul id="node-list" class="node-list">
        <For each={app.nodes()}>
          {(node) => {
            // The graph mutates nodes in place, so the fields are re-read on every revision.
            const type = () => {
              app.revision();
              return node.type;
            };
            const label = () => {
              app.revision();
              return node.label;
            };
            return (
              <NodeListItem
                id={node.id}
                type={type()}
                label={label()}
                active={selectedId() === node.id}
                onSelect={(id) => {
                  app.select({ kind: 'node', id });
                  app.revealNode(id);
                }}
              />
            );
          }}
        </For>
      </ul>
    </section>
  );
}

import type { NodeType } from '../../model/graph';
import { freeSpot } from '../../model/layout';
import { useApp } from '../../state/app';
import { Button } from '../atoms/Button';
import { Kbd } from '../atoms/Kbd';
import { ShapePicker } from '../molecules/ShapePicker';
import './panel.css';

/** Organism: adding nodes by shape and toggling connect mode. */
export function ToolsPanel() {
  const app = useApp();

  const addNode = (type: NodeType): void => {
    const spot = freeSpot(app.graph.nodeList, app.viewCenter(), type);
    app.addNodeAt(spot, type);
    app.requestEdit();
  };

  return (
    <section class="panel">
      <h2>Add node</h2>
      <ShapePicker onPick={addNode} />
      <Button
        id="btn-connect"
        pressed={app.connectMode()}
        title="Connect mode: drag from one node to another. Press C to toggle it, Escape to leave it, or hold Shift for a single edge"
        onClick={() => app.setConnectMode(!app.connectMode())}
      >
        Connect <Kbd>C</Kbd>
      </Button>
    </section>
  );
}

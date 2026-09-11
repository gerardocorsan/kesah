import { Toolbar } from '../organisms/Toolbar';
import { ToolsPanel } from '../organisms/ToolsPanel';
import { InspectorPanel } from '../organisms/InspectorPanel';
import { NodeListPanel } from '../organisms/NodeListPanel';
import { GraphCanvas } from '../organisms/GraphCanvas';
import './app-layout.css';

/** Template: toolbar on top, side panel and canvas in the middle, a one-line hint at the bottom. */
export function AppLayout() {
  return (
    <>
      <Toolbar />
      <div class="workspace">
        <aside class="sidebar" aria-label="Graph tools">
          <ToolsPanel />
          <InspectorPanel />
          <NodeListPanel />
        </aside>
        <GraphCanvas />
      </div>
      <footer class="hint">
        Double-click the background: new node · Drag a node: move · Drag a side handle (or Shift + drag) from one node to
        another: connect · C: toggle connect mode · Double-click a node or edge: rename · Delete: remove the selection ·
        Escape: deselect · Ctrl+Z / Ctrl+Shift+Z: undo / redo · Wheel: zoom · Drag the background: pan
      </footer>
    </>
  );
}

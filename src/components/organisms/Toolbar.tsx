import { Graph } from '../../model/graph';
import { useApp } from '../../state/app';
import { Button } from '../atoms/Button';
import { Checkbox } from '../atoms/Checkbox';
import { FileButton } from '../molecules/FileButton';
import './toolbar.css';

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Organism: document-level actions — new, directed/orthogonal switches, fit, export and import. */
export function Toolbar() {
  const app = useApp();
  const status = () => `${count(app.nodeCount(), 'node', 'nodes')} · ${count(app.edgeCount(), 'edge', 'edges')}`;

  const newGraph = (): void => {
    if (app.nodeCount() > 0 && !window.confirm('Discard the current graph and start over?')) return;
    app.graph.clear();
    app.fitView();
  };

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(app.graph.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'graph.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (file: File): Promise<void> => {
    try {
      app.graph.load(Graph.parse(JSON.parse(await file.text())));
      app.select(null);
      app.fitView();
    } catch (error) {
      window.alert(`Could not import the file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <header class="toolbar">
      <h1>Kesah</h1>
      <Button id="btn-new" title="Clear the canvas" onClick={newGraph}>
        New
      </Button>
      <Button id="btn-undo" title="Undo (Ctrl+Z)" disabled={!app.canUndo()} onClick={() => app.undo()}>
        Undo
      </Button>
      <Button id="btn-redo" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" disabled={!app.canRedo()} onClick={() => app.redo()}>
        Redo
      </Button>
      <Checkbox
        id="chk-directed"
        label="Directed"
        title="Edges have a direction and are drawn with an arrowhead"
        checked={app.directed()}
        onChange={(on) => app.graph.setDirected(on)}
      />
      <Checkbox
        id="chk-orthogonal"
        label="Orthogonal"
        title="Edges run along axis-aligned segments with elbows instead of straight lines"
        checked={app.edgeStyle() === 'orthogonal'}
        onChange={(on) => app.graph.setEdgeStyle(on ? 'orthogonal' : 'straight')}
      />
      <Button id="btn-fit" title="Fit the whole graph in view" onClick={() => app.fitView()}>
        Fit view
      </Button>
      <span class="spacer" />
      <Button id="btn-export" onClick={exportJson}>
        Export JSON
      </Button>
      <FileButton id="file-import" label="Import JSON" accept="application/json,.json" onFile={(file) => void importJson(file)} />
      <span id="status" class="status" aria-live="polite">
        {status()}
      </span>
    </header>
  );
}

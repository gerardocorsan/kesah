# Kesah, visual graph editor

A web application for drawing graphs (nodes and edges) using the mouse. Built with HTML and TypeScript, with no runtime libraries: the drawing is pure SVG, and Vite is used only for development and bundling.

## Getting started

```bash
npm install
npm run dev      # development server at http://localhost:5173
npm run build    # type-check and generate dist/
npm run preview  # serve dist/ to test the final version
```

## Controls

| Action | How to |
| --- | --- |
| Create node | Pick a shape under "Add node" in the left panel, or double-click the background for a process |
| Change a node's shape | Select it and pick another shape in the left panel |
| Move node | Drag it |
| Connect two nodes | Shift + drag from one to the other, or activate "Connect" mode in the left panel and drag |
| Rename node or label edge | Select it and edit the name in the left panel, or double-click it |
| Select | Click a node or an edge, or click a name in the node list of the left panel |
| Delete | Delete or Backspace key while selected, or "Delete" in the left panel |
| Zoom | Mouse wheel |
| Pan canvas | Drag the background, or use the middle mouse button |
| Directed / undirected | "Directed" checkbox |

The graph is automatically saved to `localStorage`, so it persists across page reloads. "Export JSON" downloads the file, and "Import JSON" loads it.

## Node shapes

The four classic flowchart symbols. Every shape grows horizontally to fit its label.

| Type | Shape | Meaning |
| --- | --- | --- |
| `terminal` | Pill | Start or end of the flow |
| `process` | Rounded rectangle | An action or step |
| `decision` | Diamond | A question; label the outgoing edges with the answers |
| `io` | Parallelogram | Data entering or leaving the flow |

## Structure

- `src/graph.ts`: the model. Nodes, edges, JSON validation, and change notifications. Does not touch the DOM.
- `src/shapes.ts`: geometry of the node shapes. Size for a label, SVG outline and where an edge meets the border. No DOM either.
- `src/editor.ts`: the view. Renders the graph in an `<svg>` element and translates pointer gestures into operations on the model.
- `src/sidebar.ts`: the left panel. Editing tools, the properties of the selected element and the node list.
- `src/main.ts`: toolbar, autosave, import, and export functionality.
- `src/dom.ts`: a small DOM lookup helper.
- `src/style.css`: interface and canvas styles.

## JSON format

```json
{
  "directed": true,
  "nodes": [
    { "id": "n1", "label": "Start", "type": "terminal", "x": 300, "y": 60 },
    { "id": "n2", "label": "Valid?", "type": "decision", "x": 300, "y": 160 }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "" }
  ]
}
```

`type` is one of `terminal`, `process`, `decision` or `io`. A node without a type is loaded as a `process`, so files written before shapes existed still work.

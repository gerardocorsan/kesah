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
| Create node | "Add node" in the left panel, or double-click the background |
| Move node | Drag it |
| Connect two nodes | Shift + drag from one to the other, or activate "Connect" mode in the left panel and drag |
| Rename node or label edge | Select it and edit the name in the left panel, or double-click it |
| Select | Click a node or an edge, or click a name in the node list of the left panel |
| Delete | Delete or Backspace key while selected, or "Delete" in the left panel |
| Zoom | Mouse wheel |
| Pan canvas | Drag the background, or use the middle mouse button |
| Directed / undirected | "Directed" checkbox |

The graph is automatically saved to `localStorage`, so it persists across page reloads. "Export JSON" downloads the file, and "Import JSON" loads it.

## Structure

- `src/graph.ts`: the model. Nodes, edges, JSON validation, and change notifications. Does not touch the DOM.
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
    { "id": "n1", "label": "A", "x": 120, "y": 160 },
    { "id": "n2", "label": "B", "x": 320, "y": 80 }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "" }
  ]
}
```

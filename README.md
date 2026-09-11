# Kesah, visual graph editor

A web application for drawing flowcharts and graphs (nodes and edges) using the mouse. Built with TypeScript and [SolidJS](https://www.solidjs.com/), the only runtime dependency: the drawing is plain SVG rendered by Solid components, and Vite is used for development and bundling.

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
| Connect two nodes | Drag from a side handle of one node to a side handle (or the body) of another. Shift + drag, or connect mode, also works and picks the sides automatically |
| Connect mode | Press C or click "Connect" in the left panel to toggle it; while it is on, dragging a node connects instead of moving. Escape leaves it |
| Choose the sides an edge uses | Select the edge and set "From side" and "To side" in the left panel ("Auto" picks them from the layout) |
| Straight or elbowed edges | "Orthogonal" checkbox in the toolbar |
| Rename node or label edge | Select it and edit the name in the left panel, or double-click it |
| Select | Click a node or an edge, or click a name in the node list of the left panel |
| Delete | Delete or Backspace key while selected, or "Delete" in the left panel |
| Deselect | Escape |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), or the "Undo" and "Redo" buttons. A drag or the typing of a name counts as one step |
| Zoom | Mouse wheel |
| Pan canvas | Drag the background, or use the middle mouse button |
| Directed / undirected | "Directed" checkbox |

Several edges may join the same two nodes; edges that share a side of a node fan out so they do not overlap. Self-loops are not supported, and edges do not route around other nodes: move a node or pick other sides if a line crosses something.

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

The model is framework-free; the interface is made of Solid components organised by [atomic design](https://atomicdesign.bradfrost.com/) levels, each with its stylesheet next to it.

- `src/model/`: no DOM anywhere in here.
  - `graph.ts`: nodes, edges, JSON validation and change notifications.
  - `shapes.ts`: geometry of the node shapes. Size for a label, SVG outline, side handle positions and where an edge meets the border.
  - `routing.ts`: automatic side choice, orthogonal routes with elbows, rounded paths, label placement and fan-out of parallel edges.
  - `layout.ts`: resolves the sides and offsets of every edge, computes the points it passes through, and finds a free spot for a new node.
  - `history.ts`: undo/redo as snapshots of the graph, with transactions that group the changes of a gesture into one step.
- `src/state/app.tsx`: the application state. A reactive view over the graph (a revision signal bumped on every change) plus selection, modes, camera and the measured node sizes, provided to components through context.
- `src/components/atoms/`: Button, Checkbox, TextInput, Select, Kbd, ShapeIcon, Muted.
- `src/components/molecules/`: Field, ToolButton, ShapePicker, NodeListItem, FileButton, and the SVG pieces of the canvas: GridPattern, ArrowMarkers, NodeShape, EdgePath.
- `src/components/organisms/`: Toolbar, ToolsPanel, InspectorPanel, NodeListPanel and GraphCanvas. `gestures.ts` holds the pointer, wheel and keyboard handling of the canvas.
- `src/components/templates/AppLayout.tsx`: toolbar on top, side panel and canvas in the middle, hint at the bottom.
- `src/App.tsx` and `src/main.tsx`: root component, persistence in `localStorage` and the sample flowchart.
- `src/styles/tokens.css`: colour variables and the page reset.

## JSON format

```json
{
  "directed": true,
  "edgeStyle": "orthogonal",
  "nodes": [
    { "id": "n1", "label": "Start", "type": "terminal", "x": 300, "y": 60 },
    { "id": "n2", "label": "Valid?", "type": "decision", "x": 300, "y": 160 }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "", "sourceSide": "bottom", "targetSide": "top" }
  ]
}
```

`type` is one of `terminal`, `process`, `decision` or `io`. A node without a type is loaded as a `process`, so files written before shapes existed still work.

`edgeStyle` is `straight` or `orthogonal`; a file without it is loaded as `straight` so it keeps its look. `sourceSide` and `targetSide` are optional and take `top`, `right`, `bottom` or `left`; when absent the side is chosen automatically from the positions of the two nodes.

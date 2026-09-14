# Kesah, BPMN diagram editor

A web application for drawing BPMN process diagrams with the mouse: events, tasks, gateways, artifacts and the flows between them. It draws the notation; it does not execute processes, and it has no pools or lanes or BPMN XML yet (see *Limitations*). Built with TypeScript and [SolidJS](https://www.solidjs.com/), the only runtime dependency: the drawing is plain SVG rendered by Solid components, and Vite is used for development and bundling. The document model is framework-free and lives apart from the UI.

The repository holds the web application in `app/` and, from the execution work onwards, a Rust backend in `server/`; documentation, working rules and the start script live at the root. Design decisions and invariants are explained in [docs/architecture.md](docs/architecture.md); working rules for contributors and AI assistants are in [AGENTS.md](AGENTS.md).

## Getting started

```bash
cd app
npm install
npm run dev      # development server at http://localhost:5173 (./start at the root does the same)
npm run build    # type-check and generate dist/
npm run preview  # serve dist/ to test the final version
```

## Tests

```bash
cd app
npm test                        # unit tests with coverage; fails below 85 % on any metric
npm run test:watch              # unit tests in watch mode
npm run test:e2e                # end-to-end smoke test in a headless Chrome (run `npm run build` first)
node scripts/verify-tests.mjs   # mutation check: breaks each unit and expects its tests to fail
```

Unit tests live next to the code (`*.test.ts` / `*.test.tsx`) and run with Vitest in jsdom. `app/src/test/setup.ts` provides what jsdom lacks (text measurement, pointer capture, hit-testing). The end-to-end script drives the production build through the Chrome DevTools protocol; set `CHROME_BIN` if Chrome is not `google-chrome`.

## Elements

| Group | Element | Variants (left panel) | Drawn as |
| --- | --- | --- | --- |
| Events | Start | none, message, timer | thin circle, label below |
| Events | Intermediate | none, message, timer | double circle, label below |
| Events | End | none, message, terminate | thick circle (terminate: filled disc), label below |
| Activities | Task | none, user, service, script | rounded rectangle that widens with its name, icon top-left |
| Activities | Sub-process | — | task with a ⊞ marker at the bottom (collapsed) |
| Gateways | Gateway | exclusive ×, parallel +, inclusive ○ | diamond with the marker, label below |
| Artifacts | Annotation | — | open bracket with left-aligned text |
| Artifacts | Data object | — | page with a folded corner, label below |

Connections have a kind, chosen in the left panel when an edge is selected:

| Kind | Drawn as |
| --- | --- |
| Sequence flow | solid line, filled arrowhead; its *condition* adds a slash (default flow) or a small diamond (conditional flow) at the source |
| Message flow | dashed line, open arrowhead, dot at the source |
| Association | dotted line, no arrowhead |

Any kind may join any two elements: the editor draws, it does not validate.

## Controls

| Action | How to |
| --- | --- |
| Create an element | Pick it under "Add node" in the left panel, or double-click the background for a task |
| Change an element's type or variant | Select it and use "Type" and the variant select ("Trigger", "Result", "Task type", "Gateway") in the left panel |
| Move an element | Drag it |
| Connect two elements | Drag from a side handle of one to a side handle (or the body) of another. Shift + drag, or connect mode, also works and picks the sides automatically |
| Connect mode | Press C or click "Connect" in the left panel to toggle it; while it is on, dragging an element connects instead of moving. Escape leaves it |
| Choose the kind and condition of a connection | Select it and set "Kind" and, for sequence flows, "Condition" in the left panel |
| Choose the sides a connection uses | Select it and set "From side" and "To side" in the left panel ("Auto" picks them from the layout) |
| Straight or elbowed connections | "Orthogonal" checkbox in the toolbar |
| Rename an element or label a connection | Select it and edit the name in the left panel, or double-click it |
| Select | Click an element or a connection, or click a name in the node list of the left panel |
| Delete | Delete or Backspace key while selected, or "Delete" in the left panel |
| Deselect | Escape |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), or the "Undo" and "Redo" buttons. A drag or the typing of a name counts as one step |
| Zoom | Mouse wheel |
| Pan canvas | Drag the background, or use the middle mouse button |

Several connections may join the same two elements; connections that share a side of an element fan out so they do not overlap.

The document is automatically saved to `localStorage`, so it persists across page reloads. "Export JSON" downloads the file, and "Import JSON" loads it.

## Limitations

- No pools or lanes, and no expanded sub-processes: the model is flat.
- No BPMN 2.0 XML import or export; the format is the JSON below.
- Connections do not route around other elements: move an element or pick other sides if a line crosses something. No self-loops.
- Nothing is validated against the BPMN rules; any connection may join any two elements.
- Labels cannot be moved; the label under an event or gateway may overlap a connection leaving through its bottom side.

## Structure

Everything below is under `app/`. The model is framework-free; the interface is made of Solid components organised by [atomic design](https://atomicdesign.bradfrost.com/) levels, each with its stylesheet next to it.

- `src/model/`: no DOM anywhere in here.
  - `graph.ts`: elements, connections, variants, JSON validation (including the mapping of old flowchart files) and change notifications.
  - `shapes.ts`: geometry of the symbols. Box for a label, outline, decorations (inner circle, terminate disc, sub-process marker, annotation bracket, folded corner), side handle positions and where a connection meets the border.
  - `glyphs.ts`: the icons drawn inside symbols (triggers, task types, gateway markers) and where each goes.
  - `routing.ts`: automatic side choice, orthogonal routes with elbows, rounded paths, label placement and fan-out of parallel connections.
  - `layout.ts`: resolves the sides and offsets of every connection, computes the points it passes through, and finds a free spot for a new element.
  - `history.ts`: undo/redo as snapshots of the document, with transactions that group the changes of a gesture into one step.
- `src/state/app.tsx`: the application state. A reactive view over the document (a revision signal bumped on every change) plus selection, modes, camera and the measured element sizes, provided to components through context.
- `src/components/atoms/`: Button, Checkbox, TextInput, Select, Kbd, ShapeIcon, Muted.
- `src/components/molecules/`: Field, ToolButton, ShapePicker, NodeListItem, FileButton, and the SVG pieces of the canvas: GridPattern, ArrowMarkers, NodeShape, EdgePath.
- `src/components/organisms/`: Toolbar, ToolsPanel, InspectorPanel, NodeListPanel and GraphCanvas. `gestures.ts` holds the pointer, wheel and keyboard handling of the canvas.
- `src/components/templates/AppLayout.tsx`: toolbar on top, side panel and canvas in the middle, hint at the bottom.
- `src/App.tsx` and `src/main.tsx`: root component, persistence in `localStorage` and the sample process.
- `src/styles/tokens.css`: colour variables and the page reset.
- `src/test/`: test environment (jsdom stand-ins) and rendering helpers. Tests themselves sit next to the code as `*.test.ts(x)`.
- `e2e/smoke.mjs`: end-to-end smoke test driving a headless Chrome. `scripts/verify-tests.mjs`: mutation check of the unit tests.
- `../docs/architecture.md`: the decisions behind all of the above.

## JSON format

```json
{
  "directed": true,
  "edgeStyle": "orthogonal",
  "nodes": [
    { "id": "n1", "label": "Start", "type": "start-event", "variant": "none", "x": 60, "y": 160 },
    { "id": "n2", "label": "In stock?", "type": "gateway", "variant": "exclusive", "x": 370, "y": 160 }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "yes", "kind": "sequence", "condition": "conditional", "sourceSide": "right", "targetSide": "left" }
  ]
}
```

- `type` is one of `start-event`, `intermediate-event`, `end-event`, `task`, `subprocess`, `gateway`, `annotation`, `data-object`. `variant` is one of the variants listed under *Elements* for that type, or `none`.
- `kind` is `sequence`, `message` or `association`; `condition` is `none`, `default` or `conditional` and only applies to sequence flows.
- `edgeStyle` is `straight` or `orthogonal`; a file without it is loaded as `straight` so it keeps its look. `sourceSide` and `targetSide` are optional and take `top`, `right`, `bottom` or `left`; when absent the side is chosen automatically from the positions of the two elements.
- `directed` is kept for files written by earlier versions and is no longer used: BPMN connections always have a direction.
- **Files from the flowchart version** still load: `terminal` becomes a start event, `process` a task, `decision` an exclusive gateway and `io` a data object; a missing or unknown type becomes a task, a missing kind a sequence flow.

# Kesah, BPMN diagram editor

A web application for drawing BPMN process diagrams with the mouse (events, tasks, gateways, artifacts and the flows between them) and a Rust server that runs them: tasks execute scripts, gateways decide from expressions, events wait for timers or messages, and the state of every running instance can be read or streamed over HTTP. There are no pools or lanes or BPMN XML yet (see *Limitations*). The editor is built with TypeScript and [SolidJS](https://www.solidjs.com/), the only runtime dependency: the drawing is plain SVG rendered by Solid components, and Vite is used for development and bundling. The document model is framework-free and lives apart from the UI.

The repository holds the web application in `app/` and the Rust backend in `server/`; documentation, working rules and the start script live at the root. Design decisions and invariants are explained in [docs/architecture.md](docs/architecture.md); working rules for contributors and AI assistants are in [AGENTS.md](AGENTS.md).

## Getting started

```bash
./build          # web application into app/dist/, API server into server/target/release/api
./start          # development: API server on :8080 and the editor on http://localhost:5173, which proxies /api
```

Both scripts install the npm dependencies on first use. Each half can also be built and run on its own:

```bash
cd app
npm install
npm run dev      # development server at http://localhost:5173
npm run build    # type-check and generate dist/
npm run preview  # serve dist/ to test the final version

cd server
cargo run -p api            # API server on http://localhost:8080 (KESAH_PORT changes the port)
cargo build --release -p api # optimised binary in target/release/api
```

`npm run preview` does not proxy `/api`: serving `app/dist/` in production needs a reverse proxy that routes `/api` to the server binary.

The server needs a stable Rust toolchain (edition 2024, Rust 1.85 or later).

## Tests

```bash
cd app
npm test                        # unit tests with coverage; fails below 85 % on any metric
npm run test:watch              # unit tests in watch mode
npm run test:e2e                # end-to-end smoke test in a headless Chrome (run `npm run build` first)
node scripts/verify-tests.mjs   # mutation check: breaks each unit and expects its tests to fail
```

Unit tests live next to the code (`*.test.ts` / `*.test.tsx`) and run with Vitest in jsdom. `app/src/test/setup.ts` provides what jsdom lacks (text measurement, pointer capture, hit-testing). The end-to-end script drives the production build through the Chrome DevTools protocol; set `CHROME_BIN` if Chrome is not `google-chrome`.

```bash
cd server
cargo test                                      # engine semantics and the HTTP API, in process
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo mutants -p engine                         # mutation check of the engine (cargo install cargo-mutants)
```

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
| Make the diagram executable | Select an element and fill in its execution property in the left panel: "Script" for tasks and sub-processes, "Delay (ms)" for timer events, "Message" for message events, "Expression" for sequence flows. See *Running processes* |
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

## Running processes

The server executes the same JSON the editor exports. Deploy a document, start instances of it, and drive them with messages and task completions; every change of state is available through the REST API and as a stream of Server-Sent Events. The editor does not yet have a run panel: use the API directly (with `curl`, for example).

Deploying only registers a document; an instance is what runs. Two ready-made processes live in `examples/` ("Import JSON" opens them in the editor):

- `nightly-report.json` runs by itself, no human involved: a timer start, scripts, a parallel fork and join with a timer on one branch, an inclusive decision and a message end. One call runs it to the end in about two seconds:

  ```bash
  curl -s -X POST localhost:8080/api/run -H 'content-type: application/json' --data @examples/nightly-report.json
  ```

- `order-fulfilment.json` uses every mechanism, including the ones that wait for people: user tasks, scripts, an exclusive decision with a default flow, a parallel fork and join, a timer, a message wait and message end events. It expects `item`, `price`, `qty` and `customer` as starting variables; "Register order" and, for totals above 500, "Manager approval" (`approved`: true or false) are the tasks to complete, and `picked-up` is the message it waits for before finishing. The commands below drive it step by step.

| Method and path | Body → Result |
| --- | --- |
| `GET /api/health` | `{ "status": "ok" }` |
| `POST /api/processes` | the document → `{ "id" }`; 400 with the reason when the document is invalid |
| `POST /api/run` | the document, or `{ "document": …, "vars": … }` → deploys it and starts one instance in the same call; the instance state is returned |
| `GET /api/processes`, `GET /api/processes/{id}` | summaries; one process with its document |
| `POST /api/processes/{id}/instances` | `{ "vars": { … } }` (optional) → the instance state, after running until it waits or ends |
| `GET /api/instances`, `GET /api/instances/{id}` | summaries; the full state of one instance |
| `POST /api/instances/{id}/messages` | `{ "name": "…" }` → state; 409 when nothing waits for that message |
| `POST /api/instances/{id}/tasks/{node}/complete` | `{ "vars": { … } }` (optional, merged into the variables) → state; 409 when that user task is not waiting |
| `POST /api/instances/{id}/stop` | → state |
| `GET /api/instances/{id}/events` | Server-Sent Events: a `state` event with the full state now and after every change |

The server writes every step to its console (the terminal running `./start` or `cargo run`): deployments, instance starts with their variables, every node entered and left with the flow taken, the lines scripts `log()`, waits with their reason, actions received or refused, timers firing, and the final status with the error when it failed. Times are UTC.

```
22:41:03.120 i-1a0a…-2 started from p-1a0a…-1 with vars {}
22:41:03.120 i-1a0a…-2   enter n1 "Midnight" (start event, timer)
22:41:03.120 i-1a0a…-2   waiting at n1 "Midnight" for timer due at 22:41:03.620
22:41:03.671 i-1a0a…-2 timer fired
22:41:03.671 i-1a0a…-2   leave n1 "Midnight" via e1
22:41:03.671 i-1a0a…-2   enter n2 "Collect sales" (task, script)
22:41:03.671 i-1a0a…-2   [n2] total sales 1165
```

Unknown ids answer 404. An instance state has `status` (`running`, `waiting`, `finished`, `failed`, `stopped`), `error` when failed, `tokens` (each with its `node` and what it waits for), `vars`, `log` (timestamped entries, some tied to a node), `trail` (the ids of the nodes and flows visited, in order), and `startedAt`, `finishedAt`, `updatedAt` in milliseconds since the epoch.

```bash
curl -s -X POST localhost:8080/api/processes -H 'content-type: application/json' --data @examples/order-fulfilment.json   # → {"id":"p-…"}
curl -s -X POST localhost:8080/api/processes/p-…/instances -H 'content-type: application/json' --data '{"vars":{"item":"lamp","price":120,"qty":6,"customer":"Ada"}}'
curl -s -N localhost:8080/api/instances/i-…/events                                                   # stream the state
curl -s -X POST localhost:8080/api/instances/i-…/tasks/n2/complete -H 'content-type: application/json' --data '{}'
curl -s -X POST localhost:8080/api/instances/i-…/tasks/n5/complete -H 'content-type: application/json' --data '{"vars":{"approved":true}}'
curl -s -X POST localhost:8080/api/instances/i-…/messages -H 'content-type: application/json' --data '{"name":"picked-up"}'
```

How each element behaves when a token reaches it:

| Element | Behaviour |
| --- | --- |
| Start event | Every start event gets a token when the instance starts. `none` passes at once; `timer` waits `delay` milliseconds; `message` waits for a message with its `message` name |
| Intermediate event | Like a start event, for a token arriving from a flow |
| End event | `none` consumes the token; `terminate` consumes every token and finishes the instance; `message` writes "sent *name*" to the log and consumes the token |
| Task, sub-process | `user` waits until the task is completed through the API (its `script`, if any, runs then); every other variant runs `script` and continues. Several outgoing flows fork: one token per flow |
| Exclusive gateway | Takes the first outgoing flow, in document order, whose `expression` is true (a flow without expression counts as true); otherwise the *default* flow; otherwise the instance fails. With several incoming flows it merges: each token passes through |
| Parallel gateway | Sends a token down every outgoing flow, expressions ignored. With several incoming flows it is a join: it waits until a token has arrived through each of them |
| Inclusive gateway | Sends a token down every outgoing flow whose `expression` is true, the *default* flow only when none is. As a join it fires when every incoming flow has delivered, or when no token is alive anywhere else |
| Annotation, data object | Cannot be executed: a token reaching one is dropped with a warning in the log |

Only sequence flows are followed; message flows and associations are drawn, not executed. An instance is *waiting* while every token waits (timer, message, user task, join), *finished* when no token remains, *failed* on a script or expression error or a gateway with no open flow (the log names the element), *stopped* on request.

Scripts and expressions are written in [Rhai](https://rhai.rs/). They see the process variables as the map `vars` and can write to the log with `log(value)`; whatever a script leaves in `vars` becomes the new variables. Expressions must yield a boolean.

```rhai
vars.total = vars.price * vars.qty;   // a task script
log("total " + vars.total);
```

```rhai
vars.total > 100                       // a flow expression
```

A script that runs too long (an endless loop, deep recursion, huge collections) fails the instance instead of stalling the server.

## Limitations

- No pools or lanes, and no expanded sub-processes: the model is flat.
- No BPMN 2.0 XML import or export; the format is the JSON below.
- Connections do not route around other elements: move an element or pick other sides if a line crosses something. No self-loops.
- Nothing is validated against the BPMN rules in the editor; the server rejects only what it cannot run (unknown types or variants, flows to missing elements, no start event).
- Labels cannot be moved; the label under an event or gateway may overlap a connection leaving through its bottom side.
- Deployed processes and running instances live in the server's memory: restarting it forgets them. Message flows are not executed, and messages only reach an instance through the API.
- Scripts run one at a time per request; a slow script delays the other calls to the server.

## Structure

The web application lives under `app/`. The model is framework-free; the interface is made of Solid components organised by [atomic design](https://atomicdesign.bradfrost.com/) levels, each with its stylesheet next to it.

- `src/model/`: no DOM anywhere in here.
  - `graph.ts`: elements, connections, variants, JSON validation (including the mapping of old flowchart files) and change notifications.
  - `shapes.ts`: geometry of the symbols. Box for a label, outline, decorations (inner circle, terminate disc, sub-process marker, annotation bracket, folded corner), side handle positions and where a connection meets the border.
  - `glyphs.ts`: the icons drawn inside symbols (triggers, task types, gateway markers) and where each goes.
  - `routing.ts`: automatic side choice, orthogonal routes with elbows, rounded paths, label placement and fan-out of parallel connections.
  - `layout.ts`: resolves the sides and offsets of every connection, computes the points it passes through, and finds a free spot for a new element.
  - `history.ts`: undo/redo as snapshots of the document, with transactions that group the changes of a gesture into one step.
- `src/state/app.tsx`: the application state. A reactive view over the document (a revision signal bumped on every change) plus selection, modes, camera and the measured element sizes, provided to components through context.
- `src/components/atoms/`: Button, Checkbox, TextInput, TextArea, Select, Kbd, ShapeIcon, Muted.
- `src/components/molecules/`: Field, ToolButton, ShapePicker, NodeListItem, FileButton, and the SVG pieces of the canvas: GridPattern, ArrowMarkers, NodeShape, EdgePath.
- `src/components/organisms/`: Toolbar, ToolsPanel, InspectorPanel, NodeListPanel and GraphCanvas. `gestures.ts` holds the pointer, wheel and keyboard handling of the canvas.
- `src/components/templates/AppLayout.tsx`: toolbar on top, side panel and canvas in the middle, hint at the bottom.
- `src/App.tsx` and `src/main.tsx`: root component, persistence in `localStorage` and the sample process.
- `src/styles/tokens.css`: colour variables and the page reset.
- `src/test/`: test environment (jsdom stand-ins) and rendering helpers. Tests themselves sit next to the code as `*.test.ts(x)`.
- `e2e/smoke.mjs`: end-to-end smoke test driving a headless Chrome. `scripts/verify-tests.mjs`: mutation check of the unit tests.
- `../docs/architecture.md`: the decisions behind all of the above.

`examples/` holds documents ready to import and run. The server is a Cargo workspace under `server/`:

- `crates/engine/`: the interpreter as a pure library. `document.rs` mirrors the JSON and validates it into a `Process`; `instance.rs` moves tokens (`Instance::start`, `run`, `tick`, `send_message`, `complete_task`, `stop`, `snapshot`); `scripting.rs` runs Rhai with limits. No I/O and no clock: time is a number handed in by the caller. `tests/semantics.rs` holds one scenario per rule of *Running processes*.
- `crates/api/`: the axum binary. `routes.rs` is the REST and SSE surface, `store.rs` the in-memory processes and instances behind a mutex plus the broadcast channel, `scheduler.rs` the task that releases due timers every 100 ms, `console.rs` the step-by-step report written to standard output. `tests/api.rs` exercises every endpoint in process, including the sample order process end to end.

## JSON format

```json
{
  "directed": true,
  "edgeStyle": "orthogonal",
  "nodes": [
    { "id": "n1", "label": "Start", "type": "start-event", "variant": "timer", "x": 60, "y": 160, "delay": 1000 },
    { "id": "n2", "label": "Price it", "type": "task", "variant": "script", "x": 220, "y": 160, "script": "vars.total = vars.price * vars.qty;" },
    { "id": "n3", "label": "Big order?", "type": "gateway", "variant": "exclusive", "x": 370, "y": 160 }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "", "kind": "sequence", "condition": "none" },
    { "id": "e2", "source": "n2", "target": "n3", "label": "yes", "kind": "sequence", "condition": "conditional", "sourceSide": "right", "targetSide": "left", "expression": "vars.total > 100" }
  ]
}
```

- `type` is one of `start-event`, `intermediate-event`, `end-event`, `task`, `subprocess`, `gateway`, `annotation`, `data-object`. `variant` is one of the variants listed under *Elements* for that type, or `none`.
- `kind` is `sequence`, `message` or `association`; `condition` is `none`, `default` or `conditional` and only applies to sequence flows.
- `edgeStyle` is `straight` or `orthogonal`; a file without it is loaded as `straight` so it keeps its look. `sourceSide` and `targetSide` are optional and take `top`, `right`, `bottom` or `left`; when absent the side is chosen automatically from the positions of the two elements.
- Execution properties are optional and absent when empty: `script` (tasks and sub-processes, a Rhai script), `delay` (timer events, milliseconds, a non-negative number), `message` (message events, the name waited for or sent) and `expression` (sequence flows, a Rhai boolean). The editor drops invalid values on import; the server ignores `x`, `y`, sides and labels.
- `directed` is kept for files written by earlier versions and is no longer used: BPMN connections always have a direction.
- **Files from the flowchart version** still load: `terminal` becomes a start event, `process` a task, `decision` an exclusive gateway and `io` a data object; a missing or unknown type becomes a task, a missing kind a sequence flow.

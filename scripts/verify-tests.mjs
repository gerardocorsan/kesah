import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * Mutation check: for every unit, break its implementation in a specific way, run the tests
 * that should notice, and restore the file. A mutation that survives means a test verifies
 * nothing and must be rewritten. Run with `node scripts/verify-tests.mjs [unit-name-filter…]`;
 * exits non-zero if any mutation survives or hangs.
 */

const DATA_OBJECT_PATH = 'return `M ${-w} ${-h} H ${w - FOLD} L ${w} ${-h + FOLD} V ${h} H ${-w} Z`;';
const PLAIN_RECT_PATH = 'return `M ${-w} ${-h} H ${w} V ${h} H ${-w} Z`;';

/** @type {{ unit: string; file: string; what: string; find: string | RegExp; replace: string; tests: string[] }[]} */
const MUTATIONS = [
  // Model
  { unit: 'graph.addEdge', file: 'src/model/graph.ts', what: 'always returns null', find: 'if (source === target || !this.nodes.has(source) || !this.nodes.has(target)) return null;', replace: 'return null;', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.resolveNodeType', file: 'src/model/graph.ts', what: 'legacy flowchart types not mapped', find: "if (typeof value === 'string' && Object.hasOwn(LEGACY_TYPES, value)) return LEGACY_TYPES[value];", replace: ';', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.setNodeVariant', file: 'src/model/graph.ts', what: 'accepts variants of other types', find: 'if (!node || node.variant === variant || !isVariantOf(node.type, variant)) return;', replace: 'if (!node || node.variant === variant) return;', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.setNodeType', file: 'src/model/graph.ts', what: 'keeps an invalid variant', find: 'if (!isVariantOf(type, node.variant)) node.variant = defaultVariant(type);', replace: ';', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.setEdgeKind', file: 'src/model/graph.ts', what: 'keeps the condition on message flows', find: "if (kind !== 'sequence') edge.condition = 'none';", replace: ';', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.removeNode', file: 'src/model/graph.ts', what: 'keeps the incident edges', find: 'if (edge.source === id || edge.target === id) this.edges.delete(edgeId);', replace: ';', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.setEdgeSide', file: 'src/model/graph.ts', what: 'never clears a side', find: 'else delete edge[key];', replace: "else edge[key] = 'top';", tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.onChange', file: 'src/model/graph.ts', what: 'moveNode never notifies', find: 'node.x = x;\n    node.y = y;\n    this.emit();', replace: 'node.x = x;\n    node.y = y;', tests: ['src/model/graph.test.ts'] },
  { unit: 'graph.parse (kind)', file: 'src/model/graph.ts', what: 'edge kind ignored on import', find: "const kind = isEdgeKind(raw.kind) ? raw.kind : 'sequence';", replace: "const kind = 'sequence';", tests: ['src/model/graph.test.ts'] },
  { unit: 'shapes.shapeSize', file: 'src/model/shapes.ts', what: 'tasks do not grow with the label', find: 'return { width: Math.max(TASK_MIN_WIDTH, text + LABEL_PADDING), height: TASK_HEIGHT };', replace: 'return { width: TASK_MIN_WIDTH, height: TASK_HEIGHT };', tests: ['src/model/shapes.test.ts'] },
  { unit: 'shapes.shapePath', file: 'src/model/shapes.ts', what: 'data object without folded corner', find: DATA_OBJECT_PATH, replace: PLAIN_RECT_PATH, tests: ['src/model/shapes.test.ts'] },
  { unit: 'shapes.decorations', file: 'src/model/shapes.ts', what: 'intermediate events without inner circle', find: "case 'intermediate-event':\n      return [{ role: 'inner', d: circlePath(h - 3) }];", replace: "case 'intermediate-event':\n      return [];", tests: ['src/model/shapes.test.ts'] },
  { unit: 'shapes.labelPlacement', file: 'src/model/shapes.ts', what: 'every label inside', find: "return growsWithLabel(type) ? 'inside' : 'below';", replace: "return 'inside';", tests: ['src/model/shapes.test.ts'] },
  { unit: 'shapes.boundaryDistance', file: 'src/model/shapes.ts', what: 'events treated as a box', find: "case 'circle':\n      return Math.min(size.width, size.height) / 2;", replace: "case 'circle':\n      return rectDistance(size, ux, uy);", tests: ['src/model/shapes.test.ts'] },
  { unit: 'shapes.pointOnSide', file: 'src/model/shapes.ts', what: 'ignores the offset', find: 'const o = clamp(offset, -limit, limit);', replace: 'const o = 0;', tests: ['src/model/shapes.test.ts'] },
  { unit: 'glyphs.glyphFor', file: 'src/model/glyphs.ts', what: 'never shows a glyph', find: 'if (!d) return null;', replace: 'return null;', tests: ['src/model/glyphs.test.ts', 'src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'glyphs.glyphFor (task corner)', file: 'src/model/glyphs.ts', what: 'task glyph centred instead of top-left', find: 'return { d, x: -size.width / 2 + TASK_INSET, y: -size.height / 2 + TASK_INSET, scale: 1 };', replace: 'return { d, x: -8, y: -8, scale: 1 };', tests: ['src/model/glyphs.test.ts'] },
  { unit: 'routing.autoSides', file: 'src/model/routing.ts', what: 'always horizontal', find: 'if (Math.abs(dx) > Math.abs(dy)) {', replace: 'if (true) {', tests: ['src/model/routing.test.ts'] },
  { unit: 'routing.orthogonalRoute', file: 'src/model/routing.ts', what: 'straight line instead of elbows', find: 'return simplify([from, p1, ...middle, p2, to]);', replace: 'return simplify([from, to]);', tests: ['src/model/routing.test.ts'] },
  { unit: 'routing.orthogonalRoute (fold-back fix)', file: 'src/model/routing.ts', what: 'zero-length segment kept', find: 'if (prev.x === p.x && prev.y === p.y) out.pop();', replace: ';', tests: ['src/model/routing.test.ts'] },
  { unit: 'routing.roundedPath', file: 'src/model/routing.ts', what: 'corners never rounded', find: 'const r = Math.min(radius, inLength / 2, outLength / 2);', replace: 'const r = 0;', tests: ['src/model/routing.test.ts'] },
  { unit: 'routing.labelAnchor', file: 'src/model/routing.ts', what: 'label sits on the line', find: 'return { x: (a.x + b.x) / 2 - uy * offset, y: (a.y + b.y) / 2 + ux * offset };', replace: 'return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };', tests: ['src/model/routing.test.ts'] },
  { unit: 'routing.spread', file: 'src/model/routing.ts', what: 'no fan-out', find: 'return (index - (count - 1) / 2) * gap;', replace: 'return 0;', tests: ['src/model/routing.test.ts'] },
  { unit: 'layout.layoutEdges', file: 'src/model/layout.ts', what: 'shared sides not spread', find: 'if (group.length < 2) continue;', replace: 'continue;', tests: ['src/model/layout.test.ts'] },
  { unit: 'layout.routeOf', file: 'src/model/layout.ts', what: 'straight edge not trimmed at the source', find: 'const gap = boundaryDistance(source.type, sizeOf(source), ux, uy) + 1;', replace: 'const gap = 0;', tests: ['src/model/layout.test.ts'] },
  { unit: 'layout.freeSpot', file: 'src/model/layout.ts', what: 'returns the start even if occupied', find: 'if (!taken) break;', replace: 'break;', tests: ['src/model/layout.test.ts'] },
  { unit: 'history.undo', file: 'src/model/history.ts', what: 'does nothing', find: 'undo(): void {\n    const snapshot = this.past.pop();', replace: 'undo(): void {\n    const snapshot = undefined;', tests: ['src/model/history.test.ts'] },
  { unit: 'history.transactions', file: 'src/model/history.ts', what: 'every change is a step even inside a transaction', find: 'if (this.openTransactions > 0) {', replace: 'if (false) {', tests: ['src/model/history.test.ts'] },
  { unit: 'history.limit', file: 'src/model/history.ts', what: 'unlimited steps', find: 'if (this.past.length > this.limit) this.past.shift();', replace: ';', tests: ['src/model/history.test.ts'] },
  // State
  { unit: 'app.selection cleanup', file: 'src/state/app.tsx', what: 'selection kept after removal', find: 'if (!exists) setSelection(null);', replace: ';', tests: ['src/state/app.test.tsx'] },
  { unit: 'app.sizes cleanup', file: 'src/state/app.tsx', what: 'sizes never forgotten', find: 'for (const id of stale) delete draft[id];', replace: ';', tests: ['src/state/app.test.tsx'] },
  { unit: 'app.zoomAt', file: 'src/state/app.tsx', what: 'zoom does not keep the cursor point', find: 'tx: mouseX - (mouseX - v.tx) * ratio,', replace: 'tx: v.tx,', tests: ['src/state/app.test.tsx'] },
  { unit: 'app.fitView', file: 'src/state/app.tsx', what: 'content not centred', find: 'tx: (width - contentWidth * scale) / 2 - minX * scale,', replace: 'tx: 0,', tests: ['src/state/app.test.tsx'] },
  { unit: 'app.revealNode', file: 'src/state/app.tsx', what: 'always pans', find: /if \(screenX >= marginX && screenX <= width - marginX && screenY >= marginY && screenY <= height - marginY\) return;/, replace: ';', tests: ['src/state/app.test.tsx'] },
  { unit: 'app.canUndo', file: 'src/state/app.tsx', what: 'always false', find: 'const canUndo = createMemo(() => (historyRevision(), history.canUndo));', replace: 'const canUndo = createMemo(() => (historyRevision(), false));', tests: ['src/state/app.test.tsx', 'src/components/organisms/Toolbar.test.tsx'] },
  // Atoms
  { unit: 'Button', file: 'src/components/atoms/Button.tsx', what: 'no aria-pressed', find: "aria-pressed={local.pressed === undefined ? undefined : local.pressed ? 'true' : 'false'}", replace: 'aria-pressed={undefined}', tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'Checkbox', file: 'src/components/atoms/Checkbox.tsx', what: 'change not reported', find: 'onChange={(e) => props.onChange(e.currentTarget.checked)}', replace: 'onChange={() => undefined}', tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'Select', file: 'src/components/atoms/Select.tsx', what: 'value not selected', find: 'selected={option.value === props.value}', replace: 'selected={false}', tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'TextInput', file: 'src/components/atoms/TextInput.tsx', what: 'typing not reported', find: 'onInput={(e) => props.onInput(e.currentTarget.value)}', replace: 'onInput={() => undefined}', tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'ShapeIcon (outline)', file: 'src/components/atoms/ShapeIcon.tsx', what: 'same outline for every element', find: 'd={shapePath(props.type, size())}', replace: "d={shapePath('task', size())}", tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'ShapeIcon (marks)', file: 'src/components/atoms/ShapeIcon.tsx', what: 'decorations missing', find: '<For each={decorations(props.type, variant(), size())}>', replace: '<For each={[]}>', tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'Muted', file: 'src/components/atoms/Muted.tsx', what: 'never hidden', find: 'hidden={props.hidden}', replace: 'hidden={false}', tests: ['src/components/atoms/atoms.test.tsx'] },
  { unit: 'Kbd', file: 'src/components/atoms/Kbd.tsx', what: 'not a kbd element', find: '<kbd class="kbd">{props.children}</kbd>', replace: '<span class="kbd">{props.children}</span>', tests: ['src/components/atoms/atoms.test.tsx'] },
  // Molecules
  { unit: 'Field', file: 'src/components/molecules/Field.tsx', what: 'never hidden', find: 'hidden={props.hidden}', replace: 'hidden={false}', tests: ['src/components/molecules/molecules.test.tsx'] },
  { unit: 'ToolButton', file: 'src/components/molecules/ToolButton.tsx', what: 'click not reported', find: 'onClick={() => props.onPick(props.type)}', replace: 'onClick={() => undefined}', tests: ['src/components/molecules/molecules.test.tsx'] },
  { unit: 'ShapePicker', file: 'src/components/molecules/ShapePicker.tsx', what: 'one element missing per group', find: '<For each={typesInGroup(group)}>', replace: '<For each={typesInGroup(group).slice(1)}>', tests: ['src/components/molecules/molecules.test.tsx'] },
  { unit: 'NodeListItem', file: 'src/components/molecules/NodeListItem.tsx', what: 'never active', find: 'classList={{ active: props.active }}', replace: 'classList={{ active: false }}', tests: ['src/components/molecules/molecules.test.tsx'] },
  { unit: 'FileButton', file: 'src/components/molecules/FileButton.tsx', what: 'file not delivered and value not reset', find: "e.currentTarget.value = ''; // allows picking the same file again\n          if (file) props.onFile(file);", replace: ';', tests: ['src/components/molecules/molecules.test.tsx'] },
  { unit: 'FileButton (reset only)', file: 'src/components/molecules/FileButton.tsx', what: 'value not reset', find: "e.currentTarget.value = ''; // allows picking the same file again", replace: ';', tests: ['src/components/molecules/molecules.test.tsx'] },
  { unit: 'GridPattern', file: 'src/components/molecules/svg/GridPattern.tsx', what: 'does not follow the camera', find: 'patternTransform={props.transform}', replace: 'patternTransform="none"', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'ArrowMarkers', file: 'src/components/molecules/svg/ArrowMarkers.tsx', what: 'selected twin not marked', find: 'classList={{ selected: props.selected }}', replace: 'classList={{ selected: false }}', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'NodeShape (measure)', file: 'src/components/molecules/svg/NodeShape.tsx', what: 'label not measured', find: 'const width = growsWithLabel(currentType) ? textEl.getComputedTextLength() : 0;', replace: 'const width = 0;', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'NodeShape (ports)', file: 'src/components/molecules/svg/NodeShape.tsx', what: 'no side handles', find: '<For each={SIDES}>', replace: '<For each={[]}>', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'NodeShape (label below)', file: 'src/components/molecules/svg/NodeShape.tsx', what: 'labels never drawn below', find: 'const labelY = () => (below() ? size().height / 2 + LABEL_BELOW_GAP : 0);', replace: 'const labelY = () => 0;', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'NodeShape (glyph)', file: 'src/components/molecules/svg/NodeShape.tsx', what: 'glyph never drawn', find: '<Show when={glyphFor(type(), variant(), size())}>', replace: '<Show when={null}>', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'EdgePath (arrowhead)', file: 'src/components/molecules/svg/EdgePath.tsx', what: 'no arrowhead', find: 'marker-end={markerEnd()}', replace: 'marker-end={undefined}', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'EdgePath (source marks)', file: 'src/components/molecules/svg/EdgePath.tsx', what: 'no default/conditional/message marks', find: 'marker-start={markerStart()}', replace: 'marker-start={undefined}', tests: ['src/components/molecules/svg/svg.test.tsx'] },
  { unit: 'EdgePath (kind class)', file: 'src/components/molecules/svg/EdgePath.tsx', what: 'message flows not dashed', find: "'edge-message': kind() === 'message',", replace: "'edge-message': false,", tests: ['src/components/molecules/svg/svg.test.tsx'] },
  // Organisms
  { unit: 'GraphCanvas (modes)', file: 'src/components/organisms/GraphCanvas.tsx', what: 'mode classes missing', find: "classList={{ 'connect-mode': app.connectMode(), connecting: app.connecting() }}", replace: 'classList={{}}', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'GraphCanvas (front node)', file: 'src/components/organisms/GraphCanvas.tsx', what: 'dragged node not brought to front', find: 'return [...list.slice(0, index), ...list.slice(index + 1), list[index]];', replace: 'return list;', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (drag undo step)', file: 'src/components/organisms/gestures.ts', what: 'drag not grouped', find: 'app.history.begin();', replace: ';', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (ports)', file: 'src/components/organisms/gestures.ts', what: 'handles ignored', find: 'if (isSide(portSide)) {', replace: 'if (false) {', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (drop)', file: 'src/components/organisms/gestures.ts', what: 'target side ignored', find: 'targetSide: isSide(targetSide) ? targetSide : undefined,', replace: 'targetSide: undefined,', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (undo shortcut)', file: 'src/components/organisms/gestures.ts', what: 'Ctrl+Z ignored', find: "if (modifier && (e.key === 'z' || e.key === 'Z')) {", replace: 'if (false) {', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (escape)', file: 'src/components/organisms/gestures.ts', what: 'Escape keeps connect mode', find: 'endGesture();\n        app.setConnectMode(false);', replace: 'endGesture();', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (typing guard)', file: 'src/components/organisms/gestures.ts', what: 'shortcuts fire while typing', find: 'if (isTypingTarget(e.target)) return;', replace: ';', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'gestures (pan)', file: 'src/components/organisms/gestures.ts', what: 'pan ignores the drag', find: 'tx: gesture.originX + (e.clientX - gesture.startX),', replace: 'tx: gesture.originX,', tests: ['src/components/organisms/GraphCanvas.test.tsx'] },
  { unit: 'Toolbar (export)', file: 'src/components/organisms/Toolbar.tsx', what: 'wrong file name', find: "link.download = 'graph.json';", replace: "link.download = 'graph.txt';", tests: ['src/components/organisms/Toolbar.test.tsx'] },
  { unit: 'Toolbar (new)', file: 'src/components/organisms/Toolbar.tsx', what: 'New does not clear', find: 'app.graph.clear();', replace: ';', tests: ['src/components/organisms/Toolbar.test.tsx'] },
  { unit: 'Toolbar (import)', file: 'src/components/organisms/Toolbar.tsx', what: 'import does not clear the selection', find: 'app.select(null);\n      app.fitView();', replace: 'app.fitView();', tests: ['src/components/organisms/Toolbar.test.tsx'] },
  { unit: 'ToolsPanel', file: 'src/components/organisms/ToolsPanel.tsx', what: 'no edit request after adding', find: 'app.requestEdit();', replace: ';', tests: ['src/components/organisms/ToolsPanel.test.tsx'] },
  { unit: 'InspectorPanel (empty name)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'empty names applied', find: "if (trimmed !== '') app.graph.setNodeLabel(s.id, trimmed);", replace: 'app.graph.setNodeLabel(s.id, trimmed);', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'InspectorPanel (typing step)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'typing not grouped', find: 'app.history.begin();', replace: ';', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'InspectorPanel (focus)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'edit request does not focus', find: 'input.focus();\n        input.select();', replace: ';', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'InspectorPanel (sides)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'side change ignored', find: 'if (e) app.graph.setEdgeSide(e.id, end, isSide(value) ? value : undefined);', replace: ';', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'InspectorPanel (variant)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'variant change ignored', find: 'if (n) app.graph.setNodeVariant(n.id, value);', replace: ';', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'InspectorPanel (kind)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'kind change ignored', find: 'if (e && isEdgeKind(value)) app.graph.setEdgeKind(e.id, value);', replace: ';', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'InspectorPanel (condition field)', file: 'src/components/organisms/InspectorPanel.tsx', what: 'condition shown for every kind', find: "hidden={edge()?.kind !== 'sequence'}", replace: 'hidden={!edge()}', tests: ['src/components/organisms/InspectorPanel.test.tsx'] },
  { unit: 'NodeListPanel', file: 'src/components/organisms/NodeListPanel.tsx', what: 'row click does not reveal', find: 'app.revealNode(id);', replace: ';', tests: ['src/components/organisms/NodeListPanel.test.tsx'] },
  { unit: 'AppLayout', file: 'src/components/templates/AppLayout.tsx', what: 'tools panel missing', find: '<ToolsPanel />', replace: '', tests: ['src/App.test.tsx'] },
  { unit: 'main (restore)', file: 'src/main.tsx', what: 'saved document ignored', find: 'if (!loadSaved(graph)) seedExample(graph);', replace: 'seedExample(graph);', tests: ['src/main.test.tsx'] },
  { unit: 'main (autosave)', file: 'src/main.tsx', what: 'changes never saved', find: 'localStorage.setItem(STORAGE_KEY, JSON.stringify(graph.toJSON()));', replace: ';', tests: ['src/main.test.tsx'] },
];

/** Returns 'passed', 'failed' or 'hung' (a broken unit must never be able to stall the run). */
function runTests(files) {
  const result = spawnSync('npx', ['vitest', 'run', ...files, '--reporter=dot'], { encoding: 'utf8', timeout: 180_000 });
  if (result.error || result.signal) return 'hung';
  return result.status === 0 ? 'passed' : 'failed';
}

// Optional arguments narrow the run to the units whose name contains any of them.
const filter = process.argv.slice(2);
const selected = MUTATIONS.filter((m) => filter.length === 0 || filter.some((f) => m.unit.includes(f)));

const survived = [];
const rows = [];
for (const m of selected) {
  const original = readFileSync(m.file, 'utf8');
  const matches = typeof m.find === 'string' ? original.includes(m.find) : m.find.test(original);
  if (!matches) {
    console.error(`Mutation target not found: ${m.unit} (${m.file})`);
    process.exit(2);
  }
  const mutated = original.replace(m.find, m.replace);
  writeFileSync(m.file, mutated);
  let outcome = 'hung';
  try {
    outcome = runTests(m.tests);
  } finally {
    writeFileSync(m.file, original);
  }
  const caught = outcome === 'failed';
  const label = caught ? 'caught  ' : outcome === 'hung' ? 'HUNG    ' : 'SURVIVED';
  rows.push({ unit: m.unit, what: m.what, result: label.trim() });
  if (!caught) survived.push(`${m.unit} (${outcome})`);
  console.log(`${label}  ${m.unit}: ${m.what}`);
}

console.log(`\n${rows.length - survived.length}/${rows.length} mutations caught`);
if (survived.length > 0) {
  console.log('Survived: ' + survived.join(', '));
  process.exit(1);
}

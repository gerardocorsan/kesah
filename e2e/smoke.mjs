import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end smoke test. Run `npm run build` first: this serves dist/ with `vite preview`,
 * drives a headless Chrome through the DevTools protocol and checks every interaction.
 * Needs Chrome: set CHROME_BIN if it is not `google-chrome`. Exits non-zero on any failure.
 */
const CHROME = process.env.CHROME_BIN ?? 'google-chrome';
const SCREENSHOT = 'e2e/last-run.png';
const profile = await mkdtemp(join(tmpdir(), 'kesah-e2e-'));
const preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=9222', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--window-size=1200,800', 'about:blank'],
  { stdio: 'ignore' },
);
async function shutdown() {
  preview.kill();
  chrome.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(profile, { recursive: true, force: true });
}
process.on('uncaughtException', async (error) => {
  console.error(error);
  await shutdown();
  process.exit(1);
});

const CDP = 'http://localhost:9222';
const APP = 'http://localhost:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, label) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`No response from ${label}: ${url}`);
}
await waitFor(`${CDP}/json/version`, 'Chrome');
await waitFor(APP, 'vite preview');

const targets = await (await fetch(`${CDP}/json`)).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
const events = [];
const exceptions = [];
const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  events.push(msg);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
async function navigate() {
  const before = events.length;
  await send('Page.navigate', { url: APP });
  for (let i = 0; i < 100 && !events.slice(before).some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(50);
  await sleep(300);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await navigate();

const mouse = (type, x, y, opts = {}) =>
  send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...opts });
async function drag(from, to, modifiers = 0) {
  await mouse('mousePressed', from.x, from.y, { modifiers });
  for (let i = 1; i <= 5; i++) {
    await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 5, from.y + ((to.y - from.y) * i) / 5, { modifiers });
  }
  await mouse('mouseReleased', to.x, to.y, { modifiers });
  await sleep(120);
}
async function click(p) { await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); await sleep(120); }
async function dblclick(p) {
  await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y);
  await mouse('mousePressed', p.x, p.y, { clickCount: 2 }); await mouse('mouseReleased', p.x, p.y, { clickCount: 2 });
  await sleep(120);
}
async function key(k, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(120);
}
const CTRL = 2;
const SHIFT = 8;
async function typeText(text) { await send('Input.insertText', { text }); await sleep(120); }
const rectCenter = (selector) => evaluate(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const state = () => evaluate(`(() => {
  const nodes = [...document.querySelectorAll('.node')].map((n) => {
    const r = n.querySelector('path').getBoundingClientRect();
    const ports = [...n.querySelectorAll('.port')];
    return { id: n.dataset.id, type: n.dataset.type, d: n.querySelector('path').getAttribute('d'), label: n.querySelector('text').textContent, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, selected: n.classList.contains('selected'), ports: ports.length, portsVisible: ports.length > 0 && getComputedStyle(ports[0]).opacity === '1' };
  });
  const edges = [...document.querySelectorAll('.edge')].map((e) => ({ id: e.dataset.id, d: e.querySelector('.edge-line').getAttribute('d'), selected: e.classList.contains('selected'), marker: e.querySelector('.edge-line').getAttribute('marker-end'), label: e.querySelector('.edge-label').textContent }));
  const list = [...document.querySelectorAll('#node-list button')].map((b) => ({ id: b.dataset.id, text: b.querySelector('.node-name').textContent, active: b.classList.contains('active'), icon: !!b.querySelector('.shape-icon path') }));
  const hidden = (id) => getComputedStyle(document.getElementById(id)).display === 'none';
  return {
    nodes, edges, list,
    status: document.getElementById('status').textContent,
    transform: document.querySelector('.viewport').getAttribute('transform'),
    formHidden: hidden('inspector-form'),
    emptyHidden: hidden('inspector-empty'),
    typeFieldHidden: hidden('type-field'),
    sideFieldsHidden: hidden('source-side-field') && hidden('target-side-field'),
    typeValue: document.getElementById('sel-type').value,
    sourceSide: document.getElementById('sel-source-side').value,
    targetSide: document.getElementById('sel-target-side').value,
    addButtons: [...document.querySelectorAll('#add-node-tools button')].map((b) => b.dataset.type),
    orthogonal: document.getElementById('chk-orthogonal').checked,
    connecting: document.querySelector('.canvas').classList.contains('connecting'),
    connectOn: document.querySelector('.canvas').classList.contains('connect-mode'),
    connectPressed: document.getElementById('btn-connect').getAttribute('aria-pressed') === 'true',
    undoDisabled: document.getElementById('btn-undo').disabled,
    redoDisabled: document.getElementById('btn-redo').disabled,
    title: document.getElementById('inspector-title').textContent,
    info: document.getElementById('inspector-info').textContent,
    inputValue: document.getElementById('inp-label').value,
    inputFocused: document.activeElement === document.getElementById('inp-label'),
    nodeCount: document.getElementById('node-count').textContent,
  };
})()`);

const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? `  [${info}]` : ''}`); };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const byLabel = (s, label) => s.nodes.find((n) => n.label === label);
const edgeById = (s, id) => s.edges.find((e) => e.id === id);
const pathStart = (d) => { const m = /^M (-?[\d.]+) (-?[\d.]+)/.exec(d); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; };
const isSingleSegment = (d) => !d.includes('Q') && d.split('L').length === 2;
const isAxisAligned = (d) => {
  const nums = d.replace(/[MLQ]/g, ' ').trim().split(/\s+/).map(Number);
  // Only check the straight L segments: consecutive point pairs must share x or y unless a Q curve intervenes.
  const cmds = d.match(/[ML] -?[\d.]+ -?[\d.]+/g) ?? [];
  const pts = cmds.map((c) => c.slice(2).split(' ').map(Number));
  return nums.length > 0 && pts.every((p, i) => i === 0 || d.includes('Q') || p[0] === pts[i - 1][0] || p[1] === pts[i - 1][1]);
};

let s = await state();
check('initial render: 6 nodes, 6 edges', s.nodes.length === 6 && s.edges.length === 6, s.status);
check('orthogonal is on for a new graph', s.orthogonal);
check('every node has four side handles, hidden by default', s.nodes.every((n) => n.ports === 4 && !n.portsVisible));
check('seed types', byLabel(s, 'Start')?.type === 'terminal' && byLabel(s, 'Read input')?.type === 'io' && byLabel(s, 'Valid?')?.type === 'decision');
check('Yes branch is an elbowed route, Start->Read is a straight vertical', edgeById(s, 'e3').d.includes('Q') && isSingleSegment(edgeById(s, 'e1').d), edgeById(s, 'e1').d);
check('edge labels rendered', s.edges.filter((e) => e.label === 'Yes' || e.label === 'No').length === 2);
check('four add buttons', s.addButtons.length === 4, s.addButtons.join());
check('inspector hidden with no selection', s.formHidden && s.title === 'Selection');
check('undo and redo start disabled', s.undoDisabled && s.redoDisabled);

const start = byLabel(s, 'Start');
await drag(start, { x: start.x + 60, y: start.y + 40 });
s = await state();
check('a drag enables undo', !s.undoDisabled && s.redoDisabled && near(byLabel(s, 'Start').x, start.x + 60));
await key('z', 'KeyZ', 90, CTRL);
s = await state();
check('Ctrl+Z undoes the whole drag in one step', near(byLabel(s, 'Start').x, start.x) && near(byLabel(s, 'Start').y, start.y) && s.undoDisabled && !s.redoDisabled);
await key('z', 'KeyZ', 90, CTRL | SHIFT);
s = await state();
check('Ctrl+Shift+Z redoes it', near(byLabel(s, 'Start').x, start.x + 60) && !s.undoDisabled && s.redoDisabled);
await evaluate(`document.getElementById('btn-undo').click()`);
await sleep(120);
s = await state();
check('the Undo button undoes too', near(byLabel(s, 'Start').x, start.x));
await key('y', 'KeyY', 89, CTRL);
s = await state();
check('Ctrl+Y redoes', near(byLabel(s, 'Start').x, start.x + 60));
await evaluate(`document.getElementById('btn-undo').click()`);
await sleep(120);
s = await state();
check('back to the initial layout before the rest of the run', near(byLabel(s, 'Start').x, start.x) && s.undoDisabled);

await click(start);
await sleep(250); // let the handle fade-in finish
s = await state();
check('selecting a node shows its side handles', byLabel(s, 'Start').portsVisible && byLabel(s, 'End').portsVisible === false);
check('node inspector hides the side fields', !s.typeFieldHidden && s.sideFieldsHidden);

// Drag from Start's bottom handle to End's top handle: a second edge on Start.bottom with fixed sides.
const fromPort = await rectCenter('.node[data-id="n1"] .port[data-side="bottom"]');
const toPort = await rectCenter('.node[data-id="n6"] .port[data-side="top"]');
await mouse('mousePressed', fromPort.x, fromPort.y);
await mouse('mouseMoved', fromPort.x + 20, fromPort.y + 40);
await sleep(250); // let the handle fade-in finish
s = await state();
check('while connecting, every node shows its handles', s.connecting && s.nodes.every((n) => n.portsVisible));
await mouse('mouseMoved', toPort.x, toPort.y);
await mouse('mouseReleased', toPort.x, toPort.y);
await sleep(150);
s = await state();
const e7 = edgeById(s, 'e7');
check('dragging handle to handle creates an edge with fixed sides', s.edges.length === 7 && e7?.selected === true && s.sourceSide === 'bottom' && s.targetSide === 'top', s.status);
check('edge inspector shows the side fields and hides the shape field', !s.sideFieldsHidden && s.typeFieldHidden && s.title === 'Edge');
check('handles hidden again after the drag', !s.connecting);
const e1Start = pathStart(edgeById(s, 'e1').d);
const e7Start = pathStart(e7.d);
check('edges sharing Start.bottom fan out', e1Start && e7Start && !near(e1Start.x, e7Start.x, 4) && near(e1Start.y, e7Start.y), `${e1Start?.x} vs ${e7Start?.x}`);
check('routes are axis-aligned', s.edges.every((e) => isAxisAligned(e.d)));

await evaluate(`(() => { const sel = document.getElementById('sel-source-side'); sel.value = 'left'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(150);
s = await state();
const e7b = edgeById(s, 'e7');
const startNode = byLabel(s, 'Start');
check('"From side" = Left re-routes the edge from the left of Start', pathStart(e7b.d).x < startNode.x - startNode.w / 2 + 2 && e7b.d !== e7.d, `${pathStart(e7b.d).x} < ${startNode.x - startNode.w / 2}`);

await drag(byLabel(s, 'Start'), byLabel(s, 'End'), 8);
s = await state();
check('Shift+drag between already-connected nodes adds another edge', s.edges.length === 8, s.status);

await key('c', 'KeyC', 67);
s = await state();
check('C switches connect mode on and the button follows', s.connectOn && s.connectPressed);
await drag(byLabel(s, 'Start'), byLabel(s, 'End'));
s = await state();
check('in connect mode a plain drag connects instead of moving', s.edges.length === 9 && s.edges.some((e) => e.selected), s.status);
await key('Delete', 'Delete', 46);
await key('Escape', 'Escape', 27);
s = await state();
check('Escape leaves connect mode and the button follows', !s.connectOn && !s.connectPressed && s.edges.length === 8);
await evaluate(`document.getElementById('btn-connect').click()`);
await sleep(100);
s = await state();
check('the button still toggles the mode', s.connectOn && s.connectPressed);
await key('c', 'KeyC', 67);
s = await state();
check('C switches it off again', !s.connectOn && !s.connectPressed);

await drag(byLabel(s, 'Start'), { x: byLabel(s, 'Start').x + 100, y: byLabel(s, 'Start').y + 60 });
s = await state();
check('dragging the body still moves the node', near(byLabel(s, 'Start').x, startNode.x + 100) && near(byLabel(s, 'Start').y, startNode.y + 60));

const empty = { x: 1050, y: 640 };
await dblclick(empty);
s = await state();
check('double-click on background creates a process node', s.nodes.length === 7 && s.nodes.find((n) => n.selected)?.type === 'process', s.status);
const created = s.nodes.find((n) => n.selected);
check('new node appears under the cursor', created && near(created.x, empty.x) && near(created.y, empty.y), created ? `${created.x},${created.y}` : 'none selected');

await dblclick(created);
s = await state();
check('double-click on a node focuses the name field', s.inputFocused && s.inputValue === created.label);
await typeText('Hola');
await key('Enter', 'Enter', 13);
s = await state();
check('typing in the name field renames the node', byLabel(s, 'Hola') !== undefined && s.list.some((l) => l.text === 'Hola'));
await key('z', 'KeyZ', 90, CTRL);
s = await state();
check('undo reverts the rename in one step', byLabel(s, 'Hola') === undefined && s.nodes.length === 7);
await key('z', 'KeyZ', 90, CTRL | SHIFT);
s = await state();
check('redo restores the name', byLabel(s, 'Hola') !== undefined);

const edgeMid = await rectCenter('.edge[data-id="e2"] .edge-line');
await click(edgeMid);
s = await state();
check('clicking an edge selects it', edgeById(s, 'e2')?.selected === true);
await key('Delete', 'Delete', 46);
s = await state();
check('Delete key removes the selected edge', s.edges.length === 7 && !edgeById(s, 'e2'), s.status);

await click(byLabel(s, 'Show error'));
await key('Delete', 'Delete', 46);
s = await state();
check('Delete key removes the node and its edges', s.nodes.length === 6 && !byLabel(s, 'Show error') && s.edges.length === 5, s.status);
check('selection is cleared after deleting', s.formHidden && !s.emptyHidden && s.inputValue === '');

await evaluate(`document.querySelector('#add-node-tools button[data-type="decision"]').click()`);
await sleep(150);
s = await state();
const added = s.nodes.find((n) => n.selected);
check('"Decision" button creates and selects a decision node', s.nodes.length === 7 && added?.type === 'decision' && s.typeValue === 'decision', s.status);
check('add button focuses the name field', s.inputFocused);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, text: 'c' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
await sleep(120);
s = await state();
check('typing C in the name field does not toggle connect mode', !s.connectOn && s.inputValue === 'c');
await evaluate(`document.getElementById('inp-label').select()`);
await typeText('Fresh?');
await key('Enter', 'Enter', 13);
s = await state();
const fresh = byLabel(s, 'Fresh?');
check('new node renamed from the panel', fresh !== undefined && s.list.find((l) => l.text === 'Fresh?')?.active === true);
await evaluate(`(() => { const sel = document.getElementById('sel-type'); sel.value = 'terminal'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(150);
s = await state();
check('changing the shape select swaps the outline and keeps the label', byLabel(s, 'Fresh?')?.type === 'terminal' && byLabel(s, 'Fresh?').d !== fresh.d);

await evaluate(`[...document.querySelectorAll('#node-list button')].find((b) => b.querySelector('.node-name').textContent === 'Valid?').click()`);
await sleep(150);
s = await state();
check('clicking a name in the list selects the node', byLabel(s, 'Valid?')?.selected === true && s.inputValue === 'Valid?', s.info);
await evaluate(`document.getElementById('btn-delete').click()`);
await sleep(150);
s = await state();
check('"Delete" button removes the node and its edges', s.nodes.length === 6 && !byLabel(s, 'Valid?') && s.edges.length === 4, s.status);

await evaluate(`document.getElementById('chk-orthogonal').click()`);
await sleep(150);
s = await state();
check('unticking Orthogonal draws single straight segments', !s.orthogonal && s.edges.every((e) => isSingleSegment(e.d)));
const straightStarts = s.edges.filter((e) => e.id === 'e7' || e.id === 'e8').map((e) => pathStart(e.d));
check('parallel straight edges do not share a start point', straightStarts.length === 2 && (!near(straightStarts[0].x, straightStarts[1].x, 1) || !near(straightStarts[0].y, straightStarts[1].y, 1)));
await evaluate(`document.getElementById('chk-orthogonal').click()`);
await sleep(150);
s = await state();
check('ticking Orthogonal again restores elbowed routes', s.orthogonal && s.edges.every((e) => isAxisAligned(e.d)));

await evaluate(`document.getElementById('chk-directed').click()`);
await sleep(120);
s = await state();
check('undirected: no arrowheads', s.edges.every((e) => e.marker === null));

const t0 = s.transform;
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -120 });
await sleep(120);
s = await state();
check('wheel zooms', s.transform !== t0 && !s.transform.endsWith('scale(1)'), s.transform);

const t1 = s.transform;
await drag({ x: 300, y: 700 }, { x: 400, y: 650 });
s = await state();
check('dragging the background pans', s.transform !== t1 && s.nodes.length === 6, s.transform);

await sleep(400);
const saved = await evaluate(`JSON.parse(localStorage.getItem('kesah:graph'))`);
const savedE7 = saved?.edges.find((e) => e.id === 'e7');
check('saved to localStorage with edge style and sides', saved?.edgeStyle === 'orthogonal' && saved.directed === false && savedE7?.sourceSide === 'left' && savedE7?.targetSide === 'top' && saved.edges.find((e) => e.id === 'e8')?.sourceSide === undefined);
console.log('    saved edges:', JSON.stringify(saved.edges.map((e) => `${e.id}:${e.sourceSide ?? '-'}>${e.targetSide ?? '-'}`)));

await evaluate(`document.getElementById('btn-fit').click()`);
await sleep(150);
const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(SCREENSHOT, Buffer.from(shot.data, 'base64'));

// Backwards compatibility: a graph saved before edge styles, sides and node types existed.
await evaluate(`localStorage.setItem('kesah:graph', JSON.stringify({ directed: true, nodes: [{ id: 'n1', label: 'Old', x: 100, y: 100 }, { id: 'n2', label: 'Older', x: 300, y: 100 }], edges: [{ id: 'e1', source: 'n1', target: 'n2', label: '' }] }))`);
await navigate();
s = await state();
check('legacy JSON loads as straight process nodes', !s.orthogonal && s.nodes.length === 2 && s.nodes.every((n) => n.type === 'process') && s.edges.length === 1 && isSingleSegment(s.edges[0].d), s.status);

check('no page exceptions', exceptions.length === 0, exceptions.map((e) => e.exception?.description ?? e.text).join(' | '));
check('no console errors or warnings', consoleErrors.length === 0, consoleErrors.join(' | '));
console.log(results.every(Boolean) ? 'RESULT: all OK' : 'RESULT: failures');
ws.close();
await shutdown();
process.exit(results.every(Boolean) ? 0 : 1);

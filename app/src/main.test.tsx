import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The entry point wires persistence: the sample process appears on a first visit, a saved
 * document is restored (old flowchart files included), and changes are saved shortly after
 * they happen.
 */

const STORAGE_KEY = 'kesah:graph';

const names = () => [...document.querySelectorAll('#node-list .node-name')].map((n) => n.textContent);
const status = () => document.querySelector('#status')?.textContent;
const count = (selector: string) => document.querySelectorAll(selector).length;

describe('main', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the sample order process on a first visit', async () => {
    await import('./main');
    expect(status()).toBe('8 nodes · 7 edges');
    expect(names()).toEqual(['Start', 'Receive order', 'In stock?', 'Ship order', 'End', 'Notify customer', 'Order rejected', 'Checked daily']);
    expect(count('.node[data-type="start-event"]')).toBe(1);
    expect(count('.node[data-type="end-event"]')).toBe(2);
    expect(count('.node[data-type="task"]')).toBe(3);
    expect(count('.node[data-type="gateway"][data-variant="exclusive"]')).toBe(1);
    expect(count('.node[data-type="annotation"]')).toBe(1);
    expect(count('.node[data-variant="user"]')).toBe(1);
    expect(count('.node[data-variant="service"]')).toBe(1);
    expect(count('.node[data-type="end-event"][data-variant="message"]')).toBe(1);
    const labels = [...document.querySelectorAll('.edge-label')].map((l) => l.textContent);
    expect(labels).toContain('yes');
    expect(labels).toContain('no');
    expect(count('.edge[data-kind="association"]')).toBe(1);
    expect(count('.edge-line[marker-start="url(#flow-default)"]')).toBe(1);
    expect(count('.edge-line[marker-start="url(#flow-conditional)"]')).toBe(1);
    expect((document.querySelector('#chk-orthogonal') as HTMLInputElement).checked).toBe(true);
    expect(document.title).toBe('');

  });

  it('restores the document saved in the browser, mapping old flowchart files onto BPMN elements', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        nodes: [
          { id: 'n1', label: 'Saved', x: 0, y: 0 },
          { id: 'n2', label: 'Choice', type: 'decision', x: 200, y: 0 },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', label: '' }],
      }),
    );
    await import('./main');
    expect(status()).toBe('2 nodes · 1 edge');
    expect(names()).toEqual(['Saved', 'Choice']);
    expect(count('.node[data-type="task"]')).toBe(1);
    expect(count('.node[data-type="gateway"]')).toBe(1);
    expect(count('.edge[data-kind="sequence"]')).toBe(1);
    expect((document.querySelector('#chk-orthogonal') as HTMLInputElement).checked).toBe(false);
  });

  it('falls back to the sample when the saved document is unreadable or empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem(STORAGE_KEY, '{broken');
    await import('./main');
    expect(status()).toBe('8 nodes · 7 edges');
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: [], edges: [] }));
    await import('./main');
    expect(status()).toBe('8 nodes · 7 edges');
  });

  it('saves changes to the browser shortly after they happen', async () => {
    vi.useFakeTimers();
    await import('./main');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    (document.querySelector('#add-node-tools button[data-type="start-event"]') as HTMLButtonElement).click();
    vi.advanceTimersByTime(2000);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(saved.nodes).toHaveLength(9);
    expect(saved.edges).toHaveLength(7);
    expect(saved.edgeStyle).toBe('orthogonal');
    expect(saved.nodes[8]).toMatchObject({ type: 'start-event', variant: 'none' });
    // The sample is executable as it is: the gateway decides on a variable and the branches leave a trace.
    const nodes = saved.nodes as { label: string; script?: string; message?: string }[];
    const edges = saved.edges as { label: string; expression?: string }[];
    expect(edges.find((e) => e.label === 'yes')?.expression).toBe('vars.stock');
    expect(nodes.find((n) => n.label === 'Ship order')?.script).toMatch(/vars\.item/);
    expect(nodes.find((n) => n.label === 'Notify customer')?.script).toMatch(/vars\.notified/);
    expect(nodes.find((n) => n.label === 'Order rejected')?.message).toBe('rejected');
    expect(saved.edges.every((e: { kind: string }) => typeof e.kind === 'string')).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The entry point wires persistence: the sample flowchart appears on a first visit, a saved
 * graph is restored, and changes are saved shortly after they happen.
 */

const STORAGE_KEY = 'kesah:graph';

const names = () => [...document.querySelectorAll('#node-list .node-name')].map((n) => n.textContent);
const status = () => document.querySelector('#status')?.textContent;

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

  it('shows the sample flowchart on a first visit', async () => {
    await import('./main');
    expect(status()).toBe('6 nodes · 6 edges');
    expect(names()).toEqual(['Start', 'Read input', 'Valid?', 'Process data', 'Show error', 'End']);
    expect(document.querySelectorAll('.node[data-type="terminal"]')).toHaveLength(2);
    expect(document.querySelectorAll('.node[data-type="decision"]')).toHaveLength(1);
    expect(document.querySelectorAll('.node[data-type="io"]')).toHaveLength(1);
    const labels = [...document.querySelectorAll('.edge-label')].map((l) => l.textContent);
    expect(labels).toContain('Yes');
    expect(labels).toContain('No');
    expect((document.querySelector('#chk-orthogonal') as HTMLInputElement).checked).toBe(true);
  });

  it('restores the graph saved in the browser, including old files without newer fields', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: [{ id: 'n1', label: 'Saved', x: 0, y: 0 }], edges: [] }));
    await import('./main');
    expect(status()).toBe('1 node · 0 edges');
    expect(names()).toEqual(['Saved']);
    expect((document.querySelector('#chk-orthogonal') as HTMLInputElement).checked).toBe(false);
  });

  it('falls back to the sample when the saved graph is unreadable or empty', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem(STORAGE_KEY, '{broken');
    await import('./main');
    expect(status()).toBe('6 nodes · 6 edges');
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: [], edges: [] }));
    await import('./main');
    expect(status()).toBe('6 nodes · 6 edges');
  });

  it('saves changes to the browser shortly after they happen', async () => {
    vi.useFakeTimers();
    await import('./main');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    (document.querySelector('#add-node-tools button[data-type="terminal"]') as HTMLButtonElement).click();
    vi.advanceTimersByTime(2000);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(saved.nodes).toHaveLength(7);
    expect(saved.edges).toHaveLength(6);
    expect(saved.edgeStyle).toBe('orthogonal');
    expect(saved.nodes[6].type).toBe('terminal');
  });
});

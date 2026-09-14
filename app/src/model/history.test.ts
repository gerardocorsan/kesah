import { describe, expect, it } from 'vitest';
import { Graph } from './graph';
import { History } from './history';

/**
 * Expectations come from the agreed behaviour: every change is one step, a transaction groups
 * its changes into one step, undo/redo restore the document, a new change discards the redo
 * stack, and at most 100 steps are kept.
 */

function labels(graph: Graph): string[] {
  return graph.nodeList.map((n) => n.label);
}

describe('History', () => {
  it('has nothing to undo or redo right after creation', () => {
    const graph = new Graph();
    graph.addNode(0, 0, 'A');
    const history = new History(graph);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('undoes and redoes one change at a time', () => {
    const graph = new Graph();
    const history = new History(graph);
    graph.addNode(0, 0, 'A');
    graph.addNode(1, 1, 'B');
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(labels(graph)).toEqual(['A']);
    expect(history.canRedo).toBe(true);
    history.undo();
    expect(labels(graph)).toEqual([]);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(labels(graph)).toEqual(['A']);
    history.redo();
    expect(labels(graph)).toEqual(['A', 'B']);
    expect(history.canRedo).toBe(false);
  });

  it('restores every part of the document: positions, labels, edges and settings', () => {
    const graph = new Graph();
    const a = graph.addNode(0, 0, 'A');
    const b = graph.addNode(100, 0, 'B');
    const history = new History(graph);
    graph.moveNode(a.id, 50, 50);
    graph.setNodeLabel(b.id, 'Bee');
    graph.addEdge(a.id, b.id, 'yes', { sourceSide: 'right' });
    graph.setDirected(false);
    graph.setEdgeStyle('straight');
    for (let i = 0; i < 5; i++) history.undo();
    expect(graph.toJSON()).toEqual({
      directed: true,
      edgeStyle: 'orthogonal',
      nodes: [
        { id: 'n1', label: 'A', type: 'task', variant: 'none', x: 0, y: 0 },
        { id: 'n2', label: 'B', type: 'task', variant: 'none', x: 100, y: 0 },
      ],
      edges: [],
    });
    for (let i = 0; i < 5; i++) history.redo();
    expect(graph.toJSON()).toMatchObject({
      directed: false,
      edgeStyle: 'straight',
      nodes: [
        { id: 'n1', x: 50, y: 50 },
        { id: 'n2', label: 'Bee' },
      ],
      edges: [{ source: 'n1', target: 'n2', label: 'yes', sourceSide: 'right' }],
    });
  });

  it('ignores undo and redo when there is nothing to do', () => {
    const graph = new Graph();
    graph.addNode(0, 0, 'A');
    const history = new History(graph);
    history.undo();
    history.redo();
    expect(labels(graph)).toEqual(['A']);
  });

  it('discards the redo steps when a new change is made after undoing', () => {
    const graph = new Graph();
    const history = new History(graph);
    graph.addNode(0, 0, 'A');
    graph.addNode(1, 1, 'B');
    history.undo();
    graph.addNode(2, 2, 'C');
    expect(history.canRedo).toBe(false);
    history.redo();
    expect(labels(graph)).toEqual(['A', 'C']);
  });

  it('groups the changes of a transaction into one step', () => {
    const graph = new Graph();
    const node = graph.addNode(0, 0, 'A');
    const history = new History(graph);
    history.begin();
    graph.moveNode(node.id, 10, 0);
    graph.moveNode(node.id, 20, 0);
    graph.moveNode(node.id, 30, 0);
    history.commit();
    history.undo();
    expect(graph.getNode(node.id)).toMatchObject({ x: 0, y: 0 });
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(graph.getNode(node.id)).toMatchObject({ x: 30, y: 0 });
  });

  it('records the step only when the outermost transaction is committed', () => {
    const graph = new Graph();
    const history = new History(graph);
    history.begin();
    graph.addNode(0, 0, 'A');
    history.begin();
    graph.addNode(1, 1, 'B');
    history.commit();
    expect(history.canUndo).toBe(false);
    history.commit();
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(labels(graph)).toEqual([]);
  });

  it('records nothing for a transaction without changes, and tolerates a stray commit', () => {
    const graph = new Graph();
    const history = new History(graph);
    history.begin();
    history.commit();
    history.commit();
    expect(history.canUndo).toBe(false);
    graph.addNode(0, 0, 'A');
    expect(history.canUndo).toBe(true);
  });

  it('does not record the restoring done by undo and redo as new steps', () => {
    const graph = new Graph();
    const history = new History(graph);
    graph.addNode(0, 0, 'A');
    history.undo();
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it('keeps at most 100 steps, forgetting the oldest', () => {
    const graph = new Graph();
    const history = new History(graph);
    for (let i = 0; i < 105; i++) graph.addNode(i, 0, `N${i}`);
    let undone = 0;
    // Bounded so a broken undo cannot hang the run.
    while (history.canUndo && undone < 200) {
      history.undo();
      undone++;
    }
    expect(undone).toBe(100);
    expect(graph.nodeCount).toBe(5);
  });

  it('honours a custom limit', () => {
    const graph = new Graph();
    const history = new History(graph, 3);
    for (let i = 0; i < 6; i++) graph.addNode(i, 0);
    let undone = 0;
    while (history.canUndo && undone < 200) {
      history.undo();
      undone++;
    }
    expect(undone).toBe(3);
    expect(graph.nodeCount).toBe(3);
  });

  it('notifies listeners when the availability of undo or redo may have changed', () => {
    const graph = new Graph();
    const history = new History(graph);
    let calls = 0;
    const unsubscribe = history.onChange(() => calls++);
    graph.addNode(0, 0);
    history.undo();
    history.redo();
    expect(calls).toBe(3);
    unsubscribe();
    graph.addNode(1, 1);
    expect(calls).toBe(3);
  });
});

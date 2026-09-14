import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from './graph';
import { GLYPHS, glyphFor } from './glyphs';

/**
 * Expectations come from the agreed element table: 16×16 stroked glyphs centred in events,
 * at 1.5× in gateways, top-left with a 6 px inset in tasks; nothing for plain elements,
 * sub-processes, annotations and data objects (their marks are decorations, not glyphs).
 */

describe('GLYPHS', () => {
  it('defines a stroked path for every trigger, task type and gateway kind', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual(['exclusive', 'inclusive', 'message', 'parallel', 'script', 'service', 'timer', 'user']);
    for (const d of Object.values(GLYPHS)) {
      expect(d.startsWith('M ')).toBe(true);
      // Stays inside the 16×16 box.
      for (const value of d.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Number(value)).toBeGreaterThanOrEqual(0);
        expect(Number(value)).toBeLessThanOrEqual(16);
      }
    }
  });
});

describe('glyphFor', () => {
  it('shows nothing for plain elements and for types whose marks are decorations', () => {
    expect(glyphFor('start-event', 'none', { width: 36, height: 36 })).toBeNull();
    expect(glyphFor('task', 'none', { width: 100, height: 60 })).toBeNull();
    expect(glyphFor('end-event', 'terminate', { width: 36, height: 36 })).toBeNull();
    for (const type of ['subprocess', 'annotation', 'data-object'] as const) {
      expect(glyphFor(type, 'none', { width: 100, height: 60 })).toBeNull();
      expect(glyphFor(type, 'user', { width: 100, height: 60 })).toBeNull();
    }
  });

  it('centres event triggers at their natural size', () => {
    for (const type of ['start-event', 'intermediate-event', 'end-event'] as const) {
      expect(glyphFor(type, 'message', { width: 36, height: 36 })).toEqual({ d: GLYPHS.message, x: -8, y: -8, scale: 1 });
      expect(glyphFor(type, 'timer', { width: 36, height: 36 })).toEqual({ d: GLYPHS.timer, x: -8, y: -8, scale: 1 });
    }
  });

  it('puts task types in the top-left corner with a 6 px inset, following the box width', () => {
    expect(glyphFor('task', 'user', { width: 100, height: 60 })).toEqual({ d: GLYPHS.user, x: -44, y: -24, scale: 1 });
    expect(glyphFor('task', 'service', { width: 160, height: 60 })).toEqual({ d: GLYPHS.service, x: -74, y: -24, scale: 1 });
    expect(glyphFor('task', 'script', { width: 100, height: 60 })?.d).toBe(GLYPHS.script);
  });

  it('centres gateway markers at one and a half times their size', () => {
    expect(glyphFor('gateway', 'exclusive', { width: 50, height: 50 })).toEqual({ d: GLYPHS.exclusive, x: -12, y: -12, scale: 1.5 });
    expect(glyphFor('gateway', 'parallel', { width: 50, height: 50 })?.d).toBe(GLYPHS.parallel);
    expect(glyphFor('gateway', 'inclusive', { width: 50, height: 50 })?.d).toBe(GLYPHS.inclusive);
  });

  it('never draws a glyph for a variant the type does not have', () => {
    for (const type of NODE_TYPES) {
      expect(glyphFor(type, 'bogus', { width: 100, height: 60 })).toBeNull();
    }
  });
});

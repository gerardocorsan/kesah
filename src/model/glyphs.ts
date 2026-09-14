import type { NodeType } from './graph';
import type { Size } from './shapes';

/**
 * Icons drawn inside BPMN symbols: event triggers, task types and gateway
 * markers. Every glyph is a stroked path in a 16×16 box; the view scales and
 * places it with the transform returned by `glyphFor`.
 */

const GLYPH_BOX = 16;

export const GLYPHS: Record<string, string> = {
  message: 'M 1 3 H 15 V 13 H 1 Z M 1 3 L 8 9 L 15 3',
  timer: 'M 8 1 A 7 7 0 1 1 8 15 A 7 7 0 1 1 8 1 Z M 8 4 V 8 H 11',
  user: 'M 8 2 A 3 3 0 1 1 8 8 A 3 3 0 1 1 8 2 Z M 2 15 A 6 6 0 0 1 14 15',
  service: 'M 8 3 A 5 5 0 1 1 8 13 A 5 5 0 1 1 8 3 Z M 8 6 A 2 2 0 1 1 8 10 A 2 2 0 1 1 8 6 Z M 8 0 V 3 M 8 13 V 16 M 0 8 H 3 M 13 8 H 16',
  script: 'M 3 1 H 13 V 15 H 3 Z M 6 5 H 10 M 6 8 H 10 M 6 11 H 10',
  exclusive: 'M 3 3 L 13 13 M 13 3 L 3 13',
  parallel: 'M 8 2 V 14 M 2 8 H 14',
  inclusive: 'M 8 2 A 6 6 0 1 1 8 14 A 6 6 0 1 1 8 2 Z',
};

export interface Glyph {
  d: string;
  /** Top-left corner of the glyph box relative to the node centre. */
  x: number;
  y: number;
  /** Scale applied to the 16×16 box. */
  scale: number;
}

const TASK_INSET = 6;
const GATEWAY_SCALE = 1.5;

/** The glyph a node shows for its type and variant, or null when it shows none. */
export function glyphFor(type: NodeType, variant: string, size: Size): Glyph | null {
  const d = GLYPHS[variant];
  if (!d) return null;
  switch (type) {
    case 'start-event':
    case 'intermediate-event':
    case 'end-event':
      return { d, x: -GLYPH_BOX / 2, y: -GLYPH_BOX / 2, scale: 1 };
    case 'task':
      return { d, x: -size.width / 2 + TASK_INSET, y: -size.height / 2 + TASK_INSET, scale: 1 };
    case 'gateway': {
      const half = (GLYPH_BOX * GATEWAY_SCALE) / 2;
      return { d, x: -half, y: -half, scale: GATEWAY_SCALE };
    }
    default:
      return null;
  }
}

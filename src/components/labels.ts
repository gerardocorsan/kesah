import { NODE_TYPES, SIDES, type NodeType, type Side } from '../model/graph';

/** Display names shared by the tools, the inspector and the node list. */

export const NODE_TYPE_INFO: Record<NodeType, { name: string; title: string }> = {
  terminal: { name: 'Terminal', title: 'Start or end of the flow' },
  process: { name: 'Process', title: 'An action or step' },
  decision: { name: 'Decision', title: 'A question, with one outgoing edge per answer' },
  io: { name: 'Input / Output', title: 'Data entering or leaving the flow' },
};

export const NODE_TYPE_OPTIONS = NODE_TYPES.map((type) => ({ value: type, label: NODE_TYPE_INFO[type].name }));

export const SIDE_NAMES: Record<Side, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

/** "Auto" (empty value) plus the four sides, for the edge inspector. */
export const SIDE_OPTIONS = [{ value: '', label: 'Auto' }, ...SIDES.map((side) => ({ value: side, label: SIDE_NAMES[side] }))];

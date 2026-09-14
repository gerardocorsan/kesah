import {
  EDGE_KINDS,
  FLOW_CONDITIONS,
  NODE_TYPES,
  NODE_VARIANTS,
  SIDES,
  type EdgeKind,
  type FlowCondition,
  type NodeType,
  type Side,
} from '../model/graph';

/** Display names shared by the palette, the inspector and the node list. */

export const NODE_GROUPS = ['Events', 'Activities', 'Gateways', 'Artifacts'] as const;
export type NodeGroup = (typeof NODE_GROUPS)[number];

export const NODE_TYPE_INFO: Record<NodeType, { name: string; title: string; group: NodeGroup }> = {
  'start-event': { name: 'Start', title: 'Start event: where the process begins', group: 'Events' },
  'intermediate-event': { name: 'Intermediate', title: 'Intermediate event: something that happens during the process', group: 'Events' },
  'end-event': { name: 'End', title: 'End event: where a path of the process finishes', group: 'Events' },
  task: { name: 'Task', title: 'Task: a unit of work', group: 'Activities' },
  subprocess: { name: 'Sub-process', title: 'Collapsed sub-process: work detailed elsewhere', group: 'Activities' },
  gateway: { name: 'Gateway', title: 'Gateway: where the flow splits or joins', group: 'Gateways' },
  annotation: { name: 'Annotation', title: 'Text annotation, attached with an association', group: 'Artifacts' },
  'data-object': { name: 'Data object', title: 'Data produced or consumed by the process', group: 'Artifacts' },
};

export const NODE_TYPE_OPTIONS = NODE_TYPES.map((type) => ({ value: type, label: NODE_TYPE_INFO[type].name }));

export function typesInGroup(group: NodeGroup): NodeType[] {
  return NODE_TYPES.filter((type) => NODE_TYPE_INFO[type].group === group);
}

export const VARIANT_NAMES: Record<string, string> = {
  none: 'None',
  message: 'Message',
  timer: 'Timer',
  terminate: 'Terminate',
  user: 'User',
  service: 'Service',
  script: 'Script',
  exclusive: 'Exclusive',
  parallel: 'Parallel',
  inclusive: 'Inclusive',
};

/** Caption of the variant field per type; types without variants have no field. */
export const VARIANT_FIELD_LABEL: Partial<Record<NodeType, string>> = {
  'start-event': 'Trigger',
  'intermediate-event': 'Trigger',
  'end-event': 'Result',
  task: 'Task type',
  gateway: 'Gateway',
};

export function variantOptions(type: NodeType): { value: string; label: string }[] {
  return NODE_VARIANTS[type].map((variant) => ({ value: variant, label: VARIANT_NAMES[variant] ?? variant }));
}

export const EDGE_KIND_NAMES: Record<EdgeKind, string> = {
  sequence: 'Sequence flow',
  message: 'Message flow',
  association: 'Association',
};

export const EDGE_KIND_OPTIONS = EDGE_KINDS.map((kind) => ({ value: kind, label: EDGE_KIND_NAMES[kind] }));

export const CONDITION_NAMES: Record<FlowCondition, string> = {
  none: 'Normal',
  default: 'Default',
  conditional: 'Conditional',
};

export const CONDITION_OPTIONS = FLOW_CONDITIONS.map((condition) => ({ value: condition, label: CONDITION_NAMES[condition] }));

export const SIDE_NAMES: Record<Side, string> = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

/** "Auto" (empty value) plus the four sides, for the edge inspector. */
export const SIDE_OPTIONS = [{ value: '', label: 'Auto' }, ...SIDES.map((side) => ({ value: side, label: SIDE_NAMES[side] }))];

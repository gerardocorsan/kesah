import { createEffect, createSignal, on } from 'solid-js';
import { NODE_VARIANTS, isEdgeKind, isFlowCondition, isNodeType, isSide } from '../../model/graph';
import { useApp } from '../../state/app';
import { Button } from '../atoms/Button';
import { Muted } from '../atoms/Muted';
import { Select } from '../atoms/Select';
import { TextInput } from '../atoms/TextInput';
import { Field } from '../molecules/Field';
import { CONDITION_OPTIONS, EDGE_KIND_OPTIONS, NODE_TYPE_OPTIONS, SIDE_OPTIONS, VARIANT_FIELD_LABEL, variantOptions } from '../labels';
import './panel.css';

/** Organism: the properties of the selected node or edge, editable in place. */
export function InspectorPanel() {
  const app = useApp();
  let input!: HTMLInputElement;

  // Plain accessors rather than memos: the graph mutates objects in place, so every
  // consumer must re-read the fields whenever the revision changes.
  const node = () => {
    app.revision();
    const s = app.selection();
    return s?.kind === 'node' ? app.graph.getNode(s.id) : undefined;
  };
  const edge = () => {
    app.revision();
    const s = app.selection();
    return s?.kind === 'edge' ? app.graph.getEdge(s.id) : undefined;
  };
  const hasSelection = () => node() !== undefined || edge() !== undefined;
  const title = () => (node() ? 'Node' : edge() ? 'Edge' : 'Selection');
  const modelLabel = () => node()?.label ?? edge()?.label ?? '';
  const variantLabel = () => {
    const n = node();
    return n && NODE_VARIANTS[n.type].length > 0 ? (VARIANT_FIELD_LABEL[n.type] ?? 'Variant') : null;
  };
  const info = () => {
    const n = node();
    if (n) {
      const degree = app.edges().filter((e) => e.source === n.id || e.target === n.id).length;
      return `${degree} ${degree === 1 ? 'edge' : 'edges'} connected`;
    }
    const e = edge();
    if (!e) return '';
    const source = app.graph.getNode(e.source)?.label ?? e.source;
    const target = app.graph.getNode(e.target)?.label ?? e.target;
    return `${source} → ${target}`;
  };

  // While the name field has focus it shows what is being typed, not the model:
  // an empty node name is never applied, and trimming must not move the caret.
  const [draft, setDraft] = createSignal<string | null>(null);
  const shownLabel = () => draft() ?? modelLabel();
  const applyLabel = (value: string): void => {
    const s = app.selection();
    if (!s) return;
    const trimmed = value.trim();
    if (s.kind === 'node') {
      if (trimmed !== '') app.graph.setNodeLabel(s.id, trimmed);
    } else {
      app.graph.setEdgeLabel(s.id, trimmed);
    }
  };
  createEffect(on(app.selection, () => setDraft(null)));
  createEffect(
    on(
      app.editRequest,
      () => {
        if (!hasSelection()) return;
        input.focus();
        input.select();
      },
      { defer: true },
    ),
  );

  const setSide = (end: 'source' | 'target', value: string): void => {
    const e = edge();
    if (e) app.graph.setEdgeSide(e.id, end, isSide(value) ? value : undefined);
  };

  return (
    <section class="panel">
      <h2 id="inspector-title">{title()}</h2>
      <Muted id="inspector-empty" hidden={hasSelection()}>
        Click a node or an edge to edit it.
      </Muted>
      <form id="inspector-form" hidden={!hasSelection()} onSubmit={(e) => e.preventDefault()}>
        <Field label={node() ? 'Name' : 'Label'}>
          <TextInput
            id="inp-label"
            ref={(el) => (input = el)}
            value={shownLabel()}
            onFocus={() => {
              setDraft(modelLabel());
              // Everything typed until the field loses focus is one undo step.
              app.history.begin();
            }}
            onInput={(value) => {
              setDraft(value);
              applyLabel(value);
            }}
            onBlur={() => {
              setDraft(null);
              app.history.commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                input.blur();
              }
            }}
          />
        </Field>
        <Field id="type-field" label="Type" hidden={!node()}>
          <Select
            id="sel-type"
            value={node()?.type ?? 'task'}
            options={NODE_TYPE_OPTIONS}
            onChange={(value) => {
              const n = node();
              if (n && isNodeType(value)) app.graph.setNodeType(n.id, value);
            }}
          />
        </Field>
        <Field id="variant-field" label={variantLabel() ?? 'Variant'} hidden={!variantLabel()}>
          <Select
            id="sel-variant"
            value={node()?.variant ?? 'none'}
            options={(() => {
              const n = node();
              return n ? variantOptions(n.type) : [];
            })()}
            onChange={(value) => {
              const n = node();
              if (n) app.graph.setNodeVariant(n.id, value);
            }}
          />
        </Field>
        <Field id="kind-field" label="Kind" hidden={!edge()}>
          <Select
            id="sel-kind"
            value={edge()?.kind ?? 'sequence'}
            options={EDGE_KIND_OPTIONS}
            onChange={(value) => {
              const e = edge();
              if (e && isEdgeKind(value)) app.graph.setEdgeKind(e.id, value);
            }}
          />
        </Field>
        <Field id="condition-field" label="Condition" hidden={edge()?.kind !== 'sequence'}>
          <Select
            id="sel-condition"
            value={edge()?.condition ?? 'none'}
            options={CONDITION_OPTIONS}
            onChange={(value) => {
              const e = edge();
              if (e && isFlowCondition(value)) app.graph.setEdgeCondition(e.id, value);
            }}
          />
        </Field>
        <Field id="source-side-field" label="From side" hidden={!edge()}>
          <Select id="sel-source-side" value={edge()?.sourceSide ?? ''} options={SIDE_OPTIONS} onChange={(value) => setSide('source', value)} />
        </Field>
        <Field id="target-side-field" label="To side" hidden={!edge()}>
          <Select id="sel-target-side" value={edge()?.targetSide ?? ''} options={SIDE_OPTIONS} onChange={(value) => setSide('target', value)} />
        </Field>
        <Muted id="inspector-info">{info()}</Muted>
        <Button id="btn-delete" variant="danger" title="Delete the selected node or edge (Delete key)" onClick={() => app.deleteSelection()}>
          Delete
        </Button>
      </form>
    </section>
  );
}

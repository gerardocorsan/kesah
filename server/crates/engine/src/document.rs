//! The BPMN document exactly as the web application exports it, plus the
//! validated, indexed form the interpreter works on.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// BPMN element of a node. Serialised with the same names as the JSON document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeType {
    StartEvent,
    IntermediateEvent,
    EndEvent,
    Task,
    Subprocess,
    Gateway,
    Annotation,
    DataObject,
}

impl NodeType {
    /// Variants the type accepts; `none` for types without variants.
    pub fn variants(self) -> &'static [&'static str] {
        match self {
            NodeType::StartEvent | NodeType::IntermediateEvent => &["none", "message", "timer"],
            NodeType::EndEvent => &["none", "message", "terminate"],
            NodeType::Task => &["none", "user", "service", "script"],
            NodeType::Gateway => &["exclusive", "parallel", "inclusive"],
            NodeType::Subprocess | NodeType::Annotation | NodeType::DataObject => &["none"],
        }
    }
}

impl fmt::Display for NodeType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            NodeType::StartEvent => "start event",
            NodeType::IntermediateEvent => "intermediate event",
            NodeType::EndEvent => "end event",
            NodeType::Task => "task",
            NodeType::Subprocess => "sub-process",
            NodeType::Gateway => "gateway",
            NodeType::Annotation => "annotation",
            NodeType::DataObject => "data object",
        };
        f.write_str(name)
    }
}

/// BPMN connection of an edge. Only sequence flows are executed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Sequence,
    Message,
    Association,
}

/// Mark at the source of a sequence flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowCondition {
    None,
    Default,
    Conditional,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "type")]
    pub kind: NodeType,
    #[serde(default = "none")]
    pub variant: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// Rhai script run when a token reaches a task or sub-process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// Milliseconds a timer event waits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    /// Name a message event waits for, or emits when it is an end event.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl Node {
    /// The label, or the id when the label is empty; for messages to humans.
    pub fn name(&self) -> &str {
        if self.label.trim().is_empty() { &self.id } else { &self.label }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "sequence")]
    pub kind: EdgeKind,
    #[serde(default = "no_condition")]
    pub condition: FlowCondition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_side: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_side: Option<String>,
    /// Rhai boolean expression evaluated when the flow leaves a gateway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
}

/// The document as exported by the web application (`Graph.toJSON()`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default = "yes")]
    pub directed: bool,
    #[serde(default = "orthogonal")]
    pub edge_style: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

fn none() -> String {
    "none".to_string()
}
fn sequence() -> EdgeKind {
    EdgeKind::Sequence
}
fn no_condition() -> FlowCondition {
    FlowCondition::None
}
fn yes() -> bool {
    true
}
fn orthogonal() -> String {
    "orthogonal".to_string()
}

/// Why a document cannot be executed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentError {
    DuplicateNodeId(String),
    DuplicateEdgeId(String),
    UnknownVariant { node: String, variant: String },
    MissingNode { edge: String, node: String },
    SelfLoop(String),
    NegativeDelay(String),
    NoStartEvent,
}

impl fmt::Display for DocumentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DocumentError::DuplicateNodeId(id) => write!(f, "node id \"{id}\" appears more than once"),
            DocumentError::DuplicateEdgeId(id) => write!(f, "edge id \"{id}\" appears more than once"),
            DocumentError::UnknownVariant { node, variant } => {
                write!(f, "node \"{node}\" has a variant its type does not accept: \"{variant}\"")
            }
            DocumentError::MissingNode { edge, node } => write!(f, "edge \"{edge}\" refers to a missing node \"{node}\""),
            DocumentError::SelfLoop(id) => write!(f, "edge \"{id}\" joins a node to itself"),
            DocumentError::NegativeDelay(id) => write!(f, "node \"{id}\" has a negative delay"),
            DocumentError::NoStartEvent => f.write_str("the document has no start event"),
        }
    }
}

impl std::error::Error for DocumentError {}

/// A validated document with the indexes the interpreter needs.
#[derive(Debug, Clone)]
pub struct Process {
    document: Document,
    nodes: HashMap<String, usize>,
    edges: HashMap<String, usize>,
    /// Indexes (into `document.edges`) of the sequence flows leaving each node, in document order.
    outgoing: HashMap<String, Vec<usize>>,
    /// Number of sequence flows entering each node.
    incoming: HashMap<String, usize>,
}

impl Process {
    /// Validates the document: unique ids, known variants, edges between existing distinct
    /// nodes, non-negative delays, and at least one start event.
    pub fn new(document: Document) -> Result<Process, DocumentError> {
        let mut nodes = HashMap::new();
        for (index, node) in document.nodes.iter().enumerate() {
            if nodes.insert(node.id.clone(), index).is_some() {
                return Err(DocumentError::DuplicateNodeId(node.id.clone()));
            }
            if !node.kind.variants().contains(&node.variant.as_str()) {
                return Err(DocumentError::UnknownVariant { node: node.id.clone(), variant: node.variant.clone() });
            }
            if node.delay.is_some_and(|delay| delay < 0.0) {
                return Err(DocumentError::NegativeDelay(node.id.clone()));
            }
        }
        if !document.nodes.iter().any(|node| node.kind == NodeType::StartEvent) {
            return Err(DocumentError::NoStartEvent);
        }
        let mut edge_ids = HashMap::new();
        let mut outgoing: HashMap<String, Vec<usize>> = HashMap::new();
        let mut incoming: HashMap<String, usize> = HashMap::new();
        for (index, edge) in document.edges.iter().enumerate() {
            if edge_ids.insert(edge.id.clone(), index).is_some() {
                return Err(DocumentError::DuplicateEdgeId(edge.id.clone()));
            }
            for node in [&edge.source, &edge.target] {
                if !nodes.contains_key(node) {
                    return Err(DocumentError::MissingNode { edge: edge.id.clone(), node: node.clone() });
                }
            }
            if edge.source == edge.target {
                return Err(DocumentError::SelfLoop(edge.id.clone()));
            }
            if edge.kind == EdgeKind::Sequence {
                outgoing.entry(edge.source.clone()).or_default().push(index);
                *incoming.entry(edge.target.clone()).or_default() += 1;
            }
        }
        Ok(Process { document, nodes, edges: edge_ids, outgoing, incoming })
    }

    pub fn document(&self) -> &Document {
        &self.document
    }

    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.get(id).map(|&index| &self.document.nodes[index])
    }

    pub fn edge(&self, id: &str) -> Option<&Edge> {
        self.edges.get(id).map(|&index| &self.document.edges[index])
    }

    /// A node with more than one incoming sequence flow merges paths: gateways treat it as a join.
    pub fn is_join(&self, node: &str) -> bool {
        self.incoming_count(node) > 1
    }

    /// Sequence flows leaving the node, in document order. Message flows and associations are never followed.
    pub fn outgoing(&self, node: &str) -> Vec<&Edge> {
        self.outgoing.get(node).map(|indexes| indexes.iter().map(|&i| &self.document.edges[i]).collect()).unwrap_or_default()
    }

    /// Number of sequence flows entering the node.
    pub fn incoming_count(&self, node: &str) -> usize {
        self.incoming.get(node).copied().unwrap_or(0)
    }

    pub fn start_events(&self) -> Vec<&Node> {
        self.document.nodes.iter().filter(|node| node.kind == NodeType::StartEvent).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_explain_themselves_naming_the_element() {
        let cases = [
            (DocumentError::DuplicateNodeId("n1".into()), "node id \"n1\" appears more than once"),
            (DocumentError::DuplicateEdgeId("e1".into()), "edge id \"e1\" appears more than once"),
            (
                DocumentError::UnknownVariant { node: "n2".into(), variant: "timer".into() },
                "node \"n2\" has a variant its type does not accept: \"timer\"",
            ),
            (DocumentError::MissingNode { edge: "e1".into(), node: "zzz".into() }, "edge \"e1\" refers to a missing node \"zzz\""),
            (DocumentError::SelfLoop("e2".into()), "edge \"e2\" joins a node to itself"),
            (DocumentError::NegativeDelay("n3".into()), "node \"n3\" has a negative delay"),
            (DocumentError::NoStartEvent, "the document has no start event"),
        ];
        for (error, text) in cases {
            assert_eq!(error.to_string(), text);
        }
    }

    #[test]
    fn node_types_have_readable_names() {
        let names: Vec<String> = [
            NodeType::StartEvent,
            NodeType::IntermediateEvent,
            NodeType::EndEvent,
            NodeType::Task,
            NodeType::Subprocess,
            NodeType::Gateway,
            NodeType::Annotation,
            NodeType::DataObject,
        ]
        .iter()
        .map(ToString::to_string)
        .collect();
        assert_eq!(
            names,
            ["start event", "intermediate event", "end event", "task", "sub-process", "gateway", "annotation", "data object"]
        );
    }
}

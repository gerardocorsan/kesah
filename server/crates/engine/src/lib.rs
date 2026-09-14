//! Token-based interpreter for Kesah BPMN documents.
//!
//! The crate is pure: it never reads a clock, touches the network or the file
//! system. Time is a number of milliseconds handed in by the caller, so the
//! same instance can be driven by a real scheduler or by a test.

pub mod document;
pub mod instance;
pub mod scripting;

pub use document::{Document, DocumentError, Edge, EdgeKind, FlowCondition, Node, NodeType, Process};
pub use instance::{EngineError, Instance, Level, LogEntry, Status, Token, Vars, Wait};

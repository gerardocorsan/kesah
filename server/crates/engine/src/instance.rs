//! A running process: tokens moving through the sequence flows of a document.

use crate::document::{Edge, FlowCondition, Node, NodeType, Process};
use crate::scripting;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt;
use std::sync::Arc;

/// Process variables: a JSON object shared by every token of the instance.
pub type Vars = Map<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Running,
    Waiting,
    Finished,
    Failed,
    Stopped,
}

/// What a token is waiting for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Wait {
    Timer { due: u64 },
    Message { name: String },
    UserTask,
    Join,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub id: u64,
    pub node: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait: Option<Wait>,
    /// Sequence flow the token came through; joins use it to count arrivals.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrived_via: Option<String>,
    /// Set once a wait has been satisfied, so the node continues instead of waiting again.
    #[serde(skip)]
    resumed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    pub level: Level,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// Nothing in the instance is waiting for the given message or task.
    NotWaiting(String),
    /// The instance has finished, failed or was stopped.
    NotActive(Status),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::NotWaiting(what) => write!(f, "nothing is waiting for {what}"),
            EngineError::NotActive(status) => write!(f, "the instance is not active (status: {status:?})"),
        }
    }
}

impl std::error::Error for EngineError {}

/// Steps a single `run` may take before the instance is failed as never settling (a cycle without exit).
pub const MAX_STEPS: u32 = 100_000;

/// A process being executed. Serialises to the state the API exposes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    #[serde(skip)]
    process: Arc<Process>,
    pub status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub tokens: Vec<Token>,
    pub vars: Vars,
    pub log: Vec<LogEntry>,
    /// Ids of the nodes and sequence flows visited, in order, for highlighting.
    pub trail: Vec<String>,
    pub started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    #[serde(skip)]
    next_token: u64,
}

impl Instance {
    /// Places a token on every start event and runs until the instance waits or ends.
    pub fn start(process: Arc<Process>, vars: Vars, now: u64) -> Instance {
        let mut instance = Instance {
            process,
            status: Status::Running,
            error: None,
            tokens: Vec::new(),
            vars,
            log: Vec::new(),
            trail: Vec::new(),
            started_at: now,
            finished_at: None,
            next_token: 1,
        };
        let starts: Vec<String> = instance.process.start_events().iter().map(|node| node.id.clone()).collect();
        for id in starts {
            instance.place(id, None);
        }
        instance.run(now);
        instance
    }

    pub fn process(&self) -> &Process {
        &self.process
    }

    pub fn is_active(&self) -> bool {
        matches!(self.status, Status::Running | Status::Waiting)
    }

    /// Earliest timer the instance is waiting for, if any.
    pub fn next_due(&self) -> Option<u64> {
        if !self.is_active() {
            return None;
        }
        self.tokens
            .iter()
            .filter_map(|token| match token.wait {
                Some(Wait::Timer { due }) => Some(due),
                _ => None,
            })
            .min()
    }

    /// Moves every runnable token until all of them wait or none is left.
    pub fn run(&mut self, now: u64) {
        if !self.is_active() {
            return;
        }
        self.status = Status::Running;
        let mut steps = 0;
        while let Some(index) = self.tokens.iter().position(|token| token.wait.is_none()) {
            steps += 1;
            if steps > MAX_STEPS {
                self.fail(None, format!("the process did not settle after {MAX_STEPS} steps"), now);
                return;
            }
            self.step(index, now);
            if self.status != Status::Running {
                return;
            }
        }
        if self.tokens.is_empty() {
            self.finish(now);
        } else {
            self.status = Status::Waiting;
        }
    }

    /// Releases the timers that are due and runs.
    pub fn tick(&mut self, now: u64) {
        let mut resumed = false;
        for token in &mut self.tokens {
            if let Some(Wait::Timer { due }) = token.wait
                && due <= now
            {
                token.wait = None;
                token.resumed = true;
                resumed = true;
            }
        }
        if resumed {
            self.run(now);
        }
    }

    /// Delivers a message to every token waiting for it.
    pub fn send_message(&mut self, name: &str, now: u64) -> Result<(), EngineError> {
        if !self.is_active() {
            return Err(EngineError::NotActive(self.status));
        }
        let mut delivered = false;
        for token in &mut self.tokens {
            if matches!(&token.wait, Some(Wait::Message { name: waiting }) if waiting == name) {
                token.wait = None;
                token.resumed = true;
                delivered = true;
            }
        }
        if !delivered {
            return Err(EngineError::NotWaiting(format!("message \"{name}\"")));
        }
        self.info(None, format!("received {name}"), now);
        self.run(now);
        Ok(())
    }

    /// Completes the user task waiting at the node, merging the patch into the variables first.
    pub fn complete_task(&mut self, node: &str, patch: Option<Vars>, now: u64) -> Result<(), EngineError> {
        if !self.is_active() {
            return Err(EngineError::NotActive(self.status));
        }
        let Some(token) = self.tokens.iter_mut().find(|token| token.node == node && token.wait == Some(Wait::UserTask)) else {
            return Err(EngineError::NotWaiting(format!("a user task at \"{node}\"")));
        };
        token.wait = None;
        token.resumed = true;
        if let Some(patch) = patch {
            for (key, value) in patch {
                self.vars.insert(key, value);
            }
        }
        self.run(now);
        Ok(())
    }

    pub fn stop(&mut self, now: u64) {
        if !self.is_active() {
            return;
        }
        self.status = Status::Stopped;
        self.finished_at = Some(now);
        self.info(None, "stopped".to_string(), now);
    }

    /// The state as the API exposes it.
    pub fn snapshot(&self) -> Value {
        serde_json::to_value(self).expect("an instance always serialises")
    }

    // --- Steps ---------------------------------------------------------------

    fn step(&mut self, index: usize, now: u64) {
        let node_id = self.tokens[index].node.clone();
        let Some(node) = self.process.node(&node_id).cloned() else {
            self.fail(Some(&node_id), "the token is on a node that does not exist".to_string(), now);
            return;
        };
        match node.kind {
            NodeType::StartEvent | NodeType::IntermediateEvent => self.step_event(index, &node, now),
            NodeType::Task | NodeType::Subprocess => self.step_activity(index, &node, now),
            NodeType::Gateway => self.step_gateway(index, &node, now),
            NodeType::EndEvent => self.step_end(index, &node, now),
            NodeType::Annotation | NodeType::DataObject => {
                self.warn(Some(&node.id), format!("a token reached \"{}\", a {} that cannot be executed", node.name(), node.kind), now);
                self.tokens.remove(index);
            }
        }
    }

    fn step_event(&mut self, index: usize, node: &Node, now: u64) {
        if !self.tokens[index].resumed {
            match node.variant.as_str() {
                "timer" => {
                    let delay = node.delay.unwrap_or(0.0).max(0.0) as u64;
                    self.tokens[index].wait = Some(Wait::Timer { due: now + delay });
                    return;
                }
                "message" => {
                    self.tokens[index].wait = Some(Wait::Message { name: node.message.clone().unwrap_or_default() });
                    return;
                }
                _ => {}
            }
        }
        let outgoing = self.outgoing_ids(&node.id);
        self.advance(index, &outgoing, now);
    }

    fn step_activity(&mut self, index: usize, node: &Node, now: u64) {
        if node.variant == "user" && !self.tokens[index].resumed {
            self.tokens[index].wait = Some(Wait::UserTask);
            return;
        }
        if let Some(script) = node.script.as_deref().filter(|script| !script.trim().is_empty()) {
            match scripting::run_script(script, &self.vars) {
                Ok(outcome) => {
                    self.vars = outcome.vars;
                    for line in outcome.logs {
                        self.info(Some(&node.id), line, now);
                    }
                }
                Err(message) => {
                    self.fail(Some(&node.id), format!("script error in \"{}\": {message}", node.name()), now);
                    return;
                }
            }
        }
        let outgoing = self.outgoing_ids(&node.id);
        self.advance(index, &outgoing, now);
    }

    fn step_gateway(&mut self, mut index: usize, node: &Node, now: u64) {
        let incoming = self.process.incoming_count(&node.id);
        if self.process.is_join(&node.id) && node.variant != "exclusive" {
            // A join: the token waits until every incoming flow has delivered one.
            self.tokens[index].wait = Some(Wait::Join);
            let mut arrived: Vec<&str> =
                self.tokens.iter().filter(|token| token.node == node.id).filter_map(|token| token.arrived_via.as_deref()).collect();
            arrived.sort_unstable();
            arrived.dedup();
            let elsewhere = self.tokens.iter().any(|token| token.node != node.id);
            let ready = arrived.len() >= incoming || (node.variant == "inclusive" && !elsewhere);
            if !ready {
                return;
            }
            // The current token continues on its own; the other arrivals are consumed.
            let keep = self.tokens[index].id;
            self.tokens.retain(|token| token.node != node.id || token.id == keep);
            index = self.tokens.iter().position(|token| token.id == keep).expect("the joining token was kept");
            self.tokens[index].wait = None;
            self.tokens[index].arrived_via = None;
        }

        let outgoing: Vec<Edge> = self.process.outgoing(&node.id).into_iter().cloned().collect();
        if outgoing.is_empty() {
            self.fail(Some(&node.id), format!("gateway \"{}\" has no outgoing sequence flow", node.name()), now);
            return;
        }
        let chosen = match self.choose_flows(node, &outgoing) {
            Ok(chosen) => chosen,
            Err(message) => {
                self.fail(Some(&node.id), message, now);
                return;
            }
        };
        if chosen.is_empty() {
            self.fail(Some(&node.id), format!("no outgoing flow of gateway \"{}\" is open", node.name()), now);
            return;
        }
        self.advance(index, &chosen, now);
    }

    /// Ids of the flows a gateway sends the token down, by its variant.
    fn choose_flows(&self, node: &Node, outgoing: &[Edge]) -> Result<Vec<String>, String> {
        let default = outgoing.iter().find(|edge| edge.condition == FlowCondition::Default).map(|edge| edge.id.clone());
        let candidates = outgoing.iter().filter(|edge| edge.condition != FlowCondition::Default);
        match node.variant.as_str() {
            "parallel" => Ok(outgoing.iter().map(|edge| edge.id.clone()).collect()),
            "exclusive" => {
                for edge in candidates {
                    if self.flow_is_open(edge)? {
                        return Ok(vec![edge.id.clone()]);
                    }
                }
                Ok(default.into_iter().collect())
            }
            _ => {
                let mut open = Vec::new();
                for edge in candidates {
                    if self.flow_is_open(edge)? {
                        open.push(edge.id.clone());
                    }
                }
                if open.is_empty() {
                    open.extend(default);
                }
                Ok(open)
            }
        }
    }

    /// A flow without expression is open; otherwise its expression decides.
    fn flow_is_open(&self, edge: &Edge) -> Result<bool, String> {
        match edge.expression.as_deref().map(str::trim).filter(|expression| !expression.is_empty()) {
            None => Ok(true),
            Some(expression) => scripting::eval_expression(expression, &self.vars)
                .map_err(|message| format!("expression error in flow \"{}\": {message}", edge.id)),
        }
    }

    fn step_end(&mut self, index: usize, node: &Node, now: u64) {
        match node.variant.as_str() {
            "terminate" => {
                self.tokens.clear();
                self.info(Some(&node.id), format!("terminated at \"{}\"", node.name()), now);
            }
            "message" => {
                self.info(Some(&node.id), format!("sent {}", node.message.clone().unwrap_or_default()), now);
                self.tokens.remove(index);
            }
            _ => {
                self.tokens.remove(index);
            }
        }
    }

    // --- Helpers -------------------------------------------------------------

    fn outgoing_ids(&self, node: &str) -> Vec<String> {
        self.process.outgoing(node).into_iter().map(|edge| edge.id.clone()).collect()
    }

    /// Consumes the token and places one on the target of each flow (none: the path ends).
    fn advance(&mut self, index: usize, flows: &[String], _now: u64) {
        self.tokens.remove(index);
        for flow in flows {
            let Some(edge) = self.process.edge(flow) else {
                continue;
            };
            self.place(edge.target.clone(), Some(edge.id.clone()));
        }
    }

    fn place(&mut self, node: String, via: Option<String>) {
        if let Some(edge) = &via {
            self.trail.push(edge.clone());
        }
        self.trail.push(node.clone());
        let id = self.next_token;
        self.next_token += 1;
        self.tokens.push(Token { id, node, wait: None, arrived_via: via, resumed: false });
    }

    fn finish(&mut self, now: u64) {
        self.status = Status::Finished;
        self.finished_at = Some(now);
        self.info(None, "finished".to_string(), now);
    }

    fn fail(&mut self, node: Option<&str>, message: String, now: u64) {
        self.status = Status::Failed;
        self.finished_at = Some(now);
        self.error = Some(message.clone());
        self.entry(Level::Error, node, message, now);
    }

    fn info(&mut self, node: Option<&str>, message: String, now: u64) {
        self.entry(Level::Info, node, message, now);
    }

    fn warn(&mut self, node: Option<&str>, message: String, now: u64) {
        self.entry(Level::Warn, node, message, now);
    }

    fn entry(&mut self, level: Level, node: Option<&str>, message: String, at: u64) {
        self.log.push(LogEntry { at, node: node.map(str::to_string), level, message });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_explain_themselves() {
        assert_eq!(EngineError::NotWaiting("message \"paid\"".into()).to_string(), "nothing is waiting for message \"paid\"");
        assert_eq!(EngineError::NotActive(Status::Failed).to_string(), "the instance is not active (status: Failed)");
    }
}

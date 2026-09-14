//! In-memory storage of deployed documents and running instances.

use engine::{Document, Instance, Process};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

pub struct Deployed {
    pub id: String,
    pub document: Document,
    pub process: Arc<Process>,
    pub created_at: u64,
}

pub struct Running {
    pub id: String,
    pub process_id: String,
    pub instance: Instance,
    pub updated_at: u64,
    /// How much of the trail, the log and the status the console has already reported.
    pub(crate) reported_trail: usize,
    pub(crate) reported_log: usize,
}

impl Running {
    pub fn new(id: String, process_id: String, instance: Instance, now: u64) -> Running {
        Running { id, process_id, instance, updated_at: now, reported_trail: 0, reported_log: 0 }
    }

    /// The state the API exposes: the instance snapshot plus its identity.
    pub fn state(&self) -> Value {
        let mut state = self.instance.snapshot();
        if let Value::Object(map) = &mut state {
            map.insert("id".into(), json!(self.id));
            map.insert("processId".into(), json!(self.process_id));
            map.insert("updatedAt".into(), json!(self.updated_at));
        }
        state
    }

    pub fn summary(&self) -> Value {
        json!({
            "id": self.id,
            "processId": self.process_id,
            "status": self.instance.status,
            "startedAt": self.instance.started_at,
            "finishedAt": self.instance.finished_at,
            "updatedAt": self.updated_at,
        })
    }
}

#[derive(Default)]
pub struct Store {
    pub processes: HashMap<String, Deployed>,
    pub instances: HashMap<String, Running>,
    counter: u64,
}

impl Store {
    /// Ids are unique per store: a prefix, the current time and a counter.
    pub fn next_id(&mut self, prefix: &str, now: u64) -> String {
        self.counter += 1;
        format!("{prefix}-{now:x}-{:x}", self.counter)
    }
}

/// A state change of an instance, broadcast to the event streams.
#[derive(Debug, Clone)]
pub struct StateEvent {
    pub instance_id: String,
    pub state: Value,
}

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Mutex<Store>>,
    pub events: broadcast::Sender<StateEvent>,
}

impl AppState {
    pub fn new() -> AppState {
        let (events, _) = broadcast::channel(256);
        AppState { store: Arc::new(Mutex::new(Store::default())), events }
    }

    pub fn publish(&self, instance_id: &str, state: Value) {
        // No subscribers is not an error: the state is still in the store.
        let _ = self.events.send(StateEvent { instance_id: instance_id.to_string(), state });
    }
}

impl Default for AppState {
    fn default() -> Self {
        AppState::new()
    }
}

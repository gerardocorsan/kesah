//! REST endpoints and the Server-Sent Events stream.

use crate::console;
use crate::now_millis;
use crate::store::{AppState, Deployed, Running};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use engine::{Document, EngineError, Instance, Process, Vars};
use serde::Deserialize;
use serde_json::{Value, json};
use std::convert::Infallible;
use std::sync::Arc;
use tokio_stream::{Stream, StreamExt, wrappers::BroadcastStream};

/// An error the client can act on: a status and a message.
pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

fn not_found(what: &str, id: &str) -> ApiError {
    ApiError(StatusCode::NOT_FOUND, format!("unknown {what} \"{id}\""))
}

fn conflict(error: EngineError) -> ApiError {
    ApiError(StatusCode::CONFLICT, error.to_string())
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/processes", get(list_processes).post(deploy))
        .route("/api/run", post(run))
        .route("/api/processes/{id}", get(get_process))
        .route("/api/processes/{id}/instances", post(start_instance))
        .route("/api/instances", get(list_instances))
        .route("/api/instances/{id}", get(get_instance))
        .route("/api/instances/{id}/messages", post(send_message))
        .route("/api/instances/{id}/tasks/{node}/complete", post(complete_task))
        .route("/api/instances/{id}/stop", post(stop_instance))
        .route("/api/instances/{id}/events", get(events))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn deploy(State(state): State<AppState>, Json(body): Json<Value>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let id = store_document(&state, body)?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

/// Validates the document, stores it and returns its id.
fn store_document(state: &AppState, body: Value) -> Result<String, ApiError> {
    let document: Document =
        serde_json::from_value(body).map_err(|error| ApiError(StatusCode::BAD_REQUEST, format!("invalid document: {error}")))?;
    let process =
        Process::new(document.clone()).map_err(|error| ApiError(StatusCode::BAD_REQUEST, format!("invalid document: {error}")))?;
    let now = now_millis();
    let mut store = state.store.lock().expect("store lock");
    let id = store.next_id("p", now);
    console::print(&[format!("{} {id} deployed: {} nodes, {} edges", console::clock(now), document.nodes.len(), document.edges.len())]);
    store.processes.insert(id.clone(), Deployed { id: id.clone(), document, process: Arc::new(process), created_at: now });
    Ok(id)
}

/// Deploys and starts in one call. The body is either the document itself or
/// `{ "document": …, "vars": … }`.
async fn run(State(state): State<AppState>, Json(body): Json<Value>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (document, vars) = match body {
        Value::Object(mut map) if map.contains_key("document") => {
            let document = map.remove("document").unwrap_or(Value::Null);
            let vars = match map.remove("vars") {
                None | Some(Value::Null) => Vars::new(),
                Some(Value::Object(vars)) => vars,
                Some(_) => return Err(ApiError(StatusCode::BAD_REQUEST, "vars must be an object".to_string())),
            };
            (document, vars)
        }
        document => (document, Vars::new()),
    };
    let id = store_document(&state, document)?;
    start(&state, id, vars)
}

fn process_summary(deployed: &Deployed) -> Value {
    json!({
        "id": deployed.id,
        "nodes": deployed.document.nodes.len(),
        "edges": deployed.document.edges.len(),
        "createdAt": deployed.created_at,
    })
}

async fn list_processes(State(state): State<AppState>) -> Json<Value> {
    let store = state.store.lock().expect("store lock");
    let mut list: Vec<Value> = store.processes.values().map(process_summary).collect();
    list.sort_by_key(|value| value["createdAt"].as_u64());
    Json(Value::Array(list))
}

async fn get_process(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let store = state.store.lock().expect("store lock");
    let deployed = store.processes.get(&id).ok_or_else(|| not_found("process", &id))?;
    let mut value = process_summary(deployed);
    value["document"] = serde_json::to_value(&deployed.document).expect("a document serialises");
    Ok(Json(value))
}

#[derive(Deserialize, Default)]
struct StartBody {
    #[serde(default)]
    vars: Option<Vars>,
}

async fn start_instance(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<StartBody>>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let vars = body.and_then(|Json(body)| body.vars).unwrap_or_default();
    start(&state, id, vars)
}

/// Starts an instance of a deployed process, runs it until it waits or ends, and publishes its state.
fn start(state: &AppState, id: String, vars: Vars) -> Result<(StatusCode, Json<Value>), ApiError> {
    let now = now_millis();
    let (instance_id, snapshot) = {
        let mut store = state.store.lock().expect("store lock");
        let process = store.processes.get(&id).ok_or_else(|| not_found("process", &id))?.process.clone();
        let instance_id = store.next_id("i", now);
        let started = format!("started from {id} with vars {}", Value::Object(vars.clone()));
        let mut running = Running::new(instance_id.clone(), id, Instance::start(process, vars, now), now);
        console::print(&running.drain_report(Some(started)));
        let snapshot = running.state();
        store.instances.insert(instance_id.clone(), running);
        (instance_id, snapshot)
    };
    state.publish(&instance_id, snapshot.clone());
    Ok((StatusCode::CREATED, Json(snapshot)))
}

async fn list_instances(State(state): State<AppState>) -> Json<Value> {
    let store = state.store.lock().expect("store lock");
    let mut list: Vec<Value> = store.instances.values().map(Running::summary).collect();
    list.sort_by_key(|value| value["startedAt"].as_u64());
    Json(Value::Array(list))
}

async fn get_instance(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let store = state.store.lock().expect("store lock");
    let running = store.instances.get(&id).ok_or_else(|| not_found("instance", &id))?;
    Ok(Json(running.state()))
}

/// Applies an action to an instance under the lock, reports it, then publishes the new state.
fn act(
    state: &AppState,
    id: &str,
    what: String,
    action: impl FnOnce(&mut Instance, u64) -> Result<(), ApiError>,
) -> Result<Json<Value>, ApiError> {
    let now = now_millis();
    let snapshot = {
        let mut store = state.store.lock().expect("store lock");
        let running = store.instances.get_mut(id).ok_or_else(|| not_found("instance", id))?;
        if let Err(error) = action(&mut running.instance, now) {
            console::print(&[format!("{} {id} refused: {what}: {}", console::clock(now), error.1)]);
            return Err(error);
        }
        running.updated_at = now;
        console::print(&running.drain_report(Some(what)));
        running.state()
    };
    state.publish(id, snapshot.clone());
    Ok(Json(snapshot))
}

#[derive(Deserialize)]
struct MessageBody {
    name: String,
}

async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<MessageBody>,
) -> Result<Json<Value>, ApiError> {
    act(&state, &id, format!("message \"{}\" received", body.name), |instance, now| {
        instance.send_message(&body.name, now).map_err(conflict)
    })
}

#[derive(Deserialize, Default)]
struct CompleteBody {
    #[serde(default)]
    vars: Option<Vars>,
}

async fn complete_task(
    State(state): State<AppState>,
    Path((id, node)): Path<(String, String)>,
    body: Option<Json<CompleteBody>>,
) -> Result<Json<Value>, ApiError> {
    let vars = body.and_then(|Json(body)| body.vars);
    let what = match &vars {
        Some(vars) if !vars.is_empty() => format!("task {node} completed with vars {}", Value::Object(vars.clone())),
        _ => format!("task {node} completed"),
    };
    act(&state, &id, what, |instance, now| instance.complete_task(&node, vars, now).map_err(conflict))
}

async fn stop_instance(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    act(&state, &id, "stop requested".to_string(), |instance, now| {
        instance.stop(now);
        Ok(())
    })
}

/// The current state first, then every change, as `state` events.
async fn events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let current = {
        let store = state.store.lock().expect("store lock");
        store.instances.get(&id).ok_or_else(|| not_found("instance", &id))?.state()
    };
    let receiver = state.events.subscribe();
    let initial = tokio_stream::once(Ok(state_event(&current)));
    let updates = BroadcastStream::new(receiver).filter_map(move |received| match received {
        Ok(event) if event.instance_id == id => Some(Ok(state_event(&event.state))),
        _ => None,
    });
    Ok(Sse::new(initial.chain(updates)).keep_alive(KeepAlive::default()))
}

fn state_event(state: &Value) -> Event {
    Event::default().event("state").data(state.to_string())
}

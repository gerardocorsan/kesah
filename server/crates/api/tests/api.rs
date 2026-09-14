//! The HTTP API end to end, in process: every endpoint, its error codes, the event stream,
//! and the sample order process from deployment to completion.

use api::{AppState, router, scheduler};
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

fn app() -> (Router, AppState) {
    let state = AppState::new();
    (router(state.clone()), state)
}

async fn call(app: &Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let request = Request::builder().method(method).uri(path);
    let request = match body {
        Some(body) => request.header(header::CONTENT_TYPE, "application/json").body(Body::from(body.to_string())).unwrap(),
        None => request.body(Body::empty()).unwrap(),
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into()))
    };
    (status, value)
}

fn node(id: &str, kind: &str, variant: &str, extra: Value) -> Value {
    let mut node = json!({ "id": id, "label": id, "type": kind, "variant": variant, "x": 0, "y": 0 });
    if let (Value::Object(target), Value::Object(source)) = (&mut node, extra) {
        target.extend(source);
    }
    node
}

fn edge(id: &str, source: &str, target: &str, extra: Value) -> Value {
    let mut edge = json!({ "id": id, "source": source, "target": target, "label": "", "kind": "sequence", "condition": "none" });
    if let (Value::Object(map), Value::Object(source)) = (&mut edge, extra) {
        map.extend(source);
    }
    edge
}

fn document(nodes: Vec<Value>, edges: Vec<Value>) -> Value {
    json!({ "directed": true, "edgeStyle": "orthogonal", "nodes": nodes, "edges": edges })
}

fn linear_script_process() -> Value {
    document(
        vec![
            node("n1", "start-event", "none", json!({})),
            node("n2", "task", "script", json!({ "script": r#"vars.total = vars.price * 2; log("doubled");"# })),
            node("n3", "end-event", "none", json!({})),
        ],
        vec![edge("e1", "n1", "n2", json!({})), edge("e2", "n2", "n3", json!({}))],
    )
}

fn user_task_process() -> Value {
    document(
        vec![
            node("n1", "start-event", "none", json!({})),
            node("n2", "task", "user", json!({})),
            node("n3", "end-event", "none", json!({})),
        ],
        vec![edge("e1", "n1", "n2", json!({})), edge("e2", "n2", "n3", json!({}))],
    )
}

/// The sample order process of the web application, with execution properties.
fn order_process() -> Value {
    document(
        vec![
            node("n1", "start-event", "none", json!({ "label": "Start" })),
            node("n2", "task", "user", json!({ "label": "Receive order" })),
            node("n3", "gateway", "exclusive", json!({ "label": "In stock?" })),
            node("n4", "task", "service", json!({ "label": "Ship order", "script": r#"log("shipping " + vars.item);"# })),
            node("n5", "end-event", "none", json!({ "label": "End" })),
            node("n6", "task", "none", json!({ "label": "Notify customer", "script": "vars.notified = true;" })),
            node("n7", "end-event", "message", json!({ "label": "Order rejected", "message": "rejected" })),
            node("n8", "annotation", "none", json!({ "label": "Checked daily" })),
        ],
        vec![
            edge("e1", "n1", "n2", json!({})),
            edge("e2", "n2", "n3", json!({})),
            edge("e3", "n3", "n4", json!({ "label": "yes", "condition": "conditional", "expression": "vars.stock" })),
            edge("e4", "n3", "n6", json!({ "label": "no", "condition": "default" })),
            edge("e5", "n4", "n5", json!({})),
            edge("e6", "n6", "n7", json!({})),
            edge("e7", "n8", "n3", json!({ "kind": "association" })),
        ],
    )
}

async fn deploy(app: &Router, doc: Value) -> String {
    let (status, body) = call(app, "POST", "/api/processes", Some(doc)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn health_answers_ok() {
    let (app, _) = app();
    let (status, body) = call(&app, "GET", "/api/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "status": "ok" }));
}

#[tokio::test]
async fn deploying_rejects_invalid_documents_with_the_reason() {
    let (app, _) = app();
    let (status, body) = call(&app, "POST", "/api/processes", Some(json!({ "nodes": "no" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().starts_with("invalid document"));

    let unknown = document(vec![node("n1", "hexagon", "none", json!({}))], vec![]);
    let (status, body) = call(&app, "POST", "/api/processes", Some(unknown)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("hexagon"));

    let no_start = document(vec![node("n1", "task", "none", json!({}))], vec![]);
    let (status, body) = call(&app, "POST", "/api/processes", Some(no_start)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("start event"));
}

#[tokio::test]
async fn deployed_processes_can_be_listed_and_fetched() {
    let (app, _) = app();
    let id = deploy(&app, linear_script_process()).await;
    let (status, list) = call(&app, "GET", "/api/processes", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list[0]["id"], id);
    assert_eq!(list[0]["nodes"], 3);
    assert_eq!(list[0]["edges"], 2);
    let (status, one) = call(&app, "GET", &format!("/api/processes/{id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(one["document"]["nodes"][1]["script"], r#"vars.total = vars.price * 2; log("doubled");"#);
    let (status, _) = call(&app, "GET", "/api/processes/nope", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn starting_an_instance_runs_it_until_it_ends() {
    let (app, _) = app();
    let id = deploy(&app, linear_script_process()).await;
    let (status, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({ "vars": { "price": 21 } }))).await;
    assert_eq!(status, StatusCode::CREATED, "{state}");
    assert_eq!(state["status"], "finished");
    assert_eq!(state["processId"], id);
    assert_eq!(state["vars"], json!({ "price": 21, "total": 42 }));
    assert!(state["log"].as_array().unwrap().iter().any(|entry| entry["message"] == "doubled"));
    let instance_id = state["id"].as_str().unwrap();
    let (status, fetched) = call(&app, "GET", &format!("/api/instances/{instance_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched["vars"], state["vars"]);
    let (status, list) = call(&app, "GET", "/api/instances", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list[0]["id"], instance_id);
    assert_eq!(list[0]["status"], "finished");
    let (status, _) = call(&app, "POST", "/api/processes/nope/instances", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&app, "GET", "/api/instances/nope", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn run_deploys_and_starts_in_one_call() {
    let (app, _) = app();
    let (status, state) = call(&app, "POST", "/api/run", Some(linear_script_process())).await;
    assert_eq!(status, StatusCode::CREATED, "{state}");
    assert_eq!(state["status"], "failed", "a bare document runs with no variables, so the script fails: {state}");
    let (status, list) = call(&app, "GET", "/api/processes", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 1, "the document was deployed");
    assert_eq!(state["processId"], list[0]["id"]);

    let wrapped = json!({ "document": linear_script_process(), "vars": { "price": 4 } });
    let (status, state) = call(&app, "POST", "/api/run", Some(wrapped)).await;
    assert_eq!(status, StatusCode::CREATED, "{state}");
    assert_eq!(state["status"], "finished");
    assert_eq!(state["vars"], json!({ "price": 4, "total": 8 }));

    let (status, body) = call(&app, "POST", "/api/run", Some(json!({ "document": linear_script_process(), "vars": 3 }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("vars"));
    let (status, body) = call(&app, "POST", "/api/run", Some(json!({ "document": { "nodes": [], "edges": [] } }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("start event"));
}

#[tokio::test]
async fn an_instance_can_start_without_a_body() {
    let (app, _) = app();
    let id = deploy(&app, user_task_process()).await;
    let request = Request::builder().method("POST").uri(format!("/api/processes/{id}/instances")).body(Body::empty()).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn user_tasks_wait_until_completed_and_conflicts_are_reported() {
    let (app, _) = app();
    let id = deploy(&app, user_task_process()).await;
    let (_, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({}))).await;
    assert_eq!(state["status"], "waiting");
    assert_eq!(state["tokens"][0]["wait"], json!({ "kind": "user-task" }));
    let instance = state["id"].as_str().unwrap();
    let (status, body) = call(&app, "POST", &format!("/api/instances/{instance}/tasks/n3/complete"), Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body["error"].as_str().unwrap().contains("n3"));
    let (status, state) =
        call(&app, "POST", &format!("/api/instances/{instance}/tasks/n2/complete"), Some(json!({ "vars": { "done": true } }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state["status"], "finished");
    assert_eq!(state["vars"], json!({ "done": true }));
    let (status, _) = call(&app, "POST", &format!("/api/instances/{instance}/tasks/n2/complete"), Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(&app, "POST", "/api/instances/nope/tasks/n2/complete", Some(json!({}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn messages_are_delivered_only_to_instances_waiting_for_them() {
    let (app, _) = app();
    let doc = document(
        vec![
            node("n1", "start-event", "none", json!({})),
            node("n2", "intermediate-event", "message", json!({ "message": "paid" })),
            node("n3", "end-event", "none", json!({})),
        ],
        vec![edge("e1", "n1", "n2", json!({})), edge("e2", "n2", "n3", json!({}))],
    );
    let id = deploy(&app, doc).await;
    let (_, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({}))).await;
    let instance = state["id"].as_str().unwrap();
    assert_eq!(state["tokens"][0]["wait"], json!({ "kind": "message", "name": "paid" }));
    let (status, _) = call(&app, "POST", &format!("/api/instances/{instance}/messages"), Some(json!({ "name": "other" }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, state) = call(&app, "POST", &format!("/api/instances/{instance}/messages"), Some(json!({ "name": "paid" }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state["status"], "finished");
}

#[tokio::test]
async fn stopping_ends_a_waiting_instance() {
    let (app, _) = app();
    let id = deploy(&app, user_task_process()).await;
    let (_, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({}))).await;
    let instance = state["id"].as_str().unwrap();
    let (status, state) = call(&app, "POST", &format!("/api/instances/{instance}/stop"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state["status"], "stopped");
    assert!(state["finishedAt"].is_number());
}

#[tokio::test]
async fn the_scheduler_releases_timers_and_publishes_the_change() {
    let (app, state) = app();
    scheduler::spawn(state.clone());
    let doc = document(
        vec![
            node("n1", "start-event", "none", json!({})),
            node("n2", "intermediate-event", "timer", json!({ "delay": 150 })),
            node("n3", "end-event", "none", json!({})),
        ],
        vec![edge("e1", "n1", "n2", json!({})), edge("e2", "n2", "n3", json!({}))],
    );
    let id = deploy(&app, doc).await;
    let mut receiver = state.events.subscribe();
    let (_, started) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({}))).await;
    assert_eq!(started["status"], "waiting");
    let instance = started["id"].as_str().unwrap().to_string();
    let first = receiver.recv().await.unwrap();
    assert_eq!(first.instance_id, instance);
    assert_eq!(first.state["status"], "waiting");
    let second =
        tokio::time::timeout(std::time::Duration::from_secs(3), receiver.recv()).await.expect("a timer release within 3 s").unwrap();
    assert_eq!(second.state["status"], "finished");
    let (_, fetched) = call(&app, "GET", &format!("/api/instances/{instance}"), None).await;
    assert_eq!(fetched["status"], "finished");
}

#[tokio::test]
async fn the_event_stream_starts_with_the_current_state() {
    let (app, _) = app();
    let id = deploy(&app, user_task_process()).await;
    let (_, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({}))).await;
    let instance = state["id"].as_str().unwrap();
    let request = Request::builder().method("GET").uri(format!("/api/instances/{instance}/events")).body(Body::empty()).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()[header::CONTENT_TYPE].to_str().unwrap().starts_with("text/event-stream"));
    let mut body = response.into_body();
    let frame = body.frame().await.expect("a first frame").unwrap();
    let text = String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap();
    assert!(text.starts_with("event: state\n"), "{text}");
    let data = text.lines().find_map(|line| line.strip_prefix("data: ")).unwrap();
    let parsed: Value = serde_json::from_str(data).unwrap();
    assert_eq!(parsed["id"], instance);
    assert_eq!(parsed["status"], "waiting");
    let (status, _) = call(&app, "GET", "/api/instances/nope/events", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_sample_order_process_runs_both_branches() {
    let (app, _) = app();
    let id = deploy(&app, order_process()).await;

    let (_, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({ "vars": { "item": "book" } }))).await;
    assert_eq!(state["status"], "waiting");
    assert_eq!(state["tokens"][0]["node"], "n2");
    let instance = state["id"].as_str().unwrap();
    let (_, state) =
        call(&app, "POST", &format!("/api/instances/{instance}/tasks/n2/complete"), Some(json!({ "vars": { "stock": true } }))).await;
    assert_eq!(state["status"], "finished");
    let trail: Vec<&str> = state["trail"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(trail, vec!["n1", "e1", "n2", "e2", "n3", "e3", "n4", "e5", "n5"]);
    assert!(state["log"].as_array().unwrap().iter().any(|entry| entry["message"] == "shipping book"));

    let (_, state) = call(&app, "POST", &format!("/api/processes/{id}/instances"), Some(json!({ "vars": { "item": "lamp" } }))).await;
    let instance = state["id"].as_str().unwrap();
    let (_, state) =
        call(&app, "POST", &format!("/api/instances/{instance}/tasks/n2/complete"), Some(json!({ "vars": { "stock": false } }))).await;
    assert_eq!(state["status"], "finished");
    let trail: Vec<&str> = state["trail"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(trail, vec!["n1", "e1", "n2", "e2", "n3", "e4", "n6", "e6", "n7"]);
    assert_eq!(state["vars"]["notified"], true);
    assert!(state["log"].as_array().unwrap().iter().any(|entry| entry["message"] == "sent rejected"));
}

mod console_report {
    //! What the server writes to its console for every step, read through `Running::drain_report`.
    use super::*;
    use api::console::clock;
    use api::store::Running;
    use engine::{Document, Instance, Process};
    use std::sync::Arc;

    fn running(doc: Value, vars: Value, now: u64) -> Running {
        let document: Document = serde_json::from_value(doc).unwrap();
        let process = Arc::new(Process::new(document).unwrap());
        let vars = match vars {
            Value::Object(map) => map,
            _ => panic!("object expected"),
        };
        Running::new("i-1".into(), "p-1".into(), Instance::start(process, vars, now), now)
    }

    #[test]
    fn the_clock_is_a_utc_time_of_day_with_milliseconds() {
        assert_eq!(clock(0), "00:00:00.000");
        assert_eq!(clock(45_296_789), "12:34:56.789");
        assert_eq!(clock(86_400_000 + 1_000), "00:00:01.000");
    }

    #[test]
    fn a_report_lists_the_action_every_node_reached_the_log_and_the_wait() {
        let mut running = running(order_process(), json!({ "item": "book" }), 45_296_789);
        let lines = running.drain_report(Some("started".into()));
        assert_eq!(lines[0], "12:34:56.789 i-1 started");
        assert_eq!(lines[1], "12:34:56.789 i-1   enter n1 \"Start\" (start event)");
        assert_eq!(lines[2], "12:34:56.789 i-1   leave n1 \"Start\" via e1");
        assert_eq!(lines[3], "12:34:56.789 i-1   enter n2 \"Receive order\" (task, user)");
        assert_eq!(lines[4], "12:34:56.789 i-1   waiting at n2 \"Receive order\" for user task");
        assert_eq!(lines.len(), 5);
        let again = running.drain_report(None);
        assert_eq!(again, vec![lines[4].clone()], "only the current wait is repeated, never a step");

        running.updated_at = 45_297_000;
        running.instance.complete_task("n2", Some(serde_json::from_value(json!({ "stock": true })).unwrap()), 45_297_000).unwrap();
        let lines = running.drain_report(Some("task n2 completed".into()));
        assert_eq!(
            lines,
            vec![
                "12:34:57.000 i-1 task n2 completed",
                "12:34:57.000 i-1   leave n2 \"Receive order\" via e2",
                "12:34:57.000 i-1   enter n3 \"In stock?\" (gateway, exclusive)",
                "12:34:57.000 i-1   leave n3 \"In stock?\" via e3",
                "12:34:57.000 i-1   enter n4 \"Ship order\" (task, service)",
                "12:34:57.000 i-1   [n4] shipping book",
                "12:34:57.000 i-1   leave n4 \"Ship order\" via e5",
                "12:34:57.000 i-1   enter n5 \"End\" (end event)",
                "12:34:57.000 i-1   finished",
            ]
        );
    }

    #[test]
    fn failures_and_timers_are_reported_with_their_reason() {
        let doc = document(
            vec![
                node("n1", "start-event", "none", json!({})),
                node("n2", "intermediate-event", "timer", json!({ "delay": 250 })),
                node("n3", "task", "script", json!({ "label": "Broken", "script": "nope();" })),
            ],
            vec![edge("e1", "n1", "n2", json!({})), edge("e2", "n2", "n3", json!({}))],
        );
        let mut running = running(doc, json!({}), 1_000);
        let lines = running.drain_report(None);
        assert!(lines.iter().any(|line| line.ends_with("waiting at n2 \"n2\" for timer due at 00:00:01.250")), "{lines:?}");
        running.instance.tick(1_250);
        running.updated_at = 1_250;
        let lines = running.drain_report(Some("timer fired".into()));
        assert_eq!(lines[0], "00:00:01.250 i-1 timer fired");
        assert_eq!(lines[1], "00:00:01.250 i-1   leave n2 \"n2\" via e2");
        assert_eq!(lines[2], "00:00:01.250 i-1   enter n3 \"Broken\" (task, script)");
        assert!(lines[3].contains("[n3] error: script error in \"Broken\""), "{lines:?}");
        assert_eq!(lines.len(), 4, "a failed instance waits for nothing: {lines:?}");
    }

    #[test]
    fn a_waiting_instance_reports_every_wait_after_each_step() {
        let doc = document(
            vec![
                node("n1", "start-event", "none", json!({})),
                node("n2", "gateway", "parallel", json!({})),
                node("n3", "task", "user", json!({ "label": "First" })),
                node("n4", "task", "user", json!({ "label": "Second" })),
                node("n5", "gateway", "parallel", json!({})),
                node("n6", "end-event", "none", json!({})),
            ],
            vec![
                edge("e1", "n1", "n2", json!({})),
                edge("e2", "n2", "n3", json!({})),
                edge("e3", "n2", "n4", json!({})),
                edge("e4", "n3", "n5", json!({})),
                edge("e5", "n4", "n5", json!({})),
                edge("e6", "n5", "n6", json!({})),
            ],
        );
        let mut running = running(doc, json!({}), 0);
        let first = running.drain_report(None);
        assert!(first.iter().any(|line| line.ends_with("waiting at n3 \"First\" for user task")), "{first:?}");
        assert!(first.iter().any(|line| line.ends_with("waiting at n4 \"Second\" for user task")), "{first:?}");
        running.instance.complete_task("n3", None, 5).unwrap();
        running.updated_at = 5;
        let second = running.drain_report(Some("task n3 completed".into()));
        assert!(second.iter().any(|line| line.ends_with("waiting at n5 \"n5\" for join")), "{second:?}");
        assert!(second.iter().any(|line| line.ends_with("waiting at n4 \"Second\" for user task")), "still waiting: {second:?}");
        assert!(!second.iter().any(|line| line.contains("enter n3")), "the first task is not entered again: {second:?}");
    }

    #[test]
    fn a_warning_is_marked_as_such() {
        let doc = document(
            vec![node("n1", "start-event", "none", json!({})), node("n2", "annotation", "none", json!({ "label": "Note" }))],
            vec![edge("e1", "n1", "n2", json!({}))],
        );
        let mut running = running(doc, json!({}), 0);
        let lines = running.drain_report(None);
        assert!(lines.iter().any(|line| line.contains("[n2] warning: a token reached \"Note\"")), "{lines:?}");
    }
}

//! Behaviour of the interpreter, one scenario per rule. Expectations come from the
//! documented semantics (README "Running processes" and docs/architecture.md), not from the code.

use engine::instance::MAX_STEPS;
use engine::{Document, DocumentError, Edge, EdgeKind, FlowCondition, Instance, Level, Node, NodeType, Process, Status, Vars, Wait};
use serde_json::{Map, Value, json};
use std::sync::Arc;

/// Builds a process from a compact description: nodes as (id, type, variant, extra fields)
/// and edges as (id, source, target, extra fields).
fn process(nodes: Vec<(&str, &str, &str, Value)>, edges: Vec<(&str, &str, &str, Value)>) -> Arc<Process> {
    let nodes: Vec<Value> = nodes
        .into_iter()
        .map(|(id, kind, variant, extra)| {
            let mut node = json!({ "id": id, "label": id, "type": kind, "variant": variant, "x": 0, "y": 0 });
            merge(&mut node, extra);
            node
        })
        .collect();
    let edges: Vec<Value> = edges
        .into_iter()
        .map(|(id, source, target, extra)| {
            let mut edge = json!({ "id": id, "source": source, "target": target, "label": "", "kind": "sequence", "condition": "none" });
            merge(&mut edge, extra);
            edge
        })
        .collect();
    let document: Document =
        serde_json::from_value(json!({ "directed": true, "edgeStyle": "orthogonal", "nodes": nodes, "edges": edges })).unwrap();
    Arc::new(Process::new(document).unwrap())
}

fn merge(into: &mut Value, extra: Value) {
    if let (Value::Object(target), Value::Object(source)) = (into, extra) {
        for (key, value) in source {
            target.insert(key, value);
        }
    }
}

fn vars(value: Value) -> Vars {
    match value {
        Value::Object(map) => map,
        _ => panic!("object expected"),
    }
}

fn nodes_in_trail(instance: &Instance) -> Vec<&str> {
    instance.trail.iter().map(String::as_str).filter(|id| id.starts_with('n')).collect()
}

fn messages(instance: &Instance) -> Vec<&str> {
    instance.log.iter().map(|entry| entry.message.as_str()).collect()
}

#[test]
fn a_linear_process_runs_its_scripts_in_order_and_finishes() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "task", "script", json!({ "script": "vars.total = vars.price * vars.qty;" })),
            ("n3", "task", "service", json!({ "script": r#"log("total " + vars.total);"# })),
            ("n4", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({})), ("e3", "n3", "n4", json!({}))],
    );
    let instance = Instance::start(process, vars(json!({ "price": 5, "qty": 3 })), 1_000);
    assert_eq!(instance.status, Status::Finished);
    assert_eq!(instance.vars, vars(json!({ "price": 5, "qty": 3, "total": 15 })));
    assert_eq!(nodes_in_trail(&instance), vec!["n1", "n2", "n3", "n4"]);
    assert_eq!(instance.trail, vec!["n1", "e1", "n2", "e2", "n3", "e3", "n4"]);
    assert!(instance.tokens.is_empty());
    assert_eq!(instance.started_at, 1_000);
    assert_eq!(instance.finished_at, Some(1_000));
    let logged = instance.log.iter().find(|entry| entry.message == "total 15").expect("script log");
    assert_eq!(logged.node.as_deref(), Some("n3"));
    assert_eq!(logged.level, Level::Info);
    assert_eq!(messages(&instance).last().copied(), Some("finished"));
}

#[test]
fn a_task_without_script_just_passes_the_token_on() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "task", "none", json!({})), ("n3", "end-event", "none", json!({}))],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    assert_eq!(nodes_in_trail(&instance), vec!["n1", "n2", "n3"]);
}

#[test]
fn a_script_error_fails_the_instance_and_names_the_node() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "task", "script", json!({ "label": "Broken", "script": "vars.x = nope + 1;" })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 7);
    assert_eq!(instance.status, Status::Failed);
    let error = instance.error.as_deref().unwrap();
    assert!(error.contains("Broken"), "{error}");
    let entry = instance.log.iter().find(|entry| entry.level == Level::Error).unwrap();
    assert_eq!(entry.node.as_deref(), Some("n2"));
    assert_eq!(instance.finished_at, Some(7));
    assert!(!nodes_in_trail(&instance).contains(&"n3"));
}

#[test]
fn a_runaway_script_fails_instead_of_hanging() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "task", "script", json!({ "script": "loop {}" })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    assert_eq!(Instance::start(process, Vars::new(), 0).status, Status::Failed);
}

#[test]
fn an_exclusive_gateway_takes_the_first_open_flow_in_document_order() {
    let build = |vars_value: Value| {
        let process = process(
            vec![
                ("n1", "start-event", "none", json!({})),
                ("n2", "gateway", "exclusive", json!({})),
                ("n3", "end-event", "none", json!({ "label": "big" })),
                ("n4", "end-event", "none", json!({ "label": "medium" })),
                ("n5", "end-event", "none", json!({ "label": "other" })),
            ],
            vec![
                ("e1", "n1", "n2", json!({})),
                ("e2", "n2", "n3", json!({ "condition": "conditional", "expression": "vars.total > 100" })),
                ("e3", "n2", "n4", json!({ "condition": "conditional", "expression": "vars.total > 10" })),
                ("e4", "n2", "n5", json!({ "condition": "default" })),
            ],
        );
        Instance::start(process, vars(vars_value), 0)
    };
    assert_eq!(nodes_in_trail(&build(json!({ "total": 500 }))).last().copied(), Some("n3"));
    assert_eq!(nodes_in_trail(&build(json!({ "total": 50 }))).last().copied(), Some("n4"));
    assert_eq!(nodes_in_trail(&build(json!({ "total": 1 }))).last().copied(), Some("n5"));
    for total in [500, 50, 1] {
        let instance = build(json!({ "total": total }));
        assert_eq!(instance.status, Status::Finished);
        assert_eq!(instance.trail.iter().filter(|id| id.starts_with('e')).count(), 2, "exactly one flow leaves the gateway");
    }
}

#[test]
fn a_flow_without_expression_is_open_and_the_default_flow_only_counts_last() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "exclusive", json!({})),
            ("n3", "end-event", "none", json!({})),
            ("n4", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({ "condition": "default" })), ("e3", "n2", "n4", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(nodes_in_trail(&instance).last().copied(), Some("n4"), "the open unconditional flow wins over the default");
}

#[test]
fn an_exclusive_gateway_without_open_flow_fails() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "exclusive", json!({ "label": "Choice" })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({ "condition": "conditional", "expression": "false" }))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Failed);
    assert!(instance.error.as_deref().unwrap().contains("Choice"));
}

#[test]
fn an_expression_error_fails_the_instance() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "gateway", "exclusive", json!({})), ("n3", "end-event", "none", json!({}))],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({ "condition": "conditional", "expression": "vars.total" }))],
    );
    let instance = Instance::start(process, vars(json!({ "total": 3 })), 0);
    assert_eq!(instance.status, Status::Failed);
    assert!(instance.error.as_deref().unwrap().contains("e2"));
}

#[test]
fn a_parallel_gateway_forks_and_its_join_waits_for_every_branch() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "task", "script", json!({ "script": "vars.a = true;" })),
            ("n4", "task", "user", json!({})),
            ("n5", "gateway", "parallel", json!({})),
            ("n6", "end-event", "none", json!({})),
        ],
        vec![
            ("e1", "n1", "n2", json!({})),
            ("e2", "n2", "n3", json!({})),
            ("e3", "n2", "n4", json!({})),
            ("e4", "n3", "n5", json!({})),
            ("e5", "n4", "n5", json!({})),
            ("e6", "n5", "n6", json!({})),
        ],
    );
    let mut instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting);
    assert_eq!(instance.vars, vars(json!({ "a": true })));
    let waits: Vec<(&str, &Wait)> = instance.tokens.iter().map(|token| (token.node.as_str(), token.wait.as_ref().unwrap())).collect();
    assert!(waits.contains(&("n5", &Wait::Join)), "the fast branch waits at the join: {waits:?}");
    assert!(waits.contains(&("n4", &Wait::UserTask)), "the slow branch waits at the user task: {waits:?}");
    let ids: Vec<u64> = instance.tokens.iter().map(|token| token.id).collect();
    assert_ne!(ids[0], ids[1], "every token has its own id");
    instance.complete_task("n4", None, 10).unwrap();
    assert_eq!(instance.status, Status::Finished);
    assert_eq!(nodes_in_trail(&instance).last().copied(), Some("n6"));
    assert_eq!(nodes_in_trail(&instance).iter().filter(|id| **id == "n6").count(), 1, "the join emits one token");
}

#[test]
fn a_task_with_several_outgoing_flows_forks_implicitly() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "task", "none", json!({})),
            ("n3", "end-event", "none", json!({})),
            ("n4", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({})), ("e3", "n2", "n4", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    let ends = nodes_in_trail(&instance);
    assert!(ends.contains(&"n3") && ends.contains(&"n4"));
}

#[test]
fn an_inclusive_gateway_opens_every_true_flow_and_joins_them() {
    let build = |vars_value: Value| {
        let process = process(
            vec![
                ("n1", "start-event", "none", json!({})),
                ("n2", "gateway", "inclusive", json!({})),
                ("n3", "task", "script", json!({ "script": r#"log("mail");"# })),
                ("n4", "task", "script", json!({ "script": r#"log("sms");"# })),
                ("n5", "task", "script", json!({ "script": r#"log("nothing");"# })),
                ("n6", "gateway", "inclusive", json!({})),
                ("n7", "end-event", "none", json!({})),
            ],
            vec![
                ("e1", "n1", "n2", json!({})),
                ("e2", "n2", "n3", json!({ "condition": "conditional", "expression": "vars.mail" })),
                ("e3", "n2", "n4", json!({ "condition": "conditional", "expression": "vars.sms" })),
                ("e4", "n2", "n5", json!({ "condition": "default" })),
                ("e5", "n3", "n6", json!({})),
                ("e6", "n4", "n6", json!({})),
                ("e7", "n5", "n6", json!({})),
                ("e8", "n6", "n7", json!({})),
            ],
        );
        Instance::start(process, vars(vars_value), 0)
    };
    let both = build(json!({ "mail": true, "sms": true }));
    assert_eq!(both.status, Status::Finished);
    let logged: Vec<&str> = messages(&both).into_iter().filter(|m| ["mail", "sms", "nothing"].contains(m)).collect();
    assert_eq!(logged, vec!["mail", "sms"]);
    assert_eq!(nodes_in_trail(&both).iter().filter(|id| **id == "n7").count(), 1, "the join merges the two branches");
    let none = build(json!({ "mail": false, "sms": false }));
    assert_eq!(none.status, Status::Finished);
    assert!(messages(&none).contains(&"nothing"), "the default flow is taken when nothing else is open");
}

#[test]
fn a_timer_event_waits_until_its_delay_has_passed() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "intermediate-event", "timer", json!({ "delay": 500 })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let mut instance = Instance::start(process, Vars::new(), 1_000);
    assert_eq!(instance.status, Status::Waiting);
    assert_eq!(instance.tokens[0].wait, Some(Wait::Timer { due: 1_500 }));
    assert_eq!(instance.next_due(), Some(1_500));
    instance.tick(1_400);
    assert_eq!(instance.status, Status::Waiting, "not due yet");
    instance.tick(1_500);
    assert_eq!(instance.status, Status::Finished);
    assert_eq!(instance.finished_at, Some(1_500));
    assert_eq!(instance.next_due(), None);
}

#[test]
fn a_timer_start_event_delays_the_whole_start() {
    let process = process(
        vec![("n1", "start-event", "timer", json!({ "delay": 100 })), ("n2", "end-event", "none", json!({}))],
        vec![("e1", "n1", "n2", json!({}))],
    );
    let mut instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting);
    instance.tick(100);
    assert_eq!(instance.status, Status::Finished);
}

#[test]
fn a_message_event_waits_for_its_name_and_ignores_other_names() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "intermediate-event", "message", json!({ "message": "paid" })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let mut instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting);
    assert_eq!(instance.tokens[0].wait, Some(Wait::Message { name: "paid".into() }));
    assert!(instance.send_message("shipped", 1).is_err());
    assert_eq!(instance.status, Status::Waiting);
    instance.send_message("paid", 2).unwrap();
    assert_eq!(instance.status, Status::Finished);
    assert!(messages(&instance).contains(&"received paid"));
}

#[test]
fn a_message_start_event_waits_before_anything_runs() {
    let process = process(
        vec![
            ("n1", "start-event", "message", json!({ "message": "go" })),
            ("n2", "task", "script", json!({ "script": "vars.ran = true;" })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let mut instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting);
    assert!(instance.vars.is_empty());
    instance.send_message("go", 5).unwrap();
    assert_eq!(instance.vars, vars(json!({ "ran": true })));
    assert_eq!(instance.status, Status::Finished);
}

#[test]
fn a_user_task_waits_and_its_completion_can_patch_the_variables() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "task", "user", json!({ "script": "vars.ran = true;" })),
            ("n3", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let mut instance = Instance::start(process, vars(json!({ "a": 1 })), 0);
    assert_eq!(instance.status, Status::Waiting);
    assert_eq!(instance.tokens[0].wait, Some(Wait::UserTask));
    assert!(instance.complete_task("n3", None, 1).is_err(), "nothing waits at n3");
    instance.complete_task("n2", Some(vars(json!({ "b": 2 }))), 3).unwrap();
    assert_eq!(instance.status, Status::Finished);
    assert_eq!(instance.vars, vars(json!({ "a": 1, "b": 2, "ran": true })), "the script of a user task runs after completion");
    assert!(instance.complete_task("n2", None, 4).is_err(), "a finished instance accepts nothing");
}

#[test]
fn a_terminate_end_event_consumes_every_token_at_once() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "end-event", "terminate", json!({ "label": "Abort" })),
            ("n4", "task", "user", json!({})),
            ("n5", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({})), ("e3", "n2", "n4", json!({})), ("e4", "n4", "n5", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    assert!(instance.tokens.is_empty(), "the user task token was consumed by terminate");
    assert!(messages(&instance).iter().any(|m| m.contains("terminated") && m.contains("Abort")));
}

#[test]
fn a_message_end_event_logs_the_message_it_sends() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "end-event", "message", json!({ "message": "rejected" }))],
        vec![("e1", "n1", "n2", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    assert!(messages(&instance).contains(&"sent rejected"));
}

#[test]
fn only_sequence_flows_are_followed() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "task", "script", json!({ "script": "vars.wrong = true;" })),
            ("n3", "annotation", "none", json!({})),
            ("n4", "end-event", "none", json!({})),
        ],
        vec![
            ("e1", "n1", "n2", json!({ "kind": "message" })),
            ("e2", "n1", "n3", json!({ "kind": "association" })),
            ("e3", "n1", "n4", json!({})),
        ],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    assert!(instance.vars.is_empty(), "the message flow was not followed");
    assert_eq!(nodes_in_trail(&instance), vec!["n1", "n4"]);
}

#[test]
fn a_token_reaching_an_artifact_is_dropped_with_a_warning() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "data-object", "none", json!({ "label": "Order" }))],
        vec![("e1", "n1", "n2", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    let warning = instance.log.iter().find(|entry| entry.level == Level::Warn).expect("a warning");
    assert!(warning.message.contains("Order"));
    assert!(warning.message.contains("data object"), "{}", warning.message);
    assert_eq!(warning.node.as_deref(), Some("n2"));
}

#[test]
fn every_start_event_gets_a_token() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "start-event", "none", json!({})),
            ("n3", "task", "script", json!({ "script": "vars.count = (vars.count ?? 0) + 1;" })),
            ("n4", "end-event", "none", json!({})),
        ],
        vec![("e1", "n1", "n3", json!({})), ("e2", "n2", "n3", json!({})), ("e3", "n3", "n4", json!({}))],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    assert_eq!(instance.vars, vars(json!({ "count": 2 })));
}

#[test]
fn a_path_that_ends_at_a_task_without_outgoing_flow_just_finishes() {
    let process =
        process(vec![("n1", "start-event", "none", json!({})), ("n2", "task", "none", json!({}))], vec![("e1", "n1", "n2", json!({}))]);
    assert_eq!(Instance::start(process, Vars::new(), 0).status, Status::Finished);
}

#[test]
fn stopping_a_waiting_instance_ends_it_and_refuses_further_input() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "task", "user", json!({})), ("n3", "end-event", "none", json!({}))],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let mut instance = Instance::start(process, Vars::new(), 0);
    instance.stop(9);
    assert_eq!(instance.status, Status::Stopped);
    assert_eq!(instance.finished_at, Some(9));
    assert!(instance.complete_task("n2", None, 10).is_err());
    assert!(instance.send_message("x", 10).is_err());
    instance.tick(10_000);
    assert_eq!(instance.status, Status::Stopped);
    assert!(messages(&instance).contains(&"stopped"));
}

#[test]
fn the_snapshot_exposes_the_state_with_camel_case_names() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "task", "user", json!({})), ("n3", "end-event", "none", json!({}))],
        vec![("e1", "n1", "n2", json!({})), ("e2", "n2", "n3", json!({}))],
    );
    let instance = Instance::start(process, vars(json!({ "k": "v" })), 42);
    let snapshot = instance.snapshot();
    assert_eq!(snapshot["status"], "waiting");
    assert_eq!(snapshot["startedAt"], 42);
    assert_eq!(snapshot["vars"], json!({ "k": "v" }));
    assert_eq!(snapshot["tokens"][0]["node"], "n2");
    assert_eq!(snapshot["tokens"][0]["wait"], json!({ "kind": "user-task" }));
    assert_eq!(snapshot["tokens"][0]["arrivedVia"], "e1");
    assert_eq!(snapshot["trail"], json!(["n1", "e1", "n2"]));
    assert!(snapshot.get("finishedAt").is_none());
    assert!(snapshot.get("process").is_none(), "the document is not part of the state");
}

#[test]
fn documents_are_validated_before_they_can_run() {
    let doc = |nodes: Value, edges: Value| -> Result<Process, DocumentError> {
        let document: Document = serde_json::from_value(json!({ "nodes": nodes, "edges": edges })).unwrap();
        Process::new(document)
    };
    let start = json!({ "id": "n1", "type": "start-event", "variant": "none" });
    assert_eq!(doc(json!([]), json!([])).unwrap_err(), DocumentError::NoStartEvent);
    assert_eq!(doc(json!([start, { "id": "n1", "type": "task" }]), json!([])).unwrap_err(), DocumentError::DuplicateNodeId("n1".into()));
    assert_eq!(
        doc(json!([start, { "id": "n2", "type": "task", "variant": "timer" }]), json!([])).unwrap_err(),
        DocumentError::UnknownVariant { node: "n2".into(), variant: "timer".into() }
    );
    assert_eq!(
        doc(json!([start]), json!([{ "id": "e1", "source": "n1", "target": "zzz" }])).unwrap_err(),
        DocumentError::MissingNode { edge: "e1".into(), node: "zzz".into() }
    );
    assert_eq!(
        doc(json!([start]), json!([{ "id": "e1", "source": "n1", "target": "n1" }])).unwrap_err(),
        DocumentError::SelfLoop("e1".into())
    );
    assert_eq!(
        doc(json!([start]), json!([{ "id": "e1", "source": "n1", "target": "n1" }, { "id": "e1", "source": "n1", "target": "n1" }]))
            .unwrap_err(),
        DocumentError::SelfLoop("e1".into()),
        "the first problem found is reported"
    );
    assert_eq!(
        doc(json!([start, { "id": "n2", "type": "start-event", "variant": "timer", "delay": -1 }]), json!([])).unwrap_err(),
        DocumentError::NegativeDelay("n2".into())
    );
    let unknown_type: Result<Document, _> = serde_json::from_value(json!({ "nodes": [{ "id": "n1", "type": "hexagon" }], "edges": [] }));
    assert!(unknown_type.unwrap_err().to_string().contains("hexagon"));
}

#[test]
fn documents_keep_the_optional_execution_fields_and_default_the_rest() {
    let document: Document = serde_json::from_value(json!({
        "nodes": [
            { "id": "n1", "type": "start-event", "variant": "timer", "delay": 250 },
            { "id": "n2", "type": "task", "variant": "user", "script": "log(1);", "x": 3, "y": 4 }
        ],
        "edges": [{ "id": "e1", "source": "n1", "target": "n2", "expression": "true" }]
    }))
    .unwrap();
    assert!(document.directed);
    assert_eq!(document.edge_style, "orthogonal");
    assert_eq!(document.nodes[0].delay, Some(250.0));
    assert_eq!(document.nodes[0].label, "");
    assert_eq!(document.nodes[1].variant, "user");
    let bare: Document = serde_json::from_value(json!({ "nodes": [{ "id": "n1", "type": "task" }], "edges": [] })).unwrap();
    assert_eq!(bare.nodes[0].variant, "none", "a node without variant has the plain variant");
    assert_eq!(document.nodes[1].script.as_deref(), Some("log(1);"));
    assert_eq!(document.edges[0].expression.as_deref(), Some("true"));
    assert_eq!(document.edges[0].kind, engine::EdgeKind::Sequence);
    assert_eq!(document.edges[0].condition, engine::FlowCondition::None);
    let text = serde_json::to_string(&document).unwrap();
    assert!(!text.contains("\"message\""), "absent fields are not written back");
}

#[test]
fn a_process_indexes_its_sequence_flows_in_document_order() {
    let process = process(
        vec![("n1", "start-event", "none", json!({})), ("n2", "task", "none", json!({})), ("n3", "task", "none", json!({}))],
        vec![
            ("e1", "n1", "n3", json!({})),
            ("e2", "n1", "n2", json!({ "kind": "message" })),
            ("e3", "n1", "n2", json!({})),
            ("e4", "n2", "n3", json!({})),
        ],
    );
    let ids: Vec<&str> = process.outgoing("n1").iter().map(|edge| edge.id.as_str()).collect();
    assert_eq!(ids, vec!["e1", "e3"]);
    assert_eq!(process.incoming_count("n3"), 2);
    assert_eq!(process.incoming_count("n2"), 1);
    assert_eq!(process.incoming_count("n1"), 0);
    assert!(process.is_join("n3"), "two incoming sequence flows merge paths");
    assert!(!process.is_join("n2"));
    assert!(!process.is_join("n1"));
    assert_eq!(process.edge("e4").map(|edge| edge.target.as_str()), Some("n3"));
    assert!(process.edge("zzz").is_none());
    assert_eq!(process.node("n2").map(|node| node.id.as_str()), Some("n2"));
    assert!(process.node("zzz").is_none());
    assert_eq!(process.start_events().len(), 1);
    let _ = Map::<String, Value>::new();
}

#[test]
fn a_parallel_join_keeps_waiting_when_a_branch_died_elsewhere() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "end-event", "none", json!({})),
            ("n4", "task", "none", json!({})),
            ("n5", "gateway", "parallel", json!({})),
            ("n6", "end-event", "none", json!({})),
        ],
        vec![
            ("e1", "n1", "n2", json!({})),
            ("e2", "n2", "n3", json!({})),
            ("e3", "n2", "n4", json!({})),
            ("e4", "n4", "n5", json!({})),
            ("e5", "n3", "n5", json!({})),
            ("e6", "n5", "n6", json!({})),
        ],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting, "one incoming flow never delivers: {:?}", instance.tokens);
    let joined = instance.tokens.iter().filter(|token| token.node == "n5" && token.wait == Some(Wait::Join)).count();
    assert!(joined >= 1);
    assert!(instance.tokens.iter().all(|token| token.node == "n5"), "only join tokens remain: {:?}", instance.tokens);
}

#[test]
fn a_join_leaves_tokens_on_other_branches_alone() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "task", "none", json!({})),
            ("n4", "task", "none", json!({})),
            ("n5", "task", "user", json!({ "label": "Elsewhere" })),
            ("n6", "gateway", "parallel", json!({})),
            ("n7", "task", "user", json!({ "label": "After join" })),
        ],
        vec![
            ("e1", "n1", "n2", json!({})),
            ("e2", "n2", "n3", json!({})),
            ("e3", "n2", "n4", json!({})),
            ("e4", "n2", "n5", json!({})),
            ("e5", "n3", "n6", json!({})),
            ("e6", "n4", "n6", json!({})),
            ("e7", "n6", "n7", json!({})),
        ],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting);
    let mut waiting: Vec<&str> = instance.tokens.iter().map(|token| token.node.as_str()).collect();
    waiting.sort_unstable();
    assert_eq!(waiting, vec!["n5", "n7"], "the join fired once and the third branch still waits: {:?}", instance.tokens);
    let ids: Vec<u64> = instance.tokens.iter().map(|token| token.id).collect();
    assert_ne!(ids[0], ids[1]);
}

#[test]
fn a_join_hands_out_a_fresh_token_id() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "task", "none", json!({})),
            ("n4", "task", "user", json!({})),
            ("n5", "gateway", "parallel", json!({})),
            ("n6", "task", "user", json!({})),
        ],
        vec![
            ("e1", "n1", "n2", json!({})),
            ("e2", "n2", "n3", json!({})),
            ("e3", "n2", "n4", json!({})),
            ("e4", "n3", "n5", json!({})),
            ("e5", "n4", "n5", json!({})),
            ("e6", "n5", "n6", json!({})),
        ],
    );
    let mut instance = Instance::start(process, Vars::new(), 0);
    let seen: Vec<u64> = instance.tokens.iter().map(|token| token.id).collect();
    instance.complete_task("n4", None, 1).unwrap();
    assert_eq!(instance.status, Status::Waiting);
    assert_eq!(instance.tokens.len(), 1);
    assert_eq!(instance.tokens[0].node, "n6");
    let fresh = instance.tokens[0].id;
    assert!(seen.iter().all(|&id| fresh > id), "the token after the join ({fresh}) reuses an id from {seen:?}");
}

#[test]
fn an_exclusive_gateway_with_several_incoming_flows_merges_without_waiting() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "task", "user", json!({})),
            ("n4", "gateway", "exclusive", json!({})),
            ("n5", "end-event", "none", json!({})),
        ],
        vec![
            ("e1", "n1", "n2", json!({})),
            ("e2", "n2", "n3", json!({})),
            ("e3", "n2", "n4", json!({})),
            ("e4", "n3", "n4", json!({})),
            ("e5", "n4", "n5", json!({})),
        ],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Waiting);
    assert!(nodes_in_trail(&instance).contains(&"n5"), "the first token passed the merge: {:?}", instance.trail);
    assert_eq!(instance.tokens.len(), 1);
    assert_eq!(instance.tokens[0].wait, Some(Wait::UserTask));
}

#[test]
fn a_parallel_gateway_ignores_expressions_and_default_marks() {
    let process = process(
        vec![
            ("n1", "start-event", "none", json!({})),
            ("n2", "gateway", "parallel", json!({})),
            ("n3", "end-event", "none", json!({})),
            ("n4", "end-event", "none", json!({})),
            ("n5", "end-event", "none", json!({})),
        ],
        vec![
            ("e1", "n1", "n2", json!({})),
            ("e2", "n2", "n3", json!({ "condition": "conditional", "expression": "false" })),
            ("e3", "n2", "n4", json!({ "condition": "default" })),
            ("e4", "n2", "n5", json!({})),
        ],
    );
    let instance = Instance::start(process, Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished);
    let ends = nodes_in_trail(&instance);
    assert!(ends.contains(&"n3") && ends.contains(&"n4") && ends.contains(&"n5"), "{ends:?}");
}

fn chain(length: usize, closed: bool) -> Arc<Process> {
    let node = |id: String, kind: NodeType| Node {
        id: id.clone(),
        label: id,
        kind,
        variant: "none".into(),
        x: 0.0,
        y: 0.0,
        script: None,
        delay: None,
        message: None,
    };
    let edge = |id: String, source: String, target: String| Edge {
        id,
        source,
        target,
        label: String::new(),
        kind: EdgeKind::Sequence,
        condition: FlowCondition::None,
        source_side: None,
        target_side: None,
        expression: None,
    };
    let mut nodes = vec![node("n1".into(), NodeType::StartEvent)];
    let mut edges = Vec::new();
    for i in 2..=length {
        nodes.push(node(format!("n{i}"), NodeType::Task));
        edges.push(edge(format!("e{i}"), format!("n{}", i - 1), format!("n{i}")));
    }
    if closed {
        edges.push(edge("back".into(), format!("n{length}"), "n2".into()));
    }
    Arc::new(Process::new(Document { directed: true, edge_style: "orthogonal".into(), nodes, edges }).unwrap())
}

#[test]
fn a_cycle_without_exit_fails_instead_of_running_forever() {
    let instance = Instance::start(chain(3, true), Vars::new(), 0);
    assert_eq!(instance.status, Status::Failed);
    assert!(instance.error.as_deref().unwrap().contains("did not settle"), "{:?}", instance.error);
    assert!(instance.tokens.len() <= 1);
}

/// The limit must leave room for real processes.
const _: () = assert!(MAX_STEPS >= 10_000);

#[test]
fn a_run_may_take_exactly_the_step_limit() {
    let instance = Instance::start(chain(MAX_STEPS as usize, false), Vars::new(), 0);
    assert_eq!(instance.status, Status::Finished, "{:?}", instance.error);
}

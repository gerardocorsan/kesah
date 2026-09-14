//! Rhai scripting for tasks and gateway expressions.
//!
//! Scripts see the process variables as a mutable map called `vars` and can
//! write to the instance log with `log(value)`. Every evaluation runs in a
//! fresh engine with operation, depth and size limits, so a runaway script
//! fails instead of hanging the process.

use rhai::{Dynamic, Engine, Scope};
use serde_json::{Map, Value};
use std::cell::RefCell;
use std::rc::Rc;

/// What a script produced: the variables afterwards and the lines it logged.
#[derive(Debug, Clone, PartialEq)]
pub struct ScriptOutcome {
    pub vars: Map<String, Value>,
    pub logs: Vec<String>,
}

const MAX_OPERATIONS: u64 = 100_000;
const MAX_DEPTH: usize = 64;
const MAX_CALL_LEVELS: usize = 32;
const MAX_SIZE: usize = 10_000;

fn engine(logs: Rc<RefCell<Vec<String>>>) -> Engine {
    let mut engine = Engine::new();
    engine.set_max_operations(MAX_OPERATIONS);
    engine.set_max_expr_depths(MAX_DEPTH, MAX_DEPTH);
    engine.set_max_call_levels(MAX_CALL_LEVELS);
    engine.set_max_string_size(MAX_SIZE);
    engine.set_max_array_size(MAX_SIZE);
    engine.set_max_map_size(MAX_SIZE);
    engine.register_fn("log", move |value: Dynamic| {
        logs.borrow_mut().push(value.to_string());
    });
    engine
}

fn scope_with_vars(vars: &Map<String, Value>) -> Result<Scope<'static>, String> {
    let dynamic = rhai::serde::to_dynamic(Value::Object(vars.clone())).map_err(|e| e.to_string())?;
    let mut scope = Scope::new();
    scope.push("vars", dynamic);
    Ok(scope)
}

fn vars_from_scope(scope: &Scope<'_>) -> Result<Map<String, Value>, String> {
    let value = scope.get_value::<Dynamic>("vars").ok_or("vars was removed from the scope")?;
    match rhai::serde::from_dynamic::<Value>(&value).map_err(|e| e.to_string())? {
        Value::Object(map) => Ok(map),
        other => Err(format!("vars must remain an object, got {other}")),
    }
}

/// Runs a task script. On success the returned variables replace the instance's.
pub fn run_script(script: &str, vars: &Map<String, Value>) -> Result<ScriptOutcome, String> {
    let logs = Rc::new(RefCell::new(Vec::new()));
    let engine = engine(logs.clone());
    let mut scope = scope_with_vars(vars)?;
    engine.run_with_scope(&mut scope, script).map_err(|e| e.to_string())?;
    let vars = vars_from_scope(&scope)?;
    let logs = logs.take();
    Ok(ScriptOutcome { vars, logs })
}

/// Evaluates a gateway expression, which must yield a boolean.
pub fn eval_expression(expression: &str, vars: &Map<String, Value>) -> Result<bool, String> {
    let engine = engine(Rc::new(RefCell::new(Vec::new())));
    let mut scope = scope_with_vars(vars)?;
    let value = engine.eval_expression_with_scope::<Dynamic>(&mut scope, expression).map_err(|e| e.to_string())?;
    value.as_bool().map_err(|actual| format!("expression must yield a boolean, got {actual}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vars(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => panic!("object expected"),
        }
    }

    #[test]
    fn a_script_reads_and_writes_the_process_variables() {
        let outcome = run_script("vars.total = vars.price * vars.qty; vars.paid = false;", &vars(json!({ "price": 3, "qty": 4 }))).unwrap();
        assert_eq!(outcome.vars, vars(json!({ "price": 3, "qty": 4, "total": 12, "paid": false })));
        assert!(outcome.logs.is_empty());
    }

    #[test]
    fn log_collects_lines_in_order_and_accepts_any_value() {
        let outcome = run_script(r#"log("hello"); log(42); log(vars.name);"#, &vars(json!({ "name": "Ada" }))).unwrap();
        assert_eq!(outcome.logs, vec!["hello", "42", "Ada"]);
    }

    #[test]
    fn a_script_error_is_reported_with_its_message() {
        let error = run_script("vars.total = undefined_thing + 1;", &vars(json!({}))).unwrap_err();
        assert!(error.contains("undefined_thing"), "{error}");
    }

    #[test]
    fn a_runaway_script_fails_instead_of_hanging() {
        let error = run_script("loop { }", &vars(json!({}))).unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn vars_must_stay_an_object() {
        let error = run_script("vars = 5;", &vars(json!({ "a": 1 }))).unwrap_err();
        assert!(error.contains("object"), "{error}");
    }

    #[test]
    fn expressions_yield_booleans_over_the_variables() {
        let context = vars(json!({ "total": 150, "stock": true, "name": "x" }));
        assert!(eval_expression("vars.total > 100", &context).unwrap());
        assert!(!eval_expression("vars.total > 200", &context).unwrap());
        assert!(eval_expression("vars.stock", &context).unwrap());
        assert!(eval_expression(r#"vars.name == "x" && vars.total >= 150"#, &context).unwrap());
    }

    #[test]
    fn a_non_boolean_expression_is_an_error() {
        let error = eval_expression("vars.total", &vars(json!({ "total": 5 }))).unwrap_err();
        assert!(error.contains("boolean"), "{error}");
    }

    #[test]
    fn an_expression_that_does_not_parse_is_an_error() {
        assert!(eval_expression("vars.total >", &vars(json!({ "total": 5 }))).is_err());
    }
}

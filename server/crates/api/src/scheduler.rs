//! Wakes instances whose timers are due and publishes the resulting states.

use crate::console;
use crate::now_millis;
use crate::store::AppState;
use std::time::Duration;

const INTERVAL: Duration = Duration::from_millis(100);

/// Runs every 100 ms for the life of the process.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(INTERVAL);
        loop {
            interval.tick().await;
            for (id, snapshot) in tick_due(&state, now_millis()) {
                state.publish(&id, snapshot);
            }
        }
    });
}

/// Ticks every instance with a due timer and returns the states that changed.
pub fn tick_due(state: &AppState, now: u64) -> Vec<(String, serde_json::Value)> {
    let mut store = state.store.lock().expect("store lock");
    let mut changed = Vec::new();
    for running in store.instances.values_mut() {
        if running.instance.next_due().is_some_and(|due| due <= now) {
            running.instance.tick(now);
            running.updated_at = now;
            console::print(&running.drain_report(Some("timer fired".to_string())));
            changed.push((running.id.clone(), running.state()));
        }
    }
    changed
}

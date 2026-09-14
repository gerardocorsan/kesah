//! HTTP API that keeps deployed documents and running instances in memory,
//! drives their timers, and streams state changes to the web application.

pub mod console;
pub mod routes;
pub mod scheduler;
pub mod store;

pub use routes::router;
pub use store::AppState;

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch, the clock every instance is driven with.
pub fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

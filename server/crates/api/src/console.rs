//! Lines written to the server's standard output: what the engine did, step by step.
//!
//! Every line is `HH:MM:SS.mmm <id> <text>` with the time in UTC. `Running::drain_report`
//! produces the lines an instance has not reported yet; `print` writes them.

use crate::store::Running;
use engine::{Level, LogEntry, Status, Wait};

/// Formats milliseconds since the epoch as a UTC time of day.
pub fn clock(now: u64) -> String {
    let seconds = now / 1000;
    format!("{:02}:{:02}:{:02}.{:03}", seconds / 3600 % 24, seconds / 60 % 60, seconds % 60, now % 1000)
}

pub fn print(lines: &[String]) {
    for line in lines {
        println!("{line}");
    }
}

impl Running {
    /// The steps taken since the last report, oldest first: an optional line for the action that
    /// caused them, every node entered (with the log entries it produced) and left, the remaining
    /// log entries, and what the instance is waiting for when it waits. A step is never reported twice.
    pub fn drain_report(&mut self, action: Option<String>) -> Vec<String> {
        let prefix = format!("{} {}", clock(self.updated_at), self.id);
        let mut lines = Vec::new();
        if let Some(action) = action {
            lines.push(format!("{prefix} {action}"));
        }
        let process = self.instance.process();
        let mut pending: Vec<Option<&LogEntry>> = self.instance.log[self.reported_log..].iter().map(Some).collect();
        let entry_line = |entry: &LogEntry| {
            let level = match entry.level {
                Level::Info => "",
                Level::Warn => "warning: ",
                Level::Error => "error: ",
            };
            let node = entry.node.as_deref().map(|id| format!("[{id}] ")).unwrap_or_default();
            format!("{prefix}   {node}{level}{}", entry.message)
        };
        for id in &self.instance.trail[self.reported_trail..] {
            let Some(node) = process.node(id) else {
                if let Some(edge) = process.edge(id) {
                    let left = process.node(&edge.source).map(|node| node.name()).unwrap_or_default();
                    lines.push(format!("{prefix}   leave {} \"{left}\" via {}", edge.source, edge.id));
                }
                continue;
            };
            lines.push(format!("{prefix}   enter {} \"{}\" ({}{})", node.id, node.name(), node.kind, variant_suffix(&node.variant)));
            for slot in pending.iter_mut() {
                if let Some(entry) = slot
                    && entry.node.as_deref() == Some(id)
                {
                    lines.push(entry_line(entry));
                    *slot = None;
                }
            }
        }
        lines.extend(pending.into_iter().flatten().map(entry_line));
        self.reported_trail = self.instance.trail.len();
        self.reported_log = self.instance.log.len();
        if self.instance.status == Status::Waiting {
            for token in &self.instance.tokens {
                let name = process.node(&token.node).map(|node| node.name().to_string()).unwrap_or_default();
                let what = match &token.wait {
                    Some(Wait::Timer { due }) => format!("timer due at {}", clock(*due)),
                    Some(Wait::Message { name }) => format!("message \"{name}\""),
                    Some(Wait::UserTask) => "user task".to_string(),
                    Some(Wait::Join) => "join".to_string(),
                    None => "nothing".to_string(),
                };
                lines.push(format!("{prefix}   waiting at {} \"{name}\" for {what}", token.node));
            }
        }
        lines
    }
}

fn variant_suffix(variant: &str) -> String {
    if variant == "none" { String::new() } else { format!(", {variant}") }
}

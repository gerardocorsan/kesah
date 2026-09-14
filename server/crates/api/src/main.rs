use api::{AppState, router, scheduler};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("KESAH_PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(8080);
    let state = AppState::new();
    scheduler::spawn(state.clone());
    let listener = TcpListener::bind(("0.0.0.0", port)).await.unwrap_or_else(|error| panic!("cannot listen on port {port}: {error}"));
    println!("Kesah API listening on http://localhost:{port}");
    axum::serve(listener, router(state)).await.expect("the server stopped unexpectedly");
}

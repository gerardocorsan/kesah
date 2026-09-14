# Working rules for Kesah

Guidance for AI assistants and new contributors. It states the rules the project follows; the
reasons behind the design are in [docs/architecture.md](docs/architecture.md), and usage is in
the [README](README.md).

## Layout

- `app/`: the web application (Vite, SolidJS, Vitest). Every npm command runs from there.
- `server/`: the Rust backend, a Cargo workspace with the `engine` crate (pure interpreter) and the
  `api` crate (axum binary). Every cargo command runs from there.
- `docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `build` and `start` stay at the root.
- The JSON document (`Graph.toJSON()`) is the contract between the two halves. A new field is added on
  both sides in the same change: the model and inspector in `app/`, the serde types in
  `server/crates/engine/src/document.rs`, and the README's JSON section.

## Language

- Everything in the repository is in English: code, comments, UI strings, documentation and commit
  messages. Conversations with the maintainer may be in Spanish; artefacts never are.

## Git

- Work happens on the feature branch the maintainer is on (check `git branch`); do not assume
  `develop` or `main`.
- Commit only when asked. Messages in English, imperative subject, a short body saying what and why.
- Never add tool attribution, co-author trailers or session links to commits or pull requests.
- Never run `git push`, not even `--dry-run`: the remote uses SSH and any push variant triggers the
  maintainer's key dialog. The maintainer pushes.

## Design constraints

- Runtime dependencies: SolidJS only. Add nothing else without an explicit decision by the maintainer.
- `app/src/model/` never imports from `solid-js` or touches the DOM. Measurements are passed in as numbers.
- Components follow atomic design levels (`atoms`, `molecules`, `organisms`, `templates`) and keep
  their stylesheet next to them. Atoms know nothing about the application state.
- The JSON document format stays backwards compatible: a new field needs a default for old files in
  `Graph.parse` and a line in the README's JSON section.
- The DOM contract listed in `docs/architecture.md` (ids, classes, `data-*`) is public API for the
  tests; renaming any of it is a breaking change.
- No comma expressions inside JSX braces; the Vite dependency scanner rejects them.
- Server crates: axum, tokio, tokio-stream, serde, serde_json and rhai only (tower and
  http-body-util as dev-dependencies). Add nothing else without an explicit decision by the maintainer.
- The `engine` crate does no I/O and never reads a clock: time arrives as a `u64` in milliseconds.
  Anything that needs a socket, a timer or the wall clock belongs in `api`.
- The API answers 400 for a document it cannot run, 404 for unknown ids and 409 for an action the
  instance cannot take now; every success returns the full instance state.

## Tests

- Expectations come from the documented behaviour (README, `docs/architecture.md`, agreed rules),
  not from reading the implementation. Undocumented constants are asserted as properties.
- Test public behaviour; never internals. No tautologies, no assertions on mock calls instead of
  results, no snapshots without real assertions.
- Mock only real external dependencies (browser dialogs, object URLs, timers). jsdom stand-ins live in
  `app/src/test/setup.ts`. Never mock the unit under test.
- Every unit has an entry in `app/scripts/verify-tests.mjs`; a mutation that survives means the test is
  rewritten, not the mutation removed.
- Loops in tests must be bounded so a broken implementation cannot hang the run.
- Suspicious behaviour found while testing is reported to the maintainer, not encoded in a test.
- Rust: engine semantics are tested as scenarios in `server/crates/engine/tests/semantics.rs`
  (one per documented rule), the API in `server/crates/api/tests/api.rs` through
  `tower::ServiceExt::oneshot`, never over a real socket. `cargo mutants -p engine` must report no
  missed mutants; a survivor gets a test, and an equivalent mutant is removed by restructuring the code.
- `scripts/verify-tests.mjs` rewrites source files while it runs: never build, test or run the
  app at the same time.

## Definition of done

Before calling a change finished, all of these pass:

```bash
cd app
npx tsc --noEmit
npm test                          # coverage threshold 85 % on every metric
npm run build && npm run test:e2e # needs Chrome (CHROME_BIN)
node scripts/verify-tests.mjs     # when a unit was added or changed

cd server
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo mutants -p engine           # when the engine changed
```

Then update the README (controls, JSON, structure) and `docs/architecture.md` if a decision or an
invariant changed. Report what was verified and what was not.

## Local conventions

- `./build` at the root builds both halves for production; `./start` runs the API on port 8080 and
  the dev server on port 5173. Do not leave your own servers running on either port; `KESAH_PORT`
  gives a throwaway API instance another port.
- Temporary files go under `tmp/` (ignored), never in `app/src/`.

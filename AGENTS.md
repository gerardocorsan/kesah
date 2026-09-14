# Working rules for Kesah

Guidance for AI assistants and new contributors. It states the rules the project follows; the
reasons behind the design are in [docs/architecture.md](docs/architecture.md), and usage is in
the [README](README.md).

## Layout

- `app/`: the web application (Vite, SolidJS, Vitest). Every npm command runs from there.
- `server/`: the Rust backend (Cargo workspace), once the execution work starts.
- `docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md` and `start` stay at the root.

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

## Definition of done

Before calling a change finished, all of these pass:

```bash
cd app
npx tsc --noEmit
npm test                          # coverage threshold 85 % on every metric
npm run build && npm run test:e2e # needs Chrome (CHROME_BIN)
node scripts/verify-tests.mjs     # when a unit was added or changed
```

Then update the README (controls, JSON, structure) and `docs/architecture.md` if a decision or an
invariant changed. Report what was verified and what was not.

## Local conventions

- `./start` at the root runs the dev server on port 5173; do not leave your own dev servers running on it.
- Temporary files go under `tmp/` (ignored), never in `app/src/`.

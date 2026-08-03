# Changelog

## Unreleased

First working shape. Not published.

- Fifteen rules as pure functions over a snapshot, with a mutation guard that kills every
  mutant on a fixture that actually triggers the rule.
- Six output formats, each carrying every mandatory counter — including on a clean run.
- Exit precedence with a 27-row matrix asserting exit code, verdict and gate reason together.
- `npx breaklint --demo` runs the real rule and reporter chain over a stored snapshot.
- The live render path resolves the browser and the Paged.js version gate, then stops with
  exit 3 rather than returning an empty document. See `docs/status.md`.

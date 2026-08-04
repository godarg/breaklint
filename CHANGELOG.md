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
- The evidence path: `pdfjs-dist` rasterises the produced PDF on a second page of the same
  browser instance, served over a loopback origin so that no browser-wide file-access switch is
  needed. Invisible marks are placed after pagination, and the binding is decided by comparing
  the marked PDF against a baseline PDF taken BEFORE the overlay existed. Verified against real
  Chrome, real Paged.js and poppler as an independent rasteriser; `npm run test:live` fails
  rather than skips when any of them is missing.
- Not every infrastructure event ends a run. `mark-style-overridden` and `mark-raster-diff` mean
  the evidence was lost, not that the document could not be measured; `render-unstable` from a
  page whose own marks all miss does end it.

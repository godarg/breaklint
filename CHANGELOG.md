# Changelog

## Unreleased

### Real-corpus validation infrastructure

- Added a public, rights- and privacy-reviewed process-pilot corpus with immutable document and
  rule-target hashes, origin-strict development/tuning/holdout assignments, a blind annotation
  packet, a holdout freeze projection and deterministic verification reports.
- Added fail-closed contracts and checks for source intake, human identity separation,
  multi-valued annotation and adjudication, split leakage, external freeze receipts and
  GitHub-OIDC/Sigstore-backed attestation verification. Local fixtures and caller-supplied trust
  material cannot create claim readiness.
- Added a machine-readable bridge to the existing M3-0 readiness vocabulary. It records the
  verified intake and split facts while keeping every calibration, capture and claim gate false
  until the missing renderer, oracle, human annotation, external receipt and acceptance evidence
  actually exist.
- This infrastructure changes no runtime rule, threshold, severity, package version or published
  surface. All fifteen rules remain `calibrated: false`; no calibration claim is authorized.

### Open community QA intake

- Added an open, unpaid community-testing guide and structured GitHub intake for public or
  disposable reproductions. No application or tester selection is required.
- Added a data-only intake classifier and dashboard workflow. Submitted content is never executed;
  reports with missing declarations or sensitive-data patterns fail closed into explicit labels.
- Community reports remain non-blind product QA. They are not human calibration annotations,
  external holdout receipts, trust roots or authority to change thresholds, version or release.

## 0.2.0 — 2026-08-22

### Configuration Contract v1

- Configuration is now fail-closed: unknown top-level fields, profiles, rules and rule options,
  invalid types or ranges, proof-source-A overrides and lowered coverage floors end with exit 2
  before any input document is opened.
- `default` and `strict` are real profiles. Resolution is defaults < profile < config < CLI;
  `strict` gates warnings and requires full coverage for every active rule. A later
  `--profile default` cannot weaken a strict config-file floor.
- Coverage floors may be raised or kept equal, never lowered. The same resolved floor is passed to
  the engine and recorded in the report.
- Canonical JSON reports use schema 3 and carry Configuration Contract version 1, every effective
  value, provenance for every leaf and a deterministic SHA-256 fingerprint. Stored snapshots stay
  on schema 2 because their format did not change. The selected preset is reported with its source
  but excluded from the semantic hash, so a fully expanded equivalent config hashes identically.
- `breaklint.schema.json` is generated from the same rule registry as runtime validation, shipped
  in the package and guarded against drift during tests and `prepack`.
- The misleading type-rule option `excludeSelectors` is replaced by `excludeTags`, matching its
  actual HTML-ancestor-tag semantics. Tag names are validated, lower-cased and deduplicated.
- A short repository constitution in `AGENTS.md`, the full contract in
  `docs/configuration.md`, process-boundary CLI tests and independent fingerprint reproduction
  document and enforce the new trust boundary.
- The packed-consumer gate now runs the complete config contract on Node 22.13 and Node 24:
  exported schema, valid report, provenance, independent hash and four fail-closed controls.

### Live-gate truth

- The live runner now consumes structured `node:test` failure events. A suite-level `after`-hook
  failure can be printed as `not ok` while Node still exits 0 and reports zero scalar failures;
  that state no longer promotes a measurement report.
- A failed rerun removes both its partial report and any stale report already present at the
  explicitly requested output path, so an older green artefact cannot survive under a red run's
  name.
- Renderer cleanup now has one shared ownership order for the product path and the live evidence
  harness: the rasterizer target receives a bounded head start before browser-wide shutdown. This
  removes the race between `Target.closeTarget` and `Browser.close` without suppressing lifecycle
  errors.
- Deterministic regressions cover both the cleanup order and a green test body followed by a red
  suite hook.
- The deliberately blocked R6 rasterizer probe now owns a sacrificial browser process and joins
  its pending CDP operation before exit. The live runner also isolates every live file: it accepts
  only one structured top-level suite pass, the exact 18/7/7/25 leaf denominators and zero
  fail/skip/cancel/todo events. A process that lingers after that complete verdict is terminated
  only after a bounded natural-exit grace; an early exit, wrong denominator or after-hook failure
  remains red.

### HTML Report Surface v2

- The HTML report now has four status-true states: clean, blocking findings, checker failure and
  insufficient coverage. Exit 3 and 4 explicitly say that the run is not clean.
- Findings use semantic vertical articles instead of a wide table. Severity, rule, document,
  source, measurement, threshold, calibration, proof source, evidence and ambiguity remain
  available at mobile widths and in A4 print.
- Light, dark and print consume one token layer. The report remains script-free, self-contained
  and offline; only tool-shaped relative evidence references become links.
- A deterministic render gate covers 24 screen surfaces, four A4 PDFs and four independently
  rasterized PDF page sets. It checks layout invariants, real computed WCAG AA contrast, hashes,
  dimensions and a 32-cell visual review ledger without using volatile container-byte equality as
  a portable oracle.
- The human-review pass is bound to a SHA-256 fingerprint over 47 current inputs, the exact
  browser/platform/render environment and independently reconstructed stable fingerprints for all
  32 cells. Exact PNG/PDF hashes remain the audit trail of the 62 files actually reviewed; visible
  PDF equivalence is bound to all 34 independently rasterized pages. A real temp-copy source
  mutation invalidates the old pass, and an unreviewed fingerprint fails with all cells pending.
- Checker-failure reports never call partial measurement trusted coverage. Existing counts remain
  visible as partial evidence under `Not trustworthy`.
- breaklint now checks its own final HTML report through the real browser, paginator, evidence and
  both proof-source-A rules. A deliberately oversized unbreakable finding card is the red control.

### Release integrity and runtime

- The supported runtime starts at Node 22.13 and is tested again on Node 24. The browser peer is
  `puppeteer-core >=25.8.0 <26`; both the runtime and full development graphs audit to zero known
  advisories after removal of the vulnerable `extract-zip` chain.
- Gitleaks 8.30.1 is checksum-pinned. CI and release scan complete history and the worktree, then
  prove the scanner with generated secret and absolute-home-path canaries.
- The release workflow creates one tarball, binds it with SHA-256 and SHA-512 SRI, gives those exact
  bytes to both clean consumers and npm, verifies registry integrity, and attaches the package plus
  checksums to the GitHub Release. An annotated tag must equal `package.json`, resolve to
  `origin/main` and have a successful main CI run for the same commit before publishing; a real Git
  process-boundary canary proves that a lightweight tag is rejected before the ref is peeled.
- The paginator is installed over the browser-driver boundary after authored loading. This lets
  breaklint inspect CSP-bearing HTML without disabling the document's CSP and changing author
  script semantics.

## 0.1.0 — 2026-08-14

First published version. What it is: a measurement chain that runs end to end and states, in every
finding, what it measured and against which threshold. What it is not: a calibrated instrument. No
threshold in this release has been checked against a corpus of real documents with human-labelled
truth, and `uncalibrated` therefore appears in the type, in every finding and on every rule page.

### The check itself

- Fifteen rules as pure functions over a snapshot, with a mutation guard that kills every mutant
  on a fixture that actually triggers the rule.
- Two rules can fail a build by default, twelve are advisory under `--fail-on warn`, and
  `layout/half-empty-page` is experimental and never moves an exit code.
- Six output formats — json, sarif, console, html, junit, markdown — each carrying every mandatory
  counter, including on a clean run.
- Exit precedence with a 28-row matrix over all five exit codes, asserting exit code, verdict and
  gate reason together.
- `npx breaklint --demo` runs the real rule and reporter chain over a stored snapshot: exit 1,
  eight findings across seven rules, no browser required.

### The live path

- A run over real HTML loads each document from an owned loopback origin, enforces the renderer
  and paginator gates, waits at the resource boundary, paginates, collects and validates the
  snapshot, runs the rule engine and attaches the evidence outcome to the report.
- Paged.js is pinned to exactly 0.4.3, because the break cause is read from attributes the
  paginator writes into the tree and does not guarantee as an interface. Any other resolved
  version stops the run with exit 3, and no flag overrides that.
- `checker-crashed` is a real fault path, not a placeholder: driver resets, injected boundary
  failures, apparatus races and unverified cleanup all produce it and are exercised by the exit
  matrix.
- The document is loaded by navigating to a loopback origin rather than via `setContent`, and both
  reasons were measured rather than assumed.

### Evidence

- `pdfjs-dist` rasterises the produced PDF on a second page of the same browser instance, served
  over a loopback origin, so no browser-wide file-access switch is needed.
- Invisible marks are placed after pagination, and the binding is decided by comparing the marked
  PDF against a baseline PDF taken BEFORE the overlay existed — not by detaching it again, because
  a document that mutates itself when the layer arrives leaves that change in both PDFs.
- Verified against real Chrome, real Paged.js, and poppler as an independent rasteriser.
  `npm run test:live` fails rather than skips when a prerequisite is missing.
- Not every infrastructure event ends a run. `mark-style-overridden` and `mark-raster-diff` mean
  the evidence was lost, not that the document could not be measured; a page whose own marks all
  miss does end it.
- The `Δy` reference is bounded, not only the residual around it. A displacement shared by every
  mark on a page was previously invisible by construction — the reference absorbed it, and the page
  reported a maximum deviation of zero for a displacement of any size.
- Declaring a page divergent, which ends the run, needs three refound pairs rather than two. At two
  a median is a mean, so one extraction outlier beside one correct mark aborted the run on a sound
  document. A two-pair page that binds nothing is `unverified` instead.

### The apparatus was measuring its own footprint

- **Evidence binding never worked on Linux, and the first public CI run is what said so.** (The
  fix below is measured in a Linux container, not yet on the x86_64 CI runner — the numbers
  reproduced there within a few pixels of the runner's, which is what identifies the mechanism,
  not what closes the platform.) The
  marks are text, and text pulls glyphs from a font. Set in the same font as the document's own
  prose, the marks ENLARGED the font subset Chrome embeds — measured on the neutral fixture,
  17 584 bytes of font program against 15 508, different hash, same name. A different font program
  rasterises differently: pdfjs, which installs embedded fonts through the browser's own text
  machinery, reported 1116 differing pixels between the marked PDF and its baseline, while poppler
  reported 0 on the same two files. The overlay check read that as contamination and withheld the
  evidence for every document. The pixels were never in the document; they were the shadow of the
  measuring apparatus.

  The marks now have a font of their own — seventeen characters, one rectangle each, generated by
  `tools/make-mark-font.mjs` and carried as a constant. It cannot enlarge anyone's subset because
  no document will ever set type in it.

- Two things about that font were wrong on the first attempt, and both are worth keeping:

  Its glyphs were empty, which looked strictly better — invisibility that does not depend on a
  colour a hostile stylesheet might reach. Chrome emits no drawing operation for a glyph with
  nothing to draw, so the font never reached the PDF at all, the tokens vanished from the text
  stream, and not one mark bound. The raster comparison went to a perfect 0 while the evidence
  went to nothing, which from the outside is indistinguishable from success.

  And it was registered by the overlay, through a `<style>` element. That is a new node in a
  document that has already been measured and frozen, which is exactly what this product's own
  tamper detection exists to catch — nine cases of the live chain went red, correctly. Moved to
  the FontFace API it stopped being a node and started being a resource load, which the network
  guard refused, also correctly. It now goes in with the rest of the apparatus, before the
  document exists. The apparatus does not get an exemption from the rules it enforces.

- **The readback measures that the font arrived, rather than trusting that it did.** With the
  registration removed, the computed `font-family` still reads back as ours while the glyphs come
  from somewhere else — measured at 5.13px for a nine-character token instead of 9px. The advance
  width is what catches it, and a mark font that did not arrive now drops the binding instead of
  quietly reporting the old wrong number.

- **A blank-page assertion was measuring one platform's line breaking.** Every evidence page had
  to carry more than 500 inked pixels or the rasteriser was declared broken. On Linux, Liberation
  Serif is wider than the macOS serif these fixtures were written against, so a fixture paginates
  to three pages and the third holds the two words that no longer fit: 169 pixels, and a green
  suite turned red for a document that was fine. The threshold is gone. A sparse page is now
  allowed exactly when poppler — which shares no code with the product — finds it sparse too, and
  a page that is blank here and inked there still fails, which is the case the check exists for.

### Gates that were missing and are now there

- **The tool now runs when it is installed.** npm links a `bin` as a symlink, so node is handed
  the link path while the module reports the path of the real file. The entry guard compared the
  two with `path.resolve`, which never touches the filesystem — so every installed copy did
  nothing at all: no output, no findings, exit 0. For a checker that is the worst available
  failure, because a build gate reads exit 0 as a clean document. Both sides are resolved through
  the filesystem now, and the gap that hid it is closed at two levels: an end-to-end test invokes
  the CLI through a symlink on the SOURCE, which reproduces the mechanism on every `npm test`, and
  a CI step packs the tarball, installs it into a foreign directory and runs `npx breaklint` there
  — which is the artefact and the path a user actually takes. The first alone would not have
  caught it in the form it shipped; saying otherwise was the same mistake one level up.

- The reason reported for an exit names the event that caused it. A run without a snapshot used to
  name whichever event arrived first, so a fatal exit could be attributed to a kind that cannot
  cause one.
- Every infrastructure kind has its fatality asserted individually, against a list written out in
  the test rather than derived from the list under test.
- `package.json` no longer lists files that do not exist, and a test checks that it cannot.

### Known limits in this release

- No threshold is calibrated. The implementation is verified, not validated.
- Windows is not supported; process termination rests on POSIX process groups. The termination and
  profile-cleanup path is measured on macOS, and an equivalent Linux measurement is still missing.
- Input identity is bounded: the report records the HTML hash, observed resource status, bytes,
  hashes and redirects, renderer and platform data and resolved font families, but not
  platform-stable system font identifiers.
- SVG ink passes against the real renderer, and the wider corpus work, are unfinished.
  `docs/status.md` states what has been measured and what has not.

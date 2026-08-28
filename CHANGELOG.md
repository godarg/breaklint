# Changelog

## Unreleased

## 0.2.3 — prepared 2026-08-28, not released

No tag, no npm publish. Four independent review passes ended FAIL on different and correct
findings; the repaired code has since passed a focused independent re-review with no open
Blocker/High finding. Release still waits for the human report-surface ledger to be rebound to the
changed pixels and for the final verifier to accept that complete state. The date on this heading
becomes a release date when the tag exists, and not before.

### Any document with an inline SVG can be checked

- **Fixed: a single inline `<svg>` made a document uncheckable.** The snapshot collector marked
  every SVG unmeasurable with `env/pixel-oracle-unavailable`; `svg/text-overflows-viewport` had
  not declared that reason, and an undeclared decline is a fatal `checker-crashed` — exit 3 on a
  clean two-page document holding one harmless label. Isolated at a minimal fixture: with the SVG,
  exit 3; without it, exit 0. Nothing in the suite reached the case, because not one live fixture
  contained an `<svg>`.
- **`svg/text-overflows-viewport` now measures.** SVG text geometry is collected as `getBBox()`
  normalised through `getScreenCTM()`, using all four transformed corners — under a rotation the
  min/max over one diagonal understates the extent in both axes, and this rule compares extents.
  The primitives are the ones captured before any author script runs. `svgRootKey`/`svgTextKey`
  existed unused and are now the identity of every target, joined in Node so no hash is computed
  inside the document under test.
- **Two decline classes left the coverage base.** `TOOL_CAPABILITY_ENV_IDS` names measurements
  this build cannot take; `NON_APPLICABLE_ENV_IDS` names questions that do not arise for a target
  (`overflow: visible`). Both stay in `notMeasured` with rule, reason and count; each rule's own
  measured-plus-declined-equals-candidates check still runs first. A decline naming a property of
  the INPUT still counts, which is what exit 4 is for, and `tests/unit/coverage-base.test.ts`
  holds both halves of that pair.
- **`inkCollected` separates two states the ink rules were conflating**: passes that do not exist
  in this build, and passes that ran and disagreed. They reported the second while the first was
  true. Snapshot schema 2 → 3; report schema unchanged at 3.
- **Failures are per target, not per SVG.** One unreadable `<text>` used to mark its whole SVG
  unmeasurable, discarding every box already measured there and taking an error rule with a
  coverage floor of 1 to exit 4. `unreadableTargets` (laid out, no readable box — counts against
  coverage) and `notRenderedTargets` (never laid out — not a target at all) replace that.
- **An element that is never painted is not a target.** Chrome answers `getBBox()` and
  `getScreenCTM()` for a `<text>` inside `<defs>` and yields a box 609.65 px outside the viewport,
  which a gating rule reported as an error about something nobody can see. The collector now asks
  `getBoundingClientRect` first. Found by building the fixture, not by reading the code.
- **Two identical labels are ambiguous, not identical.** Findings on `<text>` elements sharing one
  content-derived identity carry `ambiguity.groupSize` instead of quietly claiming to be one.
- **The live corpus now holds an inline SVG.** `tests/fixtures/svg-text-geometry.html` carries
  seven figures with seven different answers — inside, outside, rotated-out at 90 and at 45
  degrees, painted-anyway, a `<defs>` element that is not a target, and four ways to be laid out
  and still invisible — and `svg-in-viewport.html` carries the sound document that must end
  exit 0. Both run in the M2d live chain. Five of those cases exist because three independent
  reviews found the earlier ones insufficient; the 45-degree case is what binds the four-corner
  claim to a number.
- **A document whose SVGs are all inside their viewports has a fixture at last.**
  `tests/fixtures/svg-in-viewport.html` ends exit 0 — the claim this release is about, which no
  test held until a second independent review pointed out that the only SVG fixture ends exit 1
  by design and therefore cannot show that a sound document passes.
- **Three more ways to report a defect about something nobody can see, all closed.**
  `visibility: hidden`, `opacity: 0` and `fill: none` lay out normally and return a full client
  rect, so painting is now read from the computed style as well; a nested `<svg>` had its text
  collected twice and compared against the outer viewport; and the ambiguity group is counted
  across the document, because two structurally identical SVGs share one identity by design and
  the group was reported as 1 for exactly that collision.
- The stored demo snapshot moved to schema 3 with the new fields; `reason` is `null` rather than
  absent so it survives the JSON round trip the receipt schema requires; every `reviewedAt` in
  the report-surface ledger is the date of the review that actually happened, with the transfer
  in a field of its own.
- **Findings carry the page they are on.** All three SVG rules got it wrong: one looked the SVG's
  `nodeKey` up among the BLOCK keys, which never match, and fell back to page 1; the other two
  wrote `page: 1` outright. Nobody had noticed, because the gating rule had never produced a
  finding for anyone to read. The page is now a field on the record, set by the collector.
- **Complex SVG geometry now fails closed instead of guessing.** Text instantiated through
  `<use>`, paint bounds changed by clip paths, masks, filters, paint servers, text decoration or
  visible stroke, and SVG roots or transformed ancestors whose box geometry makes
  `getBoundingClientRect` a different box from the viewport are explicit coverage-relevant
  declines. They therefore end an error-rule run in exit 4 instead of disappearing as a silent
  false negative or becoming a false error finding. Solid fill text in an ordinary viewport
  remains measurable; alpha-zero paint is correctly excluded as not rendered.
- **The 500-target cap now counts potential paint targets, not definitions.** A separate 5,000
  element raw-DOM ceiling bounds classification work, while 501 never-instantiated `<defs>` texts
  beside one visible label no longer make the SVG unmeasurable.
- No threshold, severity or `calibrated` flag changed, and no rule was added or removed. The ink
  passes remain unimplemented (M3), so `svg/text-clipped` and `svg/text-ink-collision` still
  measure nothing — they now say so instead of ending the run. README, `docs/status.md`,
  `docs/limitations.md` and all three SVG rule pages state that plainly for the first time.

## 0.2.2 — 2026-08-26

Released as tag `v0.2.2`; this heading replaces an "Unreleased / planned patch version 0.2.2"
block that was never renamed when the tag went out.

### Verification truth and calibration safety

- Corrected the shipped Unit-test figure from the former 439-test Unit + E2E aggregate to the
  current measured 336-test Unit-only denominator. `npm test` now preserves the current 444-test
  aggregate and Unit-only run as separate TAP artefacts, so the
  CI documentation guard measures the field it names instead of accepting the aggregate by mistake.
- Retired executable SVG-source packets v1/v2 from new human annotation sessions after the
  preregistered repeated-channel stop criterion fired. A raster-only packet-v3 schema now requires
  declared renderer, asset/font, viewport, raster and blocked-fetch-positive-control bindings, while
  the real annotation CLI retires all legacy packet/pipeline creation and verification seams, the
  generic file-writing legacy pipeline module is removed, and v3 stays blocked until those
  declarations have an external verifier; no v3 renderer, packet, calibration or human annotation
  is claimed yet.
- Repaired historical v2 reconstruction without changing frozen bytes: URL targets are checked before
  the independent parenthesis balance; reference discovery, namespace/ID inspection and rewriting use
  parsed elements with located attributes rather than matching the whole document string; attribute
  stripping can no longer cross quoted markup boundaries; unknown namespaces are refused on opening
  and closing tags; and one-pass, Unicode-aware reference rewriting keeps prefix-equal IDs distinct.
  All three same-document `url()` quoting forms are asserted.
- Closed the physical right edge of every print coverage card. Chrome reported the declared border in
  computed style but omitted it from paged PDF output around the float-based print layout; a tokenized
  child-border edge now survives rasterization without depending on printed backgrounds; a separate
  background-disabled A4 probe verifies that property on both the ordinary and strong-left-border
  variants. Independent renderer/verifier passes require all 15 cards in each report state to have complete
  visible left and right edges. Whole-edge, one-sided partial-edge and simultaneous two-sided
  partial-edge mutations run as genuine expected-red CI subprocesses and must all fail for the
  measured side or sides.

## 0.2.1 — 2026-08-25

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
- Community intake now screens the issue TITLE as well as the body for credential patterns; a hit in either field
  classifies the report `sensitive-warning` and the public dashboard replaces the title with
  `Sensitive content withheld`. Markdown escaping is not redaction, so the title is withheld rather than escaped.
- Added blind packet v2 with deterministic SVG metadata sanitization, fail-closed content checks,
  independently reconstructed context bytes, target-set commitments and custodial neutral-order
  verification. Packet v1 and its freeze remain unchanged historical evidence; the linked local
  sequence-2 freeze is not an external receipt or authorization for human annotation.

### Open community QA intake

- Added an open, unpaid community-testing guide and structured GitHub intake for public or
  disposable reproductions. No application or tester selection is required.
- Added a data-only intake classifier and dashboard workflow. Submitted content is never executed;
  reports with missing declarations or sensitive-data patterns fail closed into explicit labels.
- Governed sections now have exact cardinality and normalization-aware duplicate detection;
  sensitive-input detection covers unquoted/provider/auth/URL/token forms without echoing payloads.
- Community reports remain non-blind product QA. They are not human calibration annotations,
  external holdout receipts, trust roots or authority to change thresholds, version or release.

### Reproducibility and dependency disposition

- Live measurement reports now create missing parent directories before their atomic partial-file
  write, so the documented fresh-checkout command works without pre-created local state.
- Documentation figures in `docs/status.md` carry a machine-readable marker, and a drift guard
  (`tests/tools/documented-figures.mjs`) compares it against separate measured Unit and aggregate
  TAPs, the accepted structured live-test denominator, live-report shape and both S1 raster oracles.
  `npm test` preserves `.tmp/unit.tap` and `.tmp/test.tap`; the live CI and release steps atomically
  write the structured verdict and measured browser report, then invoke `npm run test:documented-figures`
  against the real `docs/status.md`. The synthetic unit test remains the negative-control harness,
  while the release gate now rejects stale published figures from measured evidence.
- Paged.js 0.4.3 remains pinned after review: the obsolete polyfill chain is not reached by the
  measured browser-bundle path and no known advisory was found. The risk acceptance expires on
  2026-11-24 or earlier on an upstream, advisory or integration trigger.

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

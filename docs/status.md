# What is finished and what is not

This page exists because the alternative is worse. A layout checker whose green state means
nothing is more dangerous than no checker at all, so what has been measured and what has not is
stated here rather than left to be inferred from a passing test suite.

## Prepared release state — 0.3.1 (2026-08-30)

The annotated `v0.3.0` attempt is deliberately not this release. Its workflow stopped before npm or
a GitHub Release was created because the installed-package real-document gate ran the child CLI in
the repository checkout instead of the clean consumer directory. That checkout already contained
the optional renderer peers, which made local and ordinary CI evidence falsely inherit them. The
tag remains immutable evidence of the failed attempt; 0.3.1 makes the child CWD mandatory and
explicit in the source and both installed-tarball gates.

The 0.3.1 release candidate exposes **13 rules**: two structural error rules, ten ordinary warning rules and
one experimental warning that never gates. All 13 carry `calibrated: false`; there is still no
human-labelled corpus and no external trust root. The research modules `svg/text-clipped` and
`svg/text-ink-collision` are retained for the M3 renderer lab but are no longer counted, configured,
reported in SARIF or demonstrated by `--demo`, because production acquisition collects no ink pass.

The current demo has seven findings and reports `rules run: 13`, `rules that measured something:
11`. Its snapshot now says `inkCollected: false` and contains no invented pixel counts. Two frozen,
rights- and privacy-reviewed HTML artifacts are a mandatory CI and release gate. The third-party
Project Gutenberg document was not written for this repository; it produces exactly 9 pages,
measures 9/13 rules and exits 0. The first-party Dargel document separately exercises absent-image
packaging and produces exactly 6 pages, measures 11/13 rules and exits 0. The published 0.2.3 package
makes the third-party gate fail with Exit 3; the exact registry integrity, environment,
deterministic observation and reproduction command are retained in
`docs/validation/real-document-red-control-v0.2.3.json` as the recorded red control.

Live input is explicitly `.html`/`.htm`. Standalone SVG, PDF, Markdown and directories are rejected
as usage with Exit 2 before the browser starts. Inline SVG remains supported for the released
viewport-geometry rule. The geometry cross-check keeps its `0.05 px` guard band: CDP quads now use
the AABB of all four corners, and SVG graphics descendants are excluded because CDP's stroke/paint
box and `getBoundingClientRect()`'s SVG geometry box are different quantities. A third-party HTML
document also exposed an authored block reset to an inline formatting box: CDP and GCR intentionally
covered different child unions, so that inline box is excluded while its block children stay in the
sample. Raising the tolerance would have hidden differences up to 18 px rather than fixed the
comparison.

Missing images are not silently ignored. A decode failure without positive authored `width` and
`height` attributes, or whose rendered box is not exactly equal to both values, is fatal;
replacement text and authored CSS overrides do not establish stable image geometry. Only a failure
with equal declared and rendered dimensions becomes the named non-fatal event
`image-content-unavailable`. That distinction lets
the frozen first-party corpus document be measured without claiming its absent pixels were present.
Every successful live document also carries `geometry-cross-check-passed`: it reports candidates,
the full addressable eligible population counted before the eight-box sample limit, the
checked/required cardinality, named semantic exclusions and
maximum delta against the 0.05 px tolerance. A green report therefore exposes how much of the
second-opinion sample actually ran instead of hiding that fact behind Exit 0.

M3 is split by dependency: M3-1a (public corpus breadth and acquisition robustness) is active and
precedes governance; M3-1b (blind human labels, adjudication, external attestation and externally
controlled freeze) remains parked. No threshold, severity, proof-source-A contract or `calibrated`
flag changed. The sections below are a dated build record; statements such as “not released” describe
their checkpoint, not the current state.

The report surfaces are regenerated as 32 semantic cells and 59 physical artifacts (24 screen PNGs,
4 PDFs and 31 PDF-page rasters). The technical gate verifies those current bytes, decoded pixels,
contrast, accessibility, print fragmentation and a real pixel-mutation red control. The prior human
ledger remains bound to the 0.2.3 inputs and 62 artifacts; it has deliberately not been restamped or
transferred to 0.3.1. `test:report-surfaces:local` therefore remains red until a person reviews the
current exact environment. No human review of the 0.3.1 surface is claimed.

## Finished and verified without a browser

| | |
|---|---|
| 13 released rules as pure functions over a snapshot | `src/rules/` |
| Mutation guard | 13/13 released rules kill every mutant, each on a fixture that actually triggers it |
| False-alarm corpus | every clean fixture stays silent, every trigger fixture fires and is attributed correctly |
| Exit matrix | 28 rows over all five exit codes, all nine `failOn` rows and every precedence edge; each row asserts on exit code **and** verdict **and** `gateTriggeredBy` |
| Configuration Contract v1 | fail-closed JSON; real `default` and `strict` profiles; defaults < profile < config < CLI; raise-only coverage; proof-source-A thresholds locked; every effective leaf carries provenance and a SHA-256 fingerprint in report schema 3; generated schema drift and process-boundary exit 2 are tested |
| Six output formats | each carries every mandatory counter, checked mechanically, including on a clean run |
| HTML Report Surface v2 | four truthful verdict states; semantic finding cards; responsive light/dark and A4 print; current 32-cell technical gate over 59 physical artifacts with decoded-pixel, contrast, accessibility and fragmentation checks; the 0.2.3 human ledger remains historical and is not presented as review of 0.3.1 |
| Release-integrity gates | checksum-pinned full-history/worktree secret scan with two canaries; runtime and full dependency audits at zero; one-tarball Node 22.13/24 consumer and publish contract |
| Licence gate | walks the whole of `node_modules`, so `dependencies`, `optionalDependencies` and the dev tree are all covered; a missing licence field fails |
| `npx breaklint --demo` | runs the real rule and reporter chain, exit 1, 7 findings across 6 rules |

## Finished and verified against a real browser

The evidence path — rasteriser, overlay, binding — runs against real Chrome, real Paged.js and
real `pdfjs-dist`. `npm run test:live` needs all four prerequisites including poppler's
`pdftoppm`, and a missing one FAILS the suite rather than skipping it: a suite that goes green by
running nothing makes every claim on this page look checked.

There is one way to turn that failure back into a skip, and it is written here rather than only in
the test file, because a property stated without its exception is a property overstated.
`BREAKLINT_LIVE_OPTIONAL=1` downgrades missing prerequisites to skips. No measurement report is
promoted and the reason is printed, but the exit code is what a release gate reads, so the variable
belongs to a local run on a machine without poppler and nowhere else. Measured both ways: without it,
exit 1 and `no measurement report was written`; with it, exit 0 with no promoted measurement.

| | |
|---|---|
| Rasteriser | `pdfjs-dist`, on a second page of the same browser instance, served over a loopback origin. No native canvas binding, no poppler in the product. |
| Rasteriser version | read from the library that loaded, and compared against the declared one |
| Local file access | measured, not declared: a document loaded from disk cannot read a neighbouring file (`BLOCKED: TypeError: Failed to fetch`). The browser-wide switch that used to allow it is gone, and the check is in the suite because removing the *reason* for a switch and leaving the switch is a mistake that was actually made here. |
| Ordering | measured at this product: with a content page open the rasteriser did not answer within the suite's 15 s window; with every page closed the same PDF came back with its pages, in 90 ms and 111 ms on the last measured pair of runs |
| Baseline | the unmarked PDF is produced BEFORE the overlay has ever existed, not by detaching it again |
| Binding | marked PDF against baseline PDF, compared on the PDF raster — not on a screenshot |
| Detach, not hide | the layer leaves the tree, so a presence selector stops matching |
| Own nodes only | layers and marks are held as references; nothing is found again by class name |
| Evidence files | one PNG per page; the header is read back out of the bytes and checked against the size the rasteriser reported. A page that fails that check withdraws the bindings of the whole document. |

**Measured over eight documents, two runs.** The report's current leaf count is recorded only in
the machine-checked figures marker below; every scalar and every empty object or array counts as
one leaf, and no path appears in one run and not the other.

<!-- breaklint-status-figures-v1 unitTests=356 aggregateTests=469 liveTests=62 liveReportLeaves=226 s1RasterDiffPx=200 s1ForeignRasterDiffPx=200 -->

The number of leaves that DIFFER between two runs is not a constant of this tool, and saying "one"
flatly was wrong. It is one when nothing outside the run changes: a wall-clock time (90 ms against
111 ms in the last measured pair — the value moves from run to run, which is the point). A later pair of runs differed in two, because Chrome updated itself between them and
`browserVersion` is in the report — which is the report doing its job. What the tool actually gates
is SHAPE: `tests/tools/leaves.mjs` exits non-zero when a path appears in one run and not the other,
and zero when only values move. A differing value can be a fact about the environment; a missing
field cannot.

The count is not a number to be taken on trust — an audit established that the figure previously
stated here, 209, was not reachable under any plausible counting rule, and nothing in the
repository computed it. It is now a command:

```
BREAKLINT_LIVE_REPORT=.tmp/a.json npm run test:live
BREAKLINT_LIVE_REPORT=.tmp/b.json npm run test:live
node tests/tools/leaves.mjs .tmp/a.json .tmp/b.json
```

which prints both counts, every leaf that differs, and exits non-zero if the two runs disagree in
SHAPE rather than merely in a value. A wall-clock difference is not a contract value; a missing
field is. The live-report writer creates a missing parent directory atomically; the command above
was re-run from a fresh checkout without a pre-existing `.tmp` directory.

The release/CI path also binds the documented figures to real evidence rather than synthetic test
data: `npm test` preserves separate aggregate and Unit-only TAPs, and the accepted live step
atomically writes both its structured verdict and measurement report. `npm run
test:documented-figures` rejects any mismatch with the marker above. That single marker is the
canonical numerical record for the Unit-only, Unit + E2E and accepted live denominators, the report
shape and both S1 raster oracles; this current-state passage deliberately does not duplicate those
values outside the marker.

| Case | raster diff | style violations | binding |
|---|---:|---:|---|
| neutral | 0 | 0 | kept, 9 of 9 source blocks bound |
| layer background attacked | 0 | 0 | kept — the inline isolation absorbs it |
| document uses our own class names | 0 | 0 | kept, 11 of 11 source blocks bound |
| pseudo-element on the layer | 16 006 | 0 | lost |
| `:has()` on the layer's presence | 84 711 | 0 | lost |
| document mutates itself when the layer arrives | 54 969 | 0 | lost |
| document deletes our layer as fast as we attach it | 0 | 20 | lost |
| script rewrites the marks' style | 200 | 20 | lost |

Marks were refound in the PDF with `max |Δx| = 0.0000 mm` and `max |Δy − reference| = 0.215 mm`
against a stated tolerance of 0.35 mm; no mark failed to be found exactly once. The delivered PDF
was pixel-identical to a PDF of the same document produced on a page that never carried an
overlay — in all eight cases, including the five where the binding was lost. An independent
rasteriser (poppler, never a dependency of this tool) counted a difference on exactly the same
four and agreed in sign on all eight.

### A hole in the evidence binding that two audits found, and what closed it

The `Δy` check is a residual around a reference taken from the marks themselves, because a mark's
`top` is a box edge and a PDF item's `y` is a glyph baseline. That normalisation had no floor, and
the consequence is not a matter of degree: **if every mark on a page is displaced by the same
amount, the reference absorbs it exactly.** Measured on a constructed case, a 40 mm uniform
displacement bound every target and reported `maxDyMm: 0.0000` — the most confident answer this
tool can give — while the PDF did not reproduce the DOM at all. `Δx` never had the hole; it is
judged absolutely.

The residual cannot be made to see this by tightening it, because the residual is zero by
construction. What closed it is a bound on the REFERENCE, and the report now carries the reference
next to the residual so the two can be read together. The bound is 1.0 mm against a measured
corpus maximum of 0.0909 mm; the live suite fails if the corpus ever exceeds that maximum, so the
headroom cannot erode unnoticed. It is not calibrated, and it is **L-36**.

The same audit round found that the fatal `dom-pdf-divergence` verdict rested on a two-point
median. At two values a median IS the mean, so one extraction outlier beside one correct mark
produced a reference halfway between them, bound nothing, and aborted the run on a sound document.
Declaring a page divergent now needs three pairs; a two-pair page that binds nothing is
`unverified` — "no evidence" — which is the weaker and honest statement.

### What these runs do not establish, stated because it was nearly claimed

**A fourth audit round reverted seven repairs one at a time; one of them stayed green.** The
mutation moved an infrastructure kind onto the non-fatal list, and the table-driven test written
to catch exactly that drift computed its own expectation FROM the list under test — so the
expectation moved with it. The oracle drew its truth from the object under test, inside the test
written to prevent that. The expected set is now a literal in the test file, and a second
assertion makes the two disagree loudly rather than silently. The other six mutations were red,
each measured singly.

**Four repairs were once green in every suite while being reverted.** An audit turned each of them
back into its defect — the tolerance-free page verdict, the unread integrity count, the unread
late errors, the file-access switch — and the whole suite as it stood at the time (104 Unit tests
and 15 live tests; the current measured denominators are bound in the figures marker above)
plus the mutation guard stayed green through all
four. The repairs were real; the gates were not there. They are now, and
each was verified by re-applying the mutation and watching it go red. The reason the live corpus
could not reach them is structural: a real document cannot be made to produce a rasteriser page
error, a PNG that fails its own header check, or a page whose marks were all refound but sit
forty millimetres from where the DOM said they were. Those cases live in
`tests/unit/evidence-decision.test.ts`, driven through the module's own injected seams.

**One live fixture does less than it looks like it does.** The document that deletes our layer
fails closed, but through two signals at once: the detach count comes back short AND the property
readback fires, because a mark removed from the tree has no computed position. It therefore does
not isolate the integrity count, and a mutation removing that count from the verdict leaves the
fixture green. The isolated gate is the unit test.

**The property readback catches nothing in this corpus that the raster comparison does not also
catch.** It contributes diagnosis — it names the offending mark and the reason — and not coverage.

**The tolerance of 0.35 mm** is justified in the contract by a measured `sd(Δy)` of 0.0777 mm,
which would be about fourfold headroom. Over this corpus the largest `sd(Δy)` on any document is
0.1286 mm and the largest single deviation is 0.215 mm — so the headroom is about 2.7-fold on the
spread and about 1.6-fold on the worst mark. The number is unchanged; the margin is a good deal
smaller than the justification for it suggests, and the corpus MAXIMUM is quoted here rather than
the friendliest document in it.

### Three declared changes to the normative contract

All are written here rather than left in a source comment, because a deviation nobody outside the
file knows about is a deviation nobody can overrule.

1. **The baseline PDF is taken before the overlay exists.** §11.4a.3 prescribes producing the
   unmarked PDF by detaching the overlay again. Measured: a document that mutates itself when the
   layer arrives leaves that change behind, both PDFs then carry it, the comparison reports zero
   and the damaged file is delivered as evidence-bearing. The contract's order cannot see its own
   failure case. The re-attach step falls away with it.
2. **The `Δy` reference is the page's own median where the page has at least two refound pairs,
   and the document's median otherwise.** §11.4.3 binds a target on one mark, and judges `Δy`
   against a mean. With a single pair on a page that mean IS the value, so the criterion is empty
   and a mark placed anywhere binds. Taking the reference from the page keeps the contract's
   behaviour wherever the page can supply one — which matters, because a document whose zones
   differ need not share an offset. Falling back to the document keeps the contract's one-mark
   rule alive on short pages instead of dropping them. A median rather than a mean, because one
   grossly displaced mark drags a mean and does not move a median. A document with fewer than two
   refound pairs in total has no reference at all and binds nothing.
3. **`dom-pdf-divergence` gets a structural trigger instead of a contradiction.** §11.4.3 gives
   the same case two different dispositions — `bindsFinding = false` in its algorithm, and exit 3
   two paragraphs later — and the second is worded as "falling below the threshold", which is the
   good case. Both dispositions are right for different scopes. A target out of tolerance is a
   finding without evidence. A PAGE that supplied its own reference and still bound nothing is an
   apparatus disagreeing with itself: its marks are in the PDF and none of them is where the DOM
   says. That is exit 3, `render-unstable`, `dom-pdf-divergence`. The boundary is zero against
   non-zero, not a chosen number, and it is restricted to pages with their own reference so that
   it can never fire because a borrowed reference was wrong.

   Related, and found while wiring it: the engine treated EVERY infrastructure event except
   `empty-input` as exit 3. §11.4.1 says the opposite for the two mark events — "the document is
   in order, only the binding is not". A tool that exits 3 whenever a hostile stylesheet reaches
   its own overlay would be unusable on the documents it exists for. The non-fatal kinds are now
   a named, deliberately short list.

### What the corpus still cannot reach

Extreme layout collapse is not covered. If the PDF's text stream degrades so far that the marks
are no longer found as whole tokens, the run does not reach `dom-pdf-divergence` at all — it ends
in `unverified`, which says "no evidence" rather than "the apparatus is broken". That is the
honest weaker statement, and it is a limit of the mark-based method rather than of this
implementation.

## Live measurement path and remaining work

**M2/M2d is built as one live chain.** `src/acquire/render-run.ts` loads each document from an
owned loopback origin, enforces the renderer and paginator gates, waits at the resource boundary,
paginates, collects and validates the snapshot, runs the rule engine, and attaches the evidence
outcome to the document report. The old unconditional `checker-crashed` branch is gone.
`checker-crashed` itself is not gone: driver resets, deliberately injected boundary failures,
apparatus races, unverified cleanup and other real process-boundary faults still produce that
fatal result and exercise the exit matrix.

The components below are now connected rather than isolated pieces:

| | |
|---|---|
| Source provenance | ids injected into the source TEXT before parsing, with the map built from the parser's positions; the reserved-prefix collision gate refuses `data-bl-` usage case-insensitively and after conservative CSS-escape decoding, while the paired control runs for every injected document; it reports what it searched as well as what it structurally cannot reach |
| Freeze signature | all seven components of §11.3, 250 ms window, 3 retries, and a drift report that names WHICH components moved; a real author-script inline-transform sabotage exhausts the budget (4 failed samples) and yields exit 3 with neither snapshot nor evidence |
| Untouched primitives | references captured before any author script runs. Measured: a document that replaces `getBoundingClientRect`, `getComputedStyle` and `querySelectorAll` after pagination sees `x:999` and `"HIJACKED"`, and the probe reads values byte-identical to a clean run across all seven components. The positive control is in the same test — a naive collector under the same attack loses its boxes entirely, 5 097 characters to 0 |
| Geometry cross-check | the product and live oracle share one sampler; selector plus rendered-fragment occurrence binds each in-page box to the exact CDP `DOM.getBoxModel` node. The two agree EXACTLY on this corpus, twice; a systematic 0.002 px disagreement fails the suite |
| Break-cause collector | all five Paged.js hooks registered and each one verified to have fired; boundaries classified from the three attributes the paginator writes, on a document carrying six boundary kinds at once |

**Released:** `breaklint@0.1.0` is published on npm from the versioned release workflow with
provenance, and the packed package is exercised from a clean consumer directory on Node 20 and 22.
Packaging and the first release are therefore complete, not future milestones.

**Released on 2026-08-22:** `breaklint@0.2.0` implements Configuration Contract v1, the live-gate
truth repair, HTML Report Surface v2, the real self-application gate and the
Node-22.13/Puppeteer-25 security migration. The annotated `v0.2.0` tag resolves to
`ce7097b99beafcedc71b30ee0ed81451811532a0`. Registry SRI, signed SLSA source binding, npm
signatures, byte-identical GitHub assets and a fresh registry consumer were independently checked.
The minor-version change is intentional: unknown or formerly inert configuration now fails closed,
`excludeSelectors` is corrected to `excludeTags`, and report schema moves to 3 while snapshot schema
remains 2. This status paragraph is a later documentation commit and is not retroactively part of
the published tarball.

**Released on 2026-08-25:** `breaklint@0.2.1` packages the open-community-QA documentation and the
advisory remediation recorded in this repository without changing a production rule, threshold,
severity or `calibrated` flag. The annotated `v0.2.1` tag resolves to
`e1746ed9829b9b66cf2311f6d10b58d9f9a646dd`; the tag workflow passed all release gates, then exercised
one checksum-bound tarball in clean Node 22.13.0 and Node 24 consumers before publishing those exact
bytes with npm provenance. Independent registry verification found three verified registry
signatures, two verified attestations, SHA-256
`5381d4ebf52a294c23215010b9b74d7b51c56ce0dfc39cac92a4da896f823c9f` and SRI
`sha512-DjSN0Y2JByE/5vEDrhABl2mQCnjjYgx4a1SIVHhftwtBVxtz7Ia5P8kvje8JdA0IBSGo1rONIaKDnMGxSOuIFQ==`.
The npm tarball is byte-identical to the GitHub Release asset; a fresh registry install reported
version 0.2.1, imported Configuration Contract v1 and produced the expected finding-bearing demo
with exit 1. This status paragraph is a later documentation commit and is not retroactively part of
the published tarball.

**Released on 2026-08-29:** `breaklint@0.2.3` repairs the inline-SVG checking path described below.
The annotated `v0.2.3` tag resolves to `9f8068bb96334f81ae9d96795e685245f5a0e6d6`.
The independent verifier passed that complete state with no open Blocker/High finding, after the
Founder had accepted the 21 changed rendered views and complete PDF set and the review ledger had
been bound to that review. The tag workflow exercised one checksum-bound tarball in clean Node
22.13.0 and Node 24 consumers before publishing those exact bytes with npm provenance. Independent
registry verification found three verified registry signatures, two verified attestations and SRI
`sha512-VMCnnIGeGcyxVBkZqBx6ieNA5NodXLDx3/mY7IYJMVGY2V0lFd+0+B5LO4mYZxJfpx0mMQCGY2+OR/u7Gmj52w==`.
The npm tarball is byte-identical to the GitHub Release asset with SHA-256
`a19be2b87a2d9e725417fbd978623c690fffc2195152d30e269e866c46670abf`; a fresh registry install
reported version 0.2.3, imported Configuration Contract v1 and produced the expected
finding-bearing demo with exit 1. This status paragraph is a later documentation commit and is not
retroactively part of the published tarball.

What it repairs: the defect that made every document
containing an inline SVG uncheckable, and it is worth stating plainly because it is this project's
own subject matter: a full unit suite, a full live suite and a 15/15 mutation guard were green
throughout, and `grep -l "<svg" tests/fixtures/*.html` returned nothing. The most common element
of the documents this tool exists for was absent from its corpus, so no gate reached the code.

What the defect was, measured on a two-page document holding one harmless `<svg><text>` inside its
viewport. The snapshot collector declared every SVG unmeasurable with the reason
`env/pixel-oracle-unavailable`; `svg/text-overflows-viewport` had not declared that reason, and an
undeclared reason is by design a fatal `checker-crashed` — exit 3. Removing only that produced
exit 4 instead, because the two ink rules then declined every target and drove their own coverage
to 0. Both answers describe the tool and were delivered as verdicts on the document.

What changed:

| | |
|---|---|
| SVG text geometry is collected | `getBBox()` normalised through `getScreenCTM()`, **all four corners** and not two opposite ones. Measured rather than asserted: on the 45-degree fixture four corners put the label 15.82 px outside its viewport and two corners put it 28 px inside, so rebuilding the collector on one diagonal drops exactly that finding |
| An element that is never painted is not a target | Measured in Chrome 152: a `<text>` inside `<defs>` answers `getBBox()` and `getScreenCTM()` happily and yields a box 609.65 px outside its viewport — an **error finding from a gating rule about something nobody can see**. `getBoundingClientRect` reports it as not laid out, and that is the question now asked first. Found by building the fixture, not by reading the code |
| Per-target, not per-SVG | One unmeasurable `<text>` used to mark its whole SVG unmeasurable, discarding every box already measured there and taking an error rule with a coverage floor of 1 to exit 4. Failures are now counted and declined per target: `unreadableTargets` (laid out, no CTM — counts against coverage) and `notRenderedTargets` (never laid out — not a target at all) |
| Identical labels are ambiguous, not identical | Two `<text>` without an `id` and with the same content share one content-derived identity. Findings on them carry `ambiguity.groupSize`, the treatment `svgRootKey` already gave two structurally identical SVGs, instead of two findings quietly claiming to be one |
| SVG identity is joined in Node | `svgRootKey`/`svgTextKey` existed and were unused; markup is canonicalised and hashed on the Node side, never inside the document under test |
| Two decline classes leave the coverage base | `TOOL_CAPABILITY_ENV_IDS` (this build cannot take the measurement) and `NON_APPLICABLE_ENV_IDS` (the question does not arise for that target). Both stay in `notMeasured` with rule, reason and count; only the ratio changes, and the subtraction happens after each rule's own books are checked |
| The ink rules say which of two things is true | `inkCollected` separates "the passes do not exist in this build" from "the passes ran and disagreed". They reported the second while the first was the case |
| The corpus holds an inline SVG at last | `tests/fixtures/svg-text-geometry.html`, seven figures, seven different answers, plus `svg-in-viewport.html` — the sound document that must end exit 0 — both in the live chain. Five of those cases exist because two independent reviews found the earlier ones insufficient |
| Snapshot schema | 2 → 3, for the added `inkCollected`. Report schema stays 3 |

What did NOT change: no threshold, no severity, no `calibrated` flag, and no rule was added or
removed. The SVG ink passes remain unimplemented — M3 — so `svg/text-clipped` and
`svg/text-ink-collision` still measure nothing on any document. The difference is that they now
say so in `notMeasured` instead of ending the run.

Measured on this repository's own product corpus after the repair: a 175-page book carrying 15
inline figures and 471 SVG text targets runs to completion with no flags, coverage 1.0 on the
viewport rule, and 167 findings — where 0.2.2 produced exit 3 and nothing at all.

### What two independent reviews of this repair found

A fresh-context verifier read this change as a foreign submission, twice, and returned FAIL both
times. Every finding below was correct, and two of them are the kind this project exists to talk
about — a repair that looked complete and was measured to be incomplete.

**Round one — one BLOCKER, two HIGH.**

A fresh-context verifier read the first version of this change as a foreign submission and
returned FAIL with one BLOCKER and two HIGH findings, all three correct:

- The new `env/svg-ctm-unavailable` was undeclared in both ink rules, which reinstated the exact
  `checker-crashed` this release removes — for any document with a `<text>` in `<defs>`.
- `measurable` was per SVG, so one unreadable target discarded thirty-nine measured ones and
  produced exit 4 for the same document class.
- The only rotated fixture used exactly 90 degrees, where two opposite corners span the same
  axis-aligned box as four. The four-corner claim was written six times and measured zero times.

Building the fixture that closes the first finding surfaced a fourth: Chrome measures a `<text>`
inside `<defs>` without complaint, so the repair as first written turned a silent crash into a
false error finding — the more expensive failure of the two.

**Round two — one HIGH, six MEDIUM, on the repaired version.** The HIGH is the one worth reading:
the release's own headline claim — *a document with a harmless inline SVG now ends exit 0* — was
not held by any test. The fixture that existed ends exit 1 on purpose, so it can demonstrate that
findings appear and can never demonstrate that a sound document passes. A suite in which no case
ends 0 cannot tell "the tool works" from "the tool always complains".
`tests/fixtures/svg-in-viewport.html` is that missing case, and it runs in the live chain.

The MEDIUMs found three further ways to report a defect about something nobody can see, all of
them the `<defs>` class through a different door, and all now measured rather than assumed:

| | |
|---|---|
| `visibility: hidden`, `opacity: 0`, `fill: none` | These lay out normally and return a full client rect, so the empty-rect check did not catch them. Painting is now read from the computed style as well |
| A nested `<svg>` | Its `<text>` was collected twice — once by the inner record and once by the outer one, where it was compared against the wrong viewport. Each record now takes only the targets whose nearest `<svg>` ancestor is itself |
| Two structurally identical SVGs | They share one `svgRootKey` by design, so their labels share `svgTextKey` across records. The ambiguity group was counted inside a record and reported 1 for exactly the collision the field exists for. It is a property of the document and is counted across the document |

Also from round two: the stored demo snapshot moved to schema 3 with the new fields, rather than
leaving `docs/limitations.md` claiming a migration that had not happened; `reason` is `null`
instead of absent so it survives a JSON round trip that the receipt schema requires; and every
`reviewedAt` in the report-surface ledger is back to the date of the review that actually took
place, with the transfer carried in a field of its own. That last one was a LOW finding and the
sharpest of them: a file whose own basis says no review happened on 2026-08-28 should not carry
that date in all 32 cells.

**Round three — one HIGH, five MEDIUM, on the twice-repaired version.** The HIGH is the same
defect a third time, and reached through the only door still open: the receipt schema's `reason`
enum admitted values that the consuming rules do not declare, so a schema-valid external
projection could still produce the undeclared decline that ends a run. The enum now lists only
what all three rules declare.

Two of the MEDIUMs were repairs of this release that had not gone far enough:

- **`opacity` is not inherited.** `<g opacity="0"><text>` reports `opacity: 1` on the child, so
  reading the child's computed style missed it — the invisible-target class through a fifth door.
  Ancestor opacity/visibility is now asked through `Element.checkVisibility`; transparent paint
  is checked separately, and clip/mask/filter/stroke cases decline because that API is not a
  complete paint oracle.
- **A tool limit was still booked as a document property.** An SVG with more targets than the
  collector will gather took the two ink rules — which cannot measure anything in this build — to
  coverage 0 and the run to exit 4. They now answer with their own limit first.

And two were defects in the fixtures written to prove the earlier repairs: the nested inner
`<svg>` reached past the outer viewBox, so the positive control was fixing a document whose
content is clipped; and both identical charts carried `id="chart"`, which meant the shared root
identity followed from a duplicate id rather than from the markup hash the case exists to
exercise. Neither would have been visible without someone reading the fixture against its own
comment.

The `0.01 px` question — a zero threshold on boxes rounded to two decimals — is answered by
`SNAPSHOT_ROUNDING_PX`: the two boxes come from different APIs and each carries up to 0.005 px of
rounding, so a difference of 0.01 is not something these numbers can distinguish from zero. That
is the resolution of the stored data, read off the collector rather than chosen, and it changes
no verdict in the corpus.

**Round four — one HIGH, and it was this release's own doing.** `svg/text-overflows-viewport` was
the only SVG rule that had never produced a finding, so nothing had ever read the page number it
attaches. It looked the SVG's `nodeKey` up among the BLOCK keys — `svg:0:1` against `bl:…`, never
a match — and fell back to page 1. The two ink rules wrote `page: 1` outright. Every finding of
the newly working gating rule therefore pointed at page 1, on a fixture that produces findings on
pages 1, 2 and 3. A page number is the first thing a reader uses to go and look.

The page is now a field on the SVG record, set by the collector, because it is a fact of the
measurement rather than something three rules should each derive. Fixing it also exposed that the
stored demo fixture carried `page: 1` for an SVG that sits on page 5 — a number I had written
without measuring it, in the same commit that repairs numbers written without measuring them.

All of this is recorded rather than quietly fixed, because the pattern is this project's own
subject: the check that looked green was green about the wrong thing, four rounds running.

### Historical pre-release checkpoint: where this left 0.2.3

At this checkpoint it was not released; 0.2.3 was subsequently published on 2026-08-29. The
report-surface ledger was green after a new Founder review.

The ledger binds a human review to the exact bytes of the reviewed artifacts. The Founder's
confirmation on 2026-08-28 was explicit about its own basis: 58 of 62 artifacts byte-identical,
no visible pixel changed. Correcting the page numbers changed 21 of 58 rendered views — the
findings now name a different page — so that basis did not transfer. The 21 deltas were therefore
presented as an explicit old/difference/new gallery together with all four PDFs. The Founder gave
an explicit PASS on 2026-08-29. The ledger records that new review for the changed cells while
retaining the earlier review timestamps only where the visible artifact remained identical.

`npm run test:report-surfaces` now passes against those exact reviewed bytes. A later source or
pixel change returns it to red rather than silently transferring the new PASS.

Historical 0.2.3 honesty note: its `examples/demo-snapshot.json` carried ink counts, so
`npx breaklint --demo` showed a `svg/text-clipped` finding that a real run could not produce.
Version 0.3.1 removes those counts and the two research definitions from the released registry;
the current demo no longer makes that claim.

### CI incident reconciliation: failed push at `05fec787`

GitHub Actions run [32591976847](https://github.com/godarg/breaklint/actions/runs/32591976847)
correctly failed in the portable report-surface gate. The provenance checks had passed; the stop
occurred because `package.json` and `.github/workflows/ci.yml` were bound human-review inputs and
their changed bytes produced fingerprint `278f33fb…`, while the reviewed ledger remained bound to
`58f29719…`. Commit `9caf48d1` restored both inputs byte-for-byte and moved the provenance self-test
to the non-surface-bound release path instead of relabelling the visual review. The immediately
following run [32592289178](https://github.com/godarg/breaklint/actions/runs/32592289178) passed both
jobs on the exact `origin/main` SHA. The older red run is retained as evidence that the gate rejected
unreviewed input drift; it is resolved and must not be rerun or reclassified as green.

**M3-0 foundation is implemented, calibration is still unfinished.** The versioned independent
oracle, strict corpus/annotation schemas, real Chrome/Paged.js SVG Validation Lab, semantic readiness
validator, leakage/holdout checks and negative controls are documented under `docs/validation/`.
The lab is additive and runs through the existing `npm test` E2E discovery path. Its synthetic
fixtures validate the apparatus and known boundaries; they do not count as real calibration data.
Claim readiness now fails closed without a separate trust ledger, previous immutable holdout
baseline, externally anchored preregistration receipt, hash-bound acceptance plan, complete
closed measurement receipt, source-pinned real-rule production evaluation, per-target outcome,
complete external lineage snapshot and acceptance report. The validator executes the unchanged
registry rule and derives the confusion matrix from frozen target rows; parallel decision formulas
and aggregates alone cannot pass. Candidate, freeze, measurement, production, outcome, evaluation,
report and claim must bind the same plan, receipt and holdout lineage.
Current and embedded historical candidates are evaluated by the same leakage/chronology function
against the snapshot's own split and known-outcome projection. Contract-simulation receipts remain
valid seam tests but contribute zero real-evidentiary holdout documents/origins and cannot make a
calibrated claim ready. External-receipt contract tests now require separately supplied capture
bundle and attestation bytes; the validator can certify their integrity but reports
`capture_attestor_trust_valid: false`. M3-0 has no owner-approved externally governed trust root, so
all calibrated-claim readiness remains false even for byte-valid temporary capture bundles.
All external calibration artifacts now cross one byte-authoritative decoder: the exact bytes are
strictly decoded, schema-checked, hashed and then used for semantics. A redundant API value that
differs from the decoded bytes is rejected; malformed, swapped or schema-invalid bytes cannot be
rescued by a parallel object.
Identical artifact bytes cannot
inflate counts, author-ID targets are bound to the parsed artifact, renderer/source identity is
content-derived from a closed clean-commit/dirty-source-bundle projection, and the lab measures
blocked network requests, authored clip boundaries and the exact 7/8 pixel collision boundary.
G2 now exercises its unchanged nested-group semantics with a real `translate(10,0)` transform, and
its clip boundary is resolved in the applied target's CTM.
M3-1 now has a public, rights/privacy-reviewed process-pilot corpus: three immutable documents from
three origin groups, split origin-strictly across development, tuning and holdout. The stored
manifest binds 64 SVG text elements to 192 rule-specific target identities, and the holdout
projection freezes one origin with 45 rule-targets. Packet v1 remains byte-immutable historical
evidence and is not authorized for human delivery. Packet v2 deterministically sanitizes four
byte-bound, oracle-free SVG contexts, binds their independently reconstructed bytes and target set,
and binds neutral order to a preregistered public seed plus custodial reconstruction. The seed is committed in this repository and is therefore recoverable, so blinding rests on procedural non-access rather than secrecy; see the annotation protocol. Its sequence-2
freeze is linked to the unchanged sequence-1 hash. Four successive independent reviews nevertheless
reopened the executable SVG-source delivery channel. Packet v2 is therefore also historical process
evidence and is no longer authorized for a new human session. The decided successor is packet v3:
raster-only PNG delivery under a pinned, network-denied renderer with bound fonts/assets, viewport,
raster bytes and same-run fetch positive control. Its schema and fail-closed delivery gate exist, but
that gate deliberately rejects even structurally valid v3 data until the renderer/network-evidence
verifier and visual-sufficiency oracle exist. No v3 renderer, packet or human annotation is claimed.
The operational CLI refuses `blind-packet`, `pipeline-create` and `pipeline-verify` for the legacy
SVG formats, and the generic file-writing legacy pipeline module has been removed. Frozen v1/v2
integrity and deterministic reconstruction remain covered by the committed corpus-artifact tests.
Low-level in-memory test helpers cannot write a deliverable or authorize a human session.
The local lineage is not an external receipt or trust root.
This is real source and process evidence, not power evidence.
There are still zero verified human annotators, zero adjudications, no disclosed holdout outcome,
no externally verified freeze receipt and no trusted render-capture evidence.
Accordingly the persisted pilot report is `infrastructure-complete-external-execution-blocked`,
every rule remains `calibrated: false`, and every calibration/claim-readiness value remains false.
A green M2/M2d, M3-0 or M3-1 infrastructure run therefore says that the implemented apparatus and
frozen public inputs behaved as specified, not that a rule threshold has been validated against
independent human labels. The human annotation, external receipt and capture steps remain M3-1
execution gates; M4 remains future work.
The predecessor work item's three individual historical reviewer reports were not persisted and
cannot be reconstructed as evidence after the fact; only its contemporaneous archive record and
the current closure review are available. No replacement reports are inferred or backdated.

**Input identity remains bounded by L-07.** The report records the HTML hash, observed resource
status/bytes/hash and redirects, renderer/platform data and resolved font-family names. It does
not yet supply platform-stable `systemFontIds`, and canonical treatment of every dynamically
loaded resource is not complete. “Same input identity implies the same findings” is therefore
still an intended contract, not a guarantee over inputs outside the fields actually captured.
The process-tree and profile-cleanup behaviour has real macOS evidence; an equivalent empirical
Linux run is still missing, and Windows remains unsupported.

**The break cause comes from the paginator's own attributes, and the two alternatives are
measured-refuted rather than merely rejected.** Reading the browser cascade is wrong in 4 of 19
fixtures, because Paged.js resolves CSS with its own parser and the two diverge in both directions.
Reading the remaining fill of the page is worse: a FREE boundary in front of a tall unbreakable
block leaves 0.8542 of the page, while the smallest remainder at a FORCED boundary is 0.665 — so no
threshold separates the groups and there was never a number to calibrate.

Measured against Paged.js 0.4.3 for this build, on one document containing every kind at once:

| declaration | what the paginator writes | boundary |
|---|---|---|
| `break-before` via stylesheet class or id | `data-break-before="page"` | forced |
| `break-before: recto` | `data-break-before="recto"`, plus a blank page | forced, and the blank page is `parity` |
| `break-after` via class, id or `p.adj + p` | `data-previous-break-after="page"` on the node AFTER | forced |
| `page: named` | `data-page="named"` and **no break attribute at all** | forced — the third branch of `shouldBreak()` |
| `break-before` or `break-after` **inline** | nothing | **no boundary** — inert in 0.4.3 |
| nothing | a break token from `afterPageLayout` | overflow |

The named-page case is the one a partial implementation misses, and it is not hypothetical: a
reader that knows only the two break attributes calls that boundary free, and a free boundary in
front of a deliberately started page is exactly the false `layout/half-empty-page` finding this
classification exists to prevent. Deleting that branch reddens two live cases.

A fourth attribute exists and is deliberately not read. Paged.js also writes `data-break-after` on
the node that CARRIES the declaration; reading it would answer a question about a different
boundary whenever the declaring node is not the last one on its page.

**Every hook is counted, and that is a build requirement rather than diagnostics.** Paged.js wires
handlers by bare method-name equality — no interface, no registration list, no error for a name it
does not recognise. A typo in `afterPageLayout` is a silent no-op, and a silent no-op there means
no break tokens, every boundary classified `unknown`, and a report that looks clean.

**A named page is resolved through the nearest ancestor, and reading the leaf alone was wrong in
both directions.** A named region is normally declared on a container — `section.chapter { page:
chapter }` — and the paginator puts `data-page` on the SECTION, not on the paragraphs inside it.
Measured on a section spanning three pages: the leaf reported `null`, the ancestor reported
`chapter`. Reverting to the leaf-only read on the live fixture produces a **false `forced`** on a
boundary inside the region and **misses the real `forced`** on the boundary leaving it — the second
being the more expensive error, because a false `forced` silences four rules.

**A page the paginator never reported is `unknown`, not a page with default values.** A final page
with no `afterPageLayout` record used to receive a fabricated record and be counted nowhere, so a
page inserted after `afterRendered` was classified from whatever attributes sat on it. Such pages
are counted as `unreconciledPages` now, and the boundaries touching them are `unknown` — which
suppresses nothing, and is the direction in which uncertainty is cheap.

**Both edges of a blank page are `parity`.** §11.6 says so as an invariant on the page, while the
four-branch algorithm a few paragraphs earlier only asks whether the NEXT page is blank. Those two
disagree, and following only the algorithm gave the blank page `parity` incoming and `forced`
outgoing, because the page after it carries the recto declaration. The explicit invariant wins.

**The forcing comparison is exact.** An earlier version normalised with `trim().toLowerCase()`,
reasoning that the attribute comes from a third party. That is backwards — the attribute is written
by the paginator, which compares exactly. Measured: an author-written `data-break-before=" Page "`
produced no break at all, while the normalising version would have called such a boundary forced.

**Two limits of the freeze signature, measured rather than assumed.**

*Canvas content cannot be a drift signal.* A canvas drawn on before pagination reports ink and
reports exactly zero non-zero bytes afterwards — in the clone inside the page and in the
`<template>` where Paged.js parks the source. §11.3's drift table lists canvas content as newly
detected; §15.1b two sections later says the bitmap does not survive the clone. The second is what
this build measures. The component detects a canvas DIMENSION change, which does move layout, and
the report carries `canvasInkReadable: false` so that a reader can tell "readable and unchanged"
from "never readable at all" — which are identical inside a hash.

*Generated content is the declaration, not the rendered text.* §11.3 is right that a running
footer lives in `::after` with `textContent` empty. But `getComputedStyle` returns
`"page " counter(page)` unresolved, identically on every page, and no API returns a
pseudo-element's rendered text. A page number that changed between two samples would not move that
component. Its box would.

**The document is loaded by NAVIGATING to a loopback origin, and both reasons are measured.**
`setContent` does not install the primitives at all — CDP's on-new-document script never fires,
because `setContent` writes into the existing document; `window.__blPrimitives` came back
`undefined` and the collector threw. And a `file://` origin cannot read `cssRules`, which is where
the cascade hint comes from. The `setContent` half is pinned by a test that fails if it ever
changes; the `file://` measurement is recorded here and in the table below, but no test guards it —
saying "both are pinned" was an overstatement and it is corrected rather than quietly dropped.

**Source identity is part of the product path.** The live loader injects `data-bl-sid` into source
text before parsing and carries the resulting source map through snapshot assembly and evidence
binding. With `--no-source-map`, measurement continues without those attributes and source
locations/evidence binding are deliberately unavailable; source-null does not erase the stable
block identity used by rule fingerprints.

**Two limits of the evidence path that are known and not yet fixed.** The rasteriser holds a
whole rasterised document in the page while it compares, so peak memory grows with the page
count and a long book can exhaust it; the pixel buffers are dropped as soon as the comparison is
done, which halves the peak from that point on, but the comparison itself needs both documents
resident.

**The `file://` consequence is now measured, and it is narrower than the guess was.** This
paragraph used to say that a `file://` document with a linked stylesheet "may not expose its rules
to the paginator", reasoned from how the browser treats file origins and marked as not measured.
Measured, on a document with one linked sheet, in both origins:

| | `file://` | loopback origin |
|---|---|---|
| the rule APPLIES (computed value) | yes — `rgb(1, 2, 3)` | yes — `rgb(1, 2, 3)` |
| `sheet.cssRules` readable | **no** — `SecurityError` | yes |
| `break-before: page` visible in the CSSOM | no | yes |

Layout is therefore unaffected: the paginator lays a document out correctly from a file, because
applying a rule never requires reading it back. What is lost is the CSSOM — and the only thing
that reads the CSSOM is the cascade HINT, the field beside `breakCause` that this contract marks
as explicitly non-normative. A `file://` run would report `cascadeHint: null` and change nothing
else.

That still settles the loader — the document is served from the same loopback origin the
rasteriser already uses, so the hint exists at all — but the reason is one diagnostic field rather
than a wrong layout. Both numbers are written down because the difference between "the layout is
wrong" and "one non-normative field is null" is exactly the sort of thing that gets remembered as
the larger of the two.

**What that meant at this checkpoint.** `--demo` showed the rule and reporter chain over its
stored fixture. Passing HTML paths exercises the M2/M2d render path, and the report distinguishes
those two cases in its own `mode` and `source` fields rather than leaving the reader to infer it.

## What no amount of testing here establishes

Every threshold is uncalibrated. There is no corpus of real documents with human-checked truth
behind any of the then-fifteen numbers, so the fixtures showed that each rule *did what it said*, not
that what it says is the right thing to say about a real document. That distinction is the
difference between a verified implementation and a validated one, and only the first is claimed.

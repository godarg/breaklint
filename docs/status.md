# What is finished and what is not

This page exists because the alternative is worse. A layout checker whose green state means
nothing is more dangerous than no checker at all, so what has been measured and what has not is
stated here rather than left to be inferred from a passing test suite.

## Finished and verified without a browser

| | |
|---|---|
| 15 rules as pure functions over a snapshot | `src/rules/` |
| Mutation guard | 15/15 rules kill every mutant, each on a fixture that actually triggers it |
| False-alarm corpus | every clean fixture stays silent, every trigger fixture fires and is attributed correctly |
| Exit matrix | 28 rows over all five exit codes, all nine `failOn` rows and every precedence edge; each row asserts on exit code **and** verdict **and** `gateTriggeredBy` |
| Six output formats | each carries every mandatory counter, checked mechanically, including on a clean run |
| Licence gate | walks the whole of `node_modules`, so `dependencies`, `optionalDependencies` and the dev tree are all covered; a missing licence field fails |
| `npx breaklint --demo` | runs the real rule and reporter chain, exit 1, 8 findings across 7 rules |

## Finished and verified against a real browser

The evidence path — rasteriser, overlay, binding — runs against real Chrome, real Paged.js and
real `pdfjs-dist`. `npm run test:live` needs all four prerequisites including poppler's
`pdftoppm`, and a missing one FAILS the suite rather than skipping it: a suite that goes green by
running nothing makes every claim on this page look checked.

There is one way to turn that failure back into a skip, and it is written here rather than only in
the test file, because a property stated without its exception is a property overstated.
`BREAKLINT_LIVE_OPTIONAL=1` downgrades the missing prerequisite to a skip — and the run then exits
**0** with sixteen cases skipped. No measurement report is promoted and the reason is printed, but
the exit code is what a release gate reads, so the variable belongs to a local run on a machine
without poppler and nowhere else. Measured both ways: without it, exit 1 and `no measurement report
was written`; with it, exit 0, one pass, sixteen skipped.

| | |
|---|---|
| Rasteriser | `pdfjs-dist`, on a second page of the same browser instance, served over a loopback origin. No native canvas binding, no poppler in the product. |
| Rasteriser version | read from the library that loaded, and compared against the declared one |
| Local file access | measured, not declared: a document loaded from disk cannot read a neighbouring file (`BLOCKED: TypeError: Failed to fetch`). The browser-wide switch that used to allow it is gone, and the check is in the suite because removing the *reason* for a switch and leaving the switch is a mistake that was actually made here. |
| Ordering | measured at this product: with a content page open the rasteriser did not answer within the suite's 15 s window; with every page closed the same PDF came back with its pages, in 124 ms and 120 ms on two runs |
| Baseline | the unmarked PDF is produced BEFORE the overlay has ever existed, not by detaching it again |
| Binding | marked PDF against baseline PDF, compared on the PDF raster — not on a screenshot |
| Detach, not hide | the layer leaves the tree, so a presence selector stops matching |
| Own nodes only | layers and marks are held as references; nothing is found again by class name |
| Evidence files | one PNG per page; the header is read back out of the bytes and checked against the size the rasteriser reported. A page that fails that check withdraws the bindings of the whole document. |

**Measured over eight documents, two runs.** The measurement report has 219 leaf values, counting
every scalar and every empty object or array as one leaf, and no path appears in one run and not
the other.

The number of leaves that DIFFER between two runs is not a constant of this tool, and saying "one"
flatly was wrong. It is one when nothing outside the run changes: a wall-clock time (124 ms against
120 ms). A later pair of runs differed in two, because Chrome updated itself between them and
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
field is.

| Case | raster diff | style violations | binding |
|---|---:|---:|---|
| neutral | 0 | 0 | kept, 9 of 9 source blocks bound |
| layer background attacked | 0 | 0 | kept — the inline isolation absorbs it |
| document uses our own class names | 0 | 0 | kept, 11 of 11 source blocks bound |
| pseudo-element on the layer | 16 006 | 0 | lost |
| `:has()` on the layer's presence | 84 711 | 0 | lost |
| document mutates itself when the layer arrives | 54 969 | 0 | lost |
| document deletes our layer as fast as we attach it | 0 | 20 | lost |
| script rewrites the marks' style | 120 | 20 | lost |

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
late errors, the file-access switch — and 104 unit tests, 15 live tests and the mutation guard
stayed green through all four. The repairs were real; the gates were not there. They are now, and
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

## Not finished

**The live render path as a whole.** `src/acquire/render-run.ts` resolves the browser and
enforces the Paged.js version gate, and then stops with exit 3 and an infrastructure event
naming the stage. It does not return an empty snapshot and it never reports a clean document.

Still to build: the snapshot collection itself, and the loader that ties the pieces below into one
run. Until those exist there is no snapshot, so the evidence path above has no report to attach
itself to — it is exercised by its own live suite and by nothing else.

**Three pieces of the measurement path do exist and are checked against a real browser.** They
are listed separately from the finished work above because on their own they produce no report:

| | |
|---|---|
| Source provenance | ids injected into the source TEXT before parsing, with the map built from the parser's positions; the reserved-prefix collision gate refuses a document that already uses `data-bl-`, and reports what it searched as well as what it structurally cannot reach |
| Freeze signature | all seven components of §11.3, 250 ms window, 3 retries, and a drift report that names WHICH components moved |
| Untouched primitives | references captured before any author script runs. Measured: a document that replaces `getBoundingClientRect`, `getComputedStyle` and `querySelectorAll` after pagination sees `x:999` and `"HIJACKED"`, and the probe reads values byte-identical to a clean run across all seven components. The positive control is in the same test — a naive collector under the same attack loses its boxes entirely, 5 097 characters to 0 |
| Geometry cross-check | a sample compared against CDP `DOM.getBoxModel`, which reads the browser's layout tree out of process. The two agree EXACTLY on this corpus, twice; a systematic 0.002 px disagreement fails the suite |
| Break-cause collector | all five Paged.js hooks registered and each one verified to have fired; boundaries classified from the three attributes the paginator writes, on a document carrying six boundary kinds at once |

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
the cascade hint comes from. Both are pinned by tests that fail if either ever changes.

**What the evidence path does not yet get from the product.** The marks are placed on elements
carrying `data-bl-sid`. That attribute is injected into the source text before parsing, and that
injector is part of the probe. The live suite therefore supplies the attribute in its fixtures.
Everything downstream of the attribute is the production path; the attribute itself is not.

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

**What that means for a reader today.** `--demo` shows what the rules do and what a report looks
like. It does not show the render path, and the report says so in its own `mode` and `source`
fields rather than leaving you to assume.

## What no amount of testing here establishes

Every threshold is uncalibrated. There is no corpus of real documents with human-checked truth
behind any of the fifteen numbers, so the fixtures show that each rule *does what it says*, not
that what it says is the right thing to say about a real document. That distinction is the
difference between a verified implementation and a validated one, and only the first is claimed.

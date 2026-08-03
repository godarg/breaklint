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
| Exit matrix | 27 rows over all five exit codes, all nine `failOn` rows and every precedence edge; each row asserts on exit code **and** verdict **and** `gateTriggeredBy` |
| Six output formats | each carries every mandatory counter, checked mechanically, including on a clean run |
| Licence gate | walks the whole of `node_modules`, so `dependencies`, `optionalDependencies` and the dev tree are all covered; a missing licence field fails |
| `npx breaklint --demo` | runs the real rule and reporter chain, exit 1, 8 findings across 8 rules |

## Finished and verified against a real browser

The evidence path — rasteriser, overlay, binding — runs against real Chrome, real Paged.js and
real `pdfjs-dist`. `npm run test:live` needs all four prerequisites including poppler's
`pdftoppm`, and a missing one FAILS the suite rather than skipping it: a suite that goes green by
running nothing makes every claim on this page look checked.

| | |
|---|---|
| Rasteriser | `pdfjs-dist`, on a second page of the same browser instance, served over a loopback origin. No native canvas binding, no poppler in the product. |
| Rasteriser version | read from the library that loaded, and compared against the declared one |
| Local file access | measured, not declared: a document loaded from disk cannot read a neighbouring file (`BLOCKED: TypeError: Failed to fetch`). The browser-wide switch that used to allow it is gone, and the check is in the suite because removing the *reason* for a switch and leaving the switch is a mistake that was actually made here. |
| Ordering | measured at this product: with a content page open the rasteriser did not answer within 15 s; with every page closed the same PDF came back with its pages in 111 ms and 115 ms on two runs |
| Baseline | the unmarked PDF is produced BEFORE the overlay has ever existed, not by detaching it again |
| Binding | marked PDF against baseline PDF, compared on the PDF raster — not on a screenshot |
| Detach, not hide | the layer leaves the tree, so a presence selector stops matching |
| Own nodes only | layers and marks are held as references; nothing is found again by class name |
| Evidence files | one PNG per page; the header is read back out of the bytes and checked against the size the rasteriser reported. A page that fails that check withdraws the bindings of the whole document. |

**Measured over eight documents, two runs, 209 recorded leaf values, one of which differed
between the runs — a wall-clock time (111 ms against 115 ms).** Nothing else moved.

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

Marks were refound in the PDF with `max |Δx| = 0.0000 mm` and `max |Δy − mean| = 0.1439 mm`
against a stated tolerance of 0.35 mm; no mark failed to be found exactly once. The delivered PDF
was pixel-identical to a PDF of the same document produced on a page that never carried an
overlay — in all eight cases, including the five where the binding was lost. An independent
rasteriser (poppler, never a dependency of this tool) counted a difference on exactly the same
four and agreed in sign on all eight.

### What these runs do not establish, stated because it was nearly claimed

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
which would be about fourfold headroom. This build measures 0.1141 mm on its own document, so the
headroom here is about threefold. The number is unchanged; the margin is smaller than the
justification for it suggests.

### Two declared deviations from the normative contract

Both are in the safe direction — they withhold evidence, they never assert it — and both are
written here rather than left in a source comment, because a deviation nobody outside the file
knows about is a deviation nobody can overrule.

1. **The baseline PDF is taken before the overlay exists.** §11.4a.3 prescribes producing the
   unmarked PDF by detaching the overlay again. Measured: a document that mutates itself when the
   layer arrives leaves that change behind, both PDFs then carry it, the comparison reports zero
   and the damaged file is delivered as evidence-bearing. The contract's order cannot see its own
   failure case.
2. **A page needs at least two uniquely refound marks before its `Δy` criterion counts.** §11.4.3
   binds a target on one mark. With one pair the mean-relative deviation is zero by construction,
   so a mark placed anywhere at all would bind. The loss is confined to pages where exactly one
   mark could be refound; a normal single-fragment page carries two and is unaffected (measured).

## Not finished

**The live render path as a whole.** `src/acquire/render-run.ts` resolves the browser and
enforces the Paged.js version gate, and then stops with exit 3 and an infrastructure event
naming the stage. It does not return an empty snapshot and it never reports a clean document.

Still to build: the in-page measurement probe and the collector that reads the paginator's own
break attributes. Until they exist there is no snapshot, so the evidence path above has no
report to attach itself to — it is exercised by its own live suite and by nothing else.

**What the evidence path does not yet get from the product.** The marks are placed on elements
carrying `data-bl-sid`. That attribute is injected into the source text before parsing, and that
injector is part of the probe. The live suite therefore supplies the attribute in its fixtures.
Everything downstream of the attribute is the production path; the attribute itself is not.

**Two limits of the evidence path that are known and not yet fixed.** The rasteriser holds a
whole rasterised document in the page while it compares, so peak memory grows with the page
count and a long book can exhaust it; the pixel buffers are dropped as soon as the comparison is
done, which halves the peak from that point on, but the comparison itself needs both documents
resident. And the browser no longer runs with `--allow-file-access-from-files`, which is right
for an untrusted document but has a consequence for the not-yet-written document loader: a
`file://` document with a linked stylesheet may not expose its rules to the paginator. That
consequence is reasoned from how the browser treats file origins and is NOT measured here. The
resolution is to serve the audited document from the same loopback origin the rasteriser uses,
which is a decision for the loader and is recorded here so it is not discovered by accident.

**What that means for a reader today.** `--demo` shows what the rules do and what a report looks
like. It does not show the render path, and the report says so in its own `mode` and `source`
fields rather than leaving you to assume.

## What no amount of testing here establishes

Every threshold is uncalibrated. There is no corpus of real documents with human-checked truth
behind any of the fifteen numbers, so the fixtures show that each rule *does what it says*, not
that what it says is the right thing to say about a real document. That distinction is the
difference between a verified implementation and a validated one, and only the first is claimed.

# The burden of proof, and where it stops

Two error messages in this codebase send you here. `defineRule` (`src/core/rule.ts`) refuses a
rule that carries `severity: "error"` without a named proof source, and the registry
(`src/rules/index.ts`) refuses to load if the number of error rules is anything other than two.
This page is what those messages want you to read first, so that raising the number is an
argument rather than an edit.

It also records the reasoning behind the current limits. The short, user-facing list is
[`docs/known-limits.md`](../docs/known-limits.md); the limits recorded release by release are in
[`limitations-history.md`](limitations-history.md).

## Document time and memory

The live document acquisition budget defaults to 600000 ms and is configurable through
`--document-timeout-ms` or `documentTimeoutMs` in the JSON config, within 30000–1800000 ms.
Reaching it ends with exit 3 and a message naming the budget. The budget is a hard stop, not a
speed promise. Large paginated documents can consume substantial memory: the earlier G-18
measurement found about 15.7 MiB per page during comparison. No streaming or peak-memory
improvement is part of the budget change. A fresh 200-page memory measurement is required before
claiming that the default is adequate for that document size on a particular machine.

## Why exactly two rules may fail a build

Fifteen of the seventeen candidate rules are warnings; their observations require a reader judgment
or a chosen tolerance rather than an error-level proof. A
chosen number can be wrong for your document without anything being wrong with the
measurement, so those rules do not gate by default. Two rules compare a directly measured quantity
against a boundary that is not chosen at all — and only those two gate.

| rule | what makes the boundary structural |
|---|---|
| `layout/unbreakable-block-too-tall` | The block declares `break-inside: avoid` and is taller than the page content box. There is no page it can sit on. The comparison is between two measured lengths and the threshold is the medium itself. |
| `svg/text-overflows-viewport` | The text box, normalised through `getScreenCTM()`, lies outside the SVG viewport. What is outside the viewport is not drawn. The threshold is zero, not a preference. |

## The three proof classes

A rule may carry `error` only by naming one of these in its manifest, machine-readably, as
`proofSource`. The registry rejects `error` without one, and it rejects a proof source on anything
that is not an error — either the proof holds and the rule gates, or it does not and the claim goes.

**(A) Geometric invariant.** The rule compares two *directly measured* quantities against a
structural threshold — zero, or a physical limit of the medium. A freely chosen number is not an
invariant. Both current error rules are class A.

**(B) Cited norm with its boundary.** The rule cites a specific clause of a norm or specification,
*and* names the cases in which that norm says nothing, *and* ships a non-triggering fixture for each
of those cases. If the cited norm contains a relaxation clause, the rule must additionally show that
the relaxation did not apply in the case at hand. A rule that cites a norm and ignores its exception
has not satisfied B, it has asserted B. No rule claims B today: `layout/widow` and `layout/orphan`
cite the norm correctly and are still `warn`, because no fixture reaches their error path, and a
path no fixture reaches is unverified.

**(C) Resolution invariant.** The rule compares two *directly determined* address quantities — the
resolved target of a reference and the distribution boundary of the artefact — against a structural
in/out threshold, and ships a non-triggering fixture for every case where the target lies inside the
boundary and therefore travels with the artefact. **No rule claims C.** It is defined so that
`artifact/local-uri` has a clean route to `error` in a later version, not to leave a back door open
in this one.

A freely chosen threshold may never be `error`. The three classes are three ways for a threshold
to stop being freely chosen: A and C make it structural — zero, or a limit of the medium — and B
makes it *given*, by a norm that names the number and whose exceptions the rule has ruled out. A
rule that satisfies none of the three is at most a warning, however confident its author is.

This distinction matters because the word "uncalibrated" is doing two jobs elsewhere in this
project. It means: no corpus of human-labelled documents backs this number. That is true of all
seventeen registered candidate rules, including the two error rules — and it does not disqualify them, because their
numbers are not up for calibration in the first place. A block taller than the page fits on no
page; the threshold is the page. What calibration would decide is *where to draw a chosen line*,
and A, B and C are exactly the cases where no line was chosen.

**One more condition, and it is the one that actually bites.** A rule may carry `error` only if a
fixture that triggers exactly that error path exists in the corpus. This is what disqualifies the
widow and orphan rules — not doubt about the norm.

## Coverage floors

An `error` rule that could not measure everything it needed is not silently downgraded to a pass.
Coverage is reported per rule and floors apply by severity: `error` demands full coverage, `warn`
demands half, `info` demands none. Falling below the floor produces exit 4, `insufficient-coverage`,
which exists because of a measured case: a multi-column document once produced six pages analysed,
one rule run, five candidates, zero measured — and exit 0, indistinguishable from a clean run.

Configuration Contract v1 can make those floors stricter, but cannot lower them. The `strict`
profile sets every floor to 1. The two proof-source-A thresholds are not configurable at all:
turning a structural boundary into a caller preference would invalidate the reason those rules may
gate by default. The effective floors and their origins appear in the report (schema 3 from 0.2.3,
schema 4 from 0.5.0, schema 5 when the optional `remediation` was added to a finding); stored
snapshot fixtures moved to schema 3 in 0.2.3, when `inkCollected` was added, and to schema 4 in
0.5.0.

### What coverage is a ratio OF, and the two things it is not

Coverage answers a per-rule question about the DOCUMENT: of the candidates this rule ought to
have judged, how many did it judge? Cross-rule totals sum rule-candidate evaluations, not unique
objects or independent defects. A table evaluated by two rules contributes to both. Applicable
unmeasured evaluations are displayed separately from not-applicable and unavailable-tool counts. Two kinds of decline are therefore not in the denominator, and both are
enumerated in `src/core/enums.ts` rather than inferred from how a reason is spelt.

**A capability represented only in research code** (`TOOL_CAPABILITY_ENV_IDS`). The SVG ink passes
are not implemented in production. Version 0.3.1 therefore removes `svg/text-clipped` and
`svg/text-ink-collision` from the public registry instead of making their permanent decline part of
every user's coverage. The enum and the two modules remain for the frozen M3 validation lab; the
released CLI, schema and SARIF catalogue never run them.

**A question that does not arise** (`NON_APPLICABLE_ENV_IDS`). With `overflow: visible` an SVG's
text is painted whether or not it leaves the viewport, so `svg/text-overflows-viewport` has
nothing to decide about it — as with an SVG holding no text. One such figure would otherwise drive
an error rule below its floor of 1 and end the whole run in exit 4.

A third case is not a decline at all: a `<text>` that is not painted. Inside `<defs>`, `<symbol>`,
`<clipPath>` or `<pattern>`; under `display: none`; or hidden by `visibility: hidden`,
`opacity: 0` or a missing fill and stroke. None of it is a target of a rule about what the
viewport clips away, so none of it is counted or declined.

Both halves have to be measured rather than read off the markup. Chrome answers `getBBox()` and
`getScreenCTM()` for an element in `<defs>` and yields a box far outside the viewport, which a
gating rule will report as an error about something nobody can see — so the collector asks
`getBoundingClientRect`. And the invisible cases lay out perfectly normally and return a full
rect, so the empty-rect check does not see them at all — those come from the computed style. Each
was found by building the fixture for the previous one.

A `<text>` that IS laid out and still has no readable box declines with `env/svg-ctm-unavailable`
and DOES count against coverage — that is a measurement this tool owed and did not deliver, per
target rather than per SVG. The same fail-closed rule applies when a box exists but does not prove
the painted result: `<use>`, paint servers, text decoration, clip paths, masks and filters decline
with `env/svg-painted-bounds-unsupported`. Visible strokes do so unless a conservative outer bound
of the stroke fits wholly inside the SVG viewport.

Neither exemption leaves the report. Both keep their rule, reason and count in `notMeasured`, and
each rule's own books are still checked first: `defineRule` requires measured plus declined to equal
candidates, and only afterwards does the engine subtract. A decline that names a property of the
INPUT — `env/multicolumn`, `env/svg-ctm-unavailable`, `env/svg-too-many-text-targets` — stays in
the denominator, because another document would have been measured. That is what exit 4 is for,
and `tests/unit/coverage-base.test.ts` holds both halves of the pair so that widening the
exception to cover the second kind turns a test red.

## What no amount of testing here establishes

**Two research rules are not product rules in this build.** `svg/text-clipped` and
`svg/text-ink-collision` need isolated, stable SVG pixel passes, which remain M3 work. Their modules,
fixtures and renderer lab are retained so the work is not erased, but they are absent from
`ALL_RULES`, configuration, SARIF and the demo. The candidate registers seventeen rules; these two research modules are not among them.
`svg/text-overflows-viewport` needs only geometry and does measure.

**Complex SVG paint is detected but not geometrically solved in this build.** `querySelectorAll`
does not cross the instance tree created by `<use>`, and `getBBox()` does not include stroke,
clipping, masks or filter effects. The collector detects those entrances and keeps each as an
unmeasured candidate unless the narrow stroke proof below applies. Because the viewport rule is an
error rule with a coverage floor of 1, even one undecidable target produces
`insufficient-coverage` (exit 4), never a silent clean result or a guessed error. Full support
belongs to the independent ink passes.

*What this costs on a real document, measured.* The entrance that fires in practice is not `<use>`
or a filter — it is the **halo**: `paint-order="stroke fill"` with the stroke set to the background
colour, the standard way to keep a diagram label legible where it crosses a line. Over an
eighteen-document reference set of illustrated chapters:

| document | `<text>` candidates | measured | declined | trigger |
| --- | --- | --- | --- | --- |
| 03 | 30 | 30 | 0 | — |
| 05 | 24 | 24 | 0 | — |
| 09 | 23 | 20 | 3 | 3 haloed labels |
| 02 | 45 | 30 | 15 | 15 haloed labels |
| 07 | 27 | 10 | 17 | 17 haloed labels |

Read the first two rows before the last three: inline SVG text is **not** structurally unmeasurable
here, and a document whose labels carry no visible stroke measures at coverage 1. The table is a
dated pre-change measurement: then every visible stroke declined because `getBBox()` returns the
fill outline, not the ink. Three haloed labels were enough to make the error rule end exit 4.

G-114 admits only a finite CSS-pixel stroke width, known cap and join, finite miter limit, no
descendant paint override, vector effect, or text/inner-ancestor transform, and an intact CTM. It
expands the local box by a deliberately conservative radius using the full
`stroke-width × stroke-miterlimit` for miter joins (the [SVG 2 painting definition](https://www.w3.org/TR/SVG2/painting.html#StrokeLinejoinProperty)
defines the ratio), carries that envelope through the CTM, and
measures only if all four sides remain strictly inside the viewport. A boundary-touching halo
stays `env/svg-painted-bounds-unsupported` and still causes exit 4. This proves containment for
that narrow case; it does not identify painted bounds exactly or turn a partly outside stroke into
a finding. A painted stroke on a `<tspan>` or other descendant declines even if the outer `<text>`
has `stroke="none"` or no paint of its own; descendant paint remains a candidate, never a silent
clean result. The dated corpus counts above are not a claim about current coverage.

**Nontrivial viewport boxes are detected but not reconstructed.** `getBoundingClientRect` is the
border box and becomes only an axis-aligned envelope under rotation or skew. An SVG root with
border, padding, rounded clipping or a nonzero overflow clip margin therefore declines, as does an
SVG whose own or ancestor CSS transform geometry is nontrivial (`transform`, the individual
`rotate`/`scale`/`translate` properties, perspective or motion path). The reason is
`env/svg-viewport-geometry-unsupported`. Ordinary axis-aligned SVG roots remain measured. A later
content-quad implementation needs its own transform-aware live proof.

**Every threshold is uncalibrated.** A [human evaluation of ten selected real pages](evaluation-0.10.md)
now supplies bounded labels and feedback. It does not establish a representative truth corpus
behind the seventeen candidate rules. The fixtures show that each rule does what it says; they do not
show that what it says is the right thing to say about your document. That is the difference between
bounded implementation/renderer validation and accuracy across independent real documents;
only the named bounded checks and selected human examples are claimed. `calibrated: false`
travels in the type, in every finding and on every rule page for that reason.

**A document whose paginator could not place its content is not measured at all.** Paged.js
fragments a page by making `.pagedjs_page_content` a multi-column container whose pitch is the
content width plus a gap of `margins + bleed + 1000px`. What it fails to move onto a new page stays
in the second column, one pitch to the right, invisible behind an `overflow: hidden` sheet. Where
that content is a table box, `page.pdf()` — which renders in print media, with a re-sized
fragmentainer — puts it somewhere else and leaves it there, so the PDF does not reproduce the
geometry the rules measured. The run ends in exit 3 with `render-unstable`, and the event names the
elements, their source ids, the pages and the column pitch. It is not a rule finding and cannot
become one: nothing about the pages that DID lay out is reported, because the state they were
measured in was withdrawn.

Measured over eighteen chapters of one shipped HTML bundle: 6 of 6 documents with table residue in
an overflow column could not be measured, 12 of 12 without it could. Two of those twelve carried
residue of other kinds — one `<p>`, one `<em>` — and measured cleanly, because ordinary block
content re-fragments to the same boxes. Nothing exotic produces this: no `@page`, no print
stylesheet, no `break-inside` and no script are needed, only a table that crosses a page boundary.

The six documents are recorded, not published. They are chapters of a paid product, and this
repository is public and MIT, so `corpus/public/pagination-residue-v1` keeps their SHA-256 values,
rights and privacy review and exact expected residue while their bytes stay outside it —
the `private_nonredistributable` shape of `maintainers/validation/corpus-contract-v1.md`. That record is
now historical: re-measured on 2026-09-18, five of the six documents and their shared stylesheet no
longer exist at the recorded digests, so nobody can run its private half. `npm run
test:pagination-residue` prints `NO CLAIM` and reads none of the six, with or without
`BREAKLINT_RESIDUE_CORPUS_ROOT`, and it is no longer a CI or release step — a step that exits 0
having read zero documents would be a green light over nothing. What holds this class in CI is the
public `tests/fixtures/fragmentainer-residue.html` in the live suite, reduced from one of the six
until no product text remained; the reduction is itself the measurement that nothing exotic is
required.

**Rendering is not reproducible across machines.** Browser rendering varies with the host operating
system, browser version, settings, hardware and headless mode. PNG output here is evidence, never a
comparison basis, and no check compares output file hashes.

**Findings depend on font availability.** A missing `@font-face` changes metrics, line breaks and
page breaks, and can turn a correct page into a phantom finding. The run waits for
`document.fonts.ready` and stops with a non-zero exit if a declared font resource fails, rather than
reporting findings it cannot stand behind.

**Missing image content is a named limitation, not a silent success.** A failed decode is non-fatal
only when the HTML declares positive `width` and `height` attributes and Chrome measures a box
exactly equal to both values. The report then carries `image-content-unavailable`, a resource index
and both declared and rendered dimensions without persisting the URI. Missing dimensions,
replacement-text geometry, zero-size boxes or authored CSS that changes the box remain fatal
because the absent pixels can change layout.

**One paginator version.** Paged.js is pinned to exactly 0.4.3, because the break cause is read from
attributes the paginator writes into the tree and does not guarantee as an interface. Any other
resolved version stops the run with exit 3, and no flag overrides it.

**Windows is not supported.** Process termination rests on POSIX process groups; the termination
and profile-cleanup path has real evidence on macOS only, and Windows job objects are neither
designed for nor measured.

**Linux was unmeasured, then measured, and what it showed was a defect.** The first public CI run
failed: the evidence binding broke on every document, because the marks shared a font with the
document's own text and the resulting font-subset difference registered as contamination. The
cause is fixed, and the fix is measured — the full live suite, 57 cases including the hostile
corpus and the independent rasteriser cross-check, is green in a Linux container (arm64, Chromium
151, poppler 22.12), against 15 red cases with the fix removed.

That is no longer only a container result: the fixed commit has since run on the x86_64 CI
runner, where the same step that reported the defect now passes. What remains true is narrower —
the process-termination and profile-cleanup path has empirical evidence on macOS only. Linux is
measured for the measurement chain, not yet for the process lifecycle.

There is deliberately no `os` field in `package.json`, which means npm will install this on
Windows without complaint. That is not an oversight: `--demo` and the whole rule and reporter
chain need no browser and no process group, so they work there. What does not work is a run over
your own HTML. Blocking the install would take away the part that functions in order to prevent
the part that does not, and the part that does not already fails loudly rather than quietly.

**Non-HTML input is refused by its name, not by its content.** An input path that does not end in
`.html` or `.htm` — Markdown, PDF, a standalone SVG — ends with exit 2 and `unsupported input type`
before any renderer starts and before the path is even opened; measured for a `.md` file, existing
or missing: exit 2, nothing on stdout. A path that is not a regular file — a directory called
`chapter.html`, for instance — is refused the same way with `input is not a regular file`; through
0.6.0 it passed both checks, started Chrome and ended exit 3 with "resource byte limit exceeded".
The content of a `.html` file is not sniffed. Markdown text
saved under a `.html` name is served and parsed as HTML: one run of body text with no element in
it. Such a run then ends with exit 3 and `geometry-cross-check-failed` ("measured no elements"),
because a cross-check over zero elements is not a passed cross-check (`src/measure/cross-check.ts`)
— measured locally on Chromium 141 with the evidence binding off; the zero-sample rule itself does
not depend on the browser. A converter's HTML output is ordinary HTML and is measured as such. The
paragraph that stood here through 0.6.0 described a Paged.js `pagination aborted` exit 3 for a
Markdown file; that path is gone, because the name check runs first.

**Foreign HTML is executed, and the offline policy is not an egress control.** The run uses a
fresh browser profile, never asks for the sandbox to be off, and intercepts the page's requests,
letting through only its own loopback origin (plus `data:`, `blob:`, `about:` and any
`--allow-network` origin). Interception does not cover WebSocket, WebTransport or WebRTC
connections a document opens, nor the browser's own traffic — secure DNS (DNS over HTTPS) and the
component updater. Measured on 0.7.0 in the default offline mode with a self-authored document: a
WebSocket to a loopback port that was not the tool's was delivered, a WebRTC STUN request was sent,
and the run came back `clean`. In 0.8.0, breaklint refuses to launch if
`PUPPETEER_DANGEROUS_NO_SANDBOX` or `PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES` is present, and
removes `CHROME_EXTRA_FLAGS` from Chrome's child environment. This closes those known environment
paths; other wrapper variables are not generally audited. For a document you do not trust, run
breaklint in a container or network namespace with no egress. The GitHub Action's empty
`allow-network` input applies this same interceptor policy; it does not make the runner fully
offline. See [SECURITY.md](../SECURITY.md).

The longer, measurement-by-measurement account of what has been established and what has not is in
[status.md](status.md).

## The break cause of a page boundary

A `forced` boundary records a decision made by Paged.js; its rationale and author intent are
unknown without verified source/design evidence. `layout/widow` declines the fragment opening
after it, `layout/orphan` the fragment closing before it and `layout/orphaned-continuation-page`
the page after it (`env/forced-break`, counted against coverage). Experimental half-empty-page
also declines an outgoing forced low-coverage case when it has no late start. A natural document
ending is measured without a low-coverage warning. Neither outcome labels author intent.

**The cause is the decision Paged.js' `shouldBreak()` took, evaluated again at the break token.**
When a page is laid out, Paged.js 0.4.3 hands the collector a break token naming the node of its
parsed source at which the next page starts. The collector evaluates the three clauses of
`shouldBreak()` there, with the paginator's own rules: the node's `data-break-before` (unless it
repeats its parent's and no node precedes it), its `data-previous-break-after`, and
`needsPageBreak()`, which compares the named page in force at the node (its own `data-page`, else
its nearest ancestor's) with the one in force at the node **before** it — a previous sibling, or an
ancestor's previous sibling, whose named page comes from itself and its ancestors, never from its
descendants. Only a token at the node the layout walker handed out last on the page can be
forced — layout.js asks `shouldBreak()` about each node it walks, immediately before laying it
out, and breaks at that node — so the collector records it from the `layoutNode` hook. A token
that points into a node (an offset) was not forced: `shouldBreak()` was asked of that node where it
started. Nor was a token at a node the walker never handed out: Paged.js deep-clones `p`, `li`,
`td`, `dd`, `dt`, `blockquote`, `h1`–`h6`, `pre` and `figcaption`, so a `break-before` or `page:`
on a block inside one is never evaluated, and an overflow can still end a page exactly at that
block. Measured: a list whose items each hold a `break-before: page` box classified as forced at
every such overflow, 36 widow and 36 orphan candidates declined and exit 4, against the same list
without the declaration at exit 0; now both end exit 0 with the same findings. The boundary is then, in this order: `parity` when the next page is
blank; `unknown` when there was no token or it carried no node; `forced` by a forcing break-before,
break-after or named-page difference; `overflow` otherwise. `unknown` suppresses nothing.

**Two readings of the finished pages were measured wrong, and neither is used.** Through 0.6.0 the
named page was taken from each page's first source-bearing node, which on a real document is
usually a wrapper — `<main>`, `<article>` — continuing from the page before, with no named
ancestor: every boundary inside a named region and the one after it read as `forced`, and the
boundary into the region as `overflow`. Measured on a self-authored report with a landscape region
(patched Chromium 141, no evidence binding): 9 of 14 widow and 9 of 14 orphan candidates declined
as `env/forced-break`, both below the coverage floor, exit 4; now 2 of 14 each, at the two
boundaries the paginator forced. A first repair compared the named pages
the two pages were **styled** with — the `pagedjs_<name>_page` classes on the page element — and
that is not the paginator's rule either: the classes record which `@page` rule a page got, not
whether a break was forced. `<div><section style="page: chap">…</section></div><p>` does not break
on leaving the section, because the paragraph is compared with the `<div>`, and it is laid out on
the `chap` page; the next overflow boundary, where the page style changes, was then called
`forced`. The same first-node read also missed a `break-after` whose following element sits inside
a continuing wrapper, and one followed by loose inline content: Paged.js puts
`data-previous-break-after` on that following element, which may be an `<em>` at the head of the
page. The live suite checks every boundary of its named-region documents against Paged.js' own
`shouldBreak()` answers, recorded by a test-only wrapper around it.

What remains:

- **It reads Paged.js internals.** The token's node, the three attributes Paged.js writes into its
  parsed source and the shape of `shouldBreak()` are not an interface; the version pin above is
  what bounds that.
- **A page Paged.js inserts for parity has no token**, so the boundary out of it has no decision
  of its own; both edges of a blank page are `parity` by the page rule.
- **An element hidden with `display: none` and carrying `page:` still breaks.** Paged.js compares
  its named page like any other element's, so the page it would have started is forced although
  nothing visible starts there, and the tool reports the break as `forced` because that is what
  the paginator did.
- **A `break-after` reason names the last source node before the boundary**, which is the element
  that declared it only when that element ends its page itself — a paragraph, not a section
  around it. A forced boundary's reason otherwise names the nearest source-bearing element at the
  token's node: an inline element carries no source id, so a break at an inline named page names
  the paragraph it is in. The classification does not depend on the reason.

## Raising the number of error rules

The registry's literal `2` is not a constant to be updated when a sixteenth rule feels important. To
change it: name the proof class, ship the fixture that reaches the error path, ship the
non-triggering fixtures the class requires, add the argument to this page, and only then change the
number. The failing registry check is the reminder that the order matters.

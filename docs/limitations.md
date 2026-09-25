# The burden of proof, and where it stops

Two error messages in this codebase send you here. `defineRule` (`src/core/rule.ts`) refuses a
rule that carries `severity: "error"` without a named proof source, and the registry
(`src/rules/index.ts`) refuses to load if the number of error rules is anything other than two.
This page is what those messages want you to read first, so that raising the number is an
argument rather than an edit.

It also states, in one place, what this tool does not know.

## Why exactly two rules may fail a build

Eleven of the thirteen released rules compare a chosen threshold against a real measurement. A
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
thirteen released thresholds, including the two error rules — and it does not disqualify them, because their
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

Coverage answers a question about the DOCUMENT: of the targets this rule ought to have judged,
how many did it judge? Two kinds of decline are therefore not in the denominator, and both are
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
the painted result: `<use>`, visible stroke, paint servers, text decoration, clip paths, masks and
filters decline with `env/svg-painted-bounds-unsupported`.

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
`ALL_RULES`, configuration, SARIF and the demo. The released rule count is thirteen.
`svg/text-overflows-viewport` needs only geometry and does measure.

**Complex SVG paint is detected but not geometrically solved in this build.** `querySelectorAll`
does not cross the instance tree created by `<use>`, and `getBBox()` does not include stroke,
clipping, masks or filter effects. The collector now detects those entrances and keeps each as an
unmeasured candidate. Because the viewport rule is an error rule with a coverage floor of 1, even
one such target produces `insufficient-coverage` (exit 4), never a silent clean result or a guessed
error. Full support belongs to the independent ink passes, not to an expansion guessed from style.

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
here, and a document whose labels carry no visible stroke measures at coverage 1. What is
unmeasurable is a `<text>` that paints a stroke, because `getBBox()` returns the fill outline and
the tool refuses to judge an overflow against a box that describes different ink. Three haloed
labels are enough to take an error rule with a floor of 1 to exit 4, which is why one such figure
reads in the report as though the whole class had failed.

The named next step is not the ink pass. A stroke centred on the glyph outline gives a **two-sided
bound** for nothing but the stroke width: the fill box is a lower bound on the painted box and the
fill box inflated by `stroke-width / 2` is an upper bound. A target whose lower bound already
leaves the viewport overflows for certain; one whose upper bound is still inside it does not
overflow for certain; only the band between them stays undecidable. On the corpus above the halo
strokes are 2–4 px against overshoots that matter at ten times that, so almost all 35 declined
targets are decidable without an ink pass at all. This is a named gap, not a design position.

**Nontrivial viewport boxes are detected but not reconstructed.** `getBoundingClientRect` is the
border box and becomes only an axis-aligned envelope under rotation or skew. An SVG root with
border, padding, rounded clipping or a nonzero overflow clip margin therefore declines, as does an
SVG whose own or ancestor CSS transform geometry is nontrivial (`transform`, the individual
`rotate`/`scale`/`translate` properties, perspective or motion path). The reason is
`env/svg-viewport-geometry-unsupported`. Ordinary axis-aligned SVG roots remain measured. A later
content-quad implementation needs its own transform-aware live proof.

**Every threshold is uncalibrated.** There is no corpus of real documents with human-checked truth
behind any of the thirteen released numbers. The fixtures show that each rule does what it says; they do not
show that what it says is the right thing to say about your document. That is the difference between
a verified implementation and a validated one, and only the first is claimed. `calibrated: false`
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
the `private_nonredistributable` shape of `docs/validation/corpus-contract-v1.md`. That record is
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

**Foreign HTML is executed.** The run uses a fresh browser profile, keeps the sandbox on, has no
flag that disables it, and blocks every network request by default. That is protection against
mistakes and badly built documents, not against a deliberate attack on the browser sandbox. See
[SECURITY.md](../SECURITY.md).

The longer, measurement-by-measurement account of what has been established and what has not is in
[status.md](status.md).

## The break cause of a page boundary

A `forced` boundary is a decision the author made, so `layout/widow` declines the fragment that
opens the page after it, `layout/orphan` the fragment that closes the page before it and
`layout/orphaned-continuation-page` the page after it (`env/forced-break`, counted against
coverage), and `layout/half-empty-page` does not call a last page it opened "likely intended".
The cause is read from what Paged.js 0.4.3 wrote, in this order: a blank next page is `parity`; a
forcing `data-break-before` or `data-previous-break-after` in force at the node that **starts** the
next page — its first source-bearing node that is not a `data-split-from` continuation clone — is
`forced`; a change of named page is `forced`; a break token is `overflow`; anything else is
`unknown`, which suppresses nothing.

**The named page of a page is the one Paged.js applied to it, read from the page element.**
Paged.js records it only as classes on `.pagedjs_page` — `pagedjs_named_page` and
`pagedjs_<name>_page` — never as `data-page` on the page. A name counts when the page element
carries its class **and** the page area holds an element with that `data-page`, because the class
vocabulary is shared: `pagedjs_named_page` is on every named page and `pagedjs_first_page` on page
1, so the class alone would give a page named `named` or `first` to pages that are not. Through
0.6.0 the name was taken from the page's first source-bearing node instead, and on a real document
that node is usually a wrapper — `<main>`, `<article>` — continuing from the page before, with no
named ancestor. Every boundary inside a named region and the one after it then read as `forced`,
and the boundary into the region as `overflow`. Measured on a self-authored report with a landscape
region (patched Chromium 141, no evidence binding): 9 of 14 widow and 9 of 14 orphan candidates
declined as `env/forced-break`, both below the coverage floor, exit 4; with the page-element read,
2 of 14 each, at the two boundaries the region really forces. The same document on the corpus
gate's current Chrome had 13 declines of each and widow coverage 8 of 21.

The same first-node read hid a `break-after` on an element inside such a wrapper: Paged.js puts
`data-previous-break-after` on the element after the declaring one and strips it from continuation
clones, so the wrapper clone in front of it carried nothing and the boundary read as `overflow`.
(`data-break-before` was found anyway, because Paged.js also copies it onto the page element; its
reason named the wrapper.) Both are read from the node that starts the page now.

What remains:

- **A page carrying two named pages.** Paged.js applies both when a named element is laid out at
  the top of a page inside another named region, before any content. Each edge of such a page is
  resolved by the name in force at its edge node, and only among the names applied to it; an edge
  that resolves to none of them makes the boundary `unknown`, reported as
  `break-cause-undetermined`, rather than a guessed change.
- **A `break-after` reason names the last source node before the boundary**, which is the element
  that declared it only when that element ends its page itself — a paragraph, not a section
  around it. The classification does not depend on it.
- **A page on which nothing starts** — the middle of one block taller than a page — has no node
  that opened it, and its attributes are read from its first node. Paged.js puts no break
  attribute on such a page.
- **All of it rests on names Paged.js does not guarantee** — the classes, the three attributes and
  `data-split-from`. The version pin above is what bounds that.

## Raising the number of error rules

The registry's literal `2` is not a constant to be updated when a sixteenth rule feels important. To
change it: name the proof class, ship the fixture that reaches the error path, ship the
non-triggering fixtures the class requires, add the argument to this page, and only then change the
number. The failing registry check is the reminder that the order matters.


## Source-bound 0.5.0 limits

The expanded robustness review is **partial**. Real Digital Product Studio inputs and independent third-party template groups were exercised, but not all admitted candidates paginated successfully. Some W3C/Alice candidates stop with DOM/PDF divergence, pagination residue or source-order mismatch. These are nonmeasurement results. Version 0.5.0 does not claim a complete broad-template robustness pass or increase calibration/trust status.

The screen profile measures the **currently visible viewport rectangle**, including when a full-page screenshot is requested. Below-fold nodes are explicitly excluded; the host must open and check additional scroll states. Authored scroll containers and intentional overlays use named exceptions. Source binding is a verified host-build container when supported, not a JSX line-level source map. Screen reports have no automatic `resolved` repair-comparison path.

Document repair comparison is limited to preserved, unambiguous author anchors, a compatible complete document set, verified local Git continuity and captured actual font identity. Page-only findings remain unmatchable; system/fallback font identity and reduced or absent measurements prevent a repair claim. CSS resources must be captured as dependency/asset inputs; the host's authoring documents are not a resource allowlist.

The real Studio repair attempt was performed by an independent agent. No fresh human usability trial, two-week field trial or measured long-term time saving is claimed. The technical surface gate and visual agent review do not replace the separate human surface ledger.


## 0.6.0 limits

**A per-fragment applicability decision can be silent about a property of the whole element.**
`layout/unbreakable-block-too-tall` skipped every fragment after the first and therefore compared
the height of a *piece* against the page. Measured on 2026-09-18: a six-page `break-inside: avoid`
section came back `clean` at exit 0, fragment 0 reading 596.36 px against a 680.31 px page. That
particular rule now sums its fragments. The **class** is not closed: every rule in this registry
decides applicability per fragment, and any future rule whose quantity belongs to the element
rather than to the piece can repeat this. There is no gate that detects the shape; what caught this
one was a red control that had quietly stopped being red.

**Nothing printed in a page margin box is measured by any block, line or page rule.** Paged.js
implements `position: running(...)` by deep-cloning the element into the margin box of every page,
and `position: fixed` by cloning it into every page box; both clones keep the injected source id.
The collector used to gather blocks from the whole `.pagedjs_page`, so every clone became one more
"fragment" of its source block. Measured on 2026-09-24 with Paged.js 0.4.3: a six-page document
with a one-line running title and an eight-line side running element carried seven records per
element and reported ten `layout/widow` and `layout/orphan` warnings, every one about a clone; under a running header,
the blank page a `break-before: recto` inserts was not blank, both of its boundaries came out
`overflow`/`forced` instead of `parity`, it drew a `layout/orphaned-continuation-page` finding, and
every page was anchored to the header, so three `layout/half-empty-page` findings on three pages
shared one fingerprint. An earlier repair of the one symptom that could fail a build —
`layout/unbreakable-block-too-tall` summing the clones — decided flow membership in that rule by
coordinates, and that test also discarded every fragment of a full-bleed block (see below).

The snapshot, the collector and the evidence overlay now all keep only source blocks inside a
page's content area, `.pagedjs_pagebox > .pagedjs_area`. That area holds the page content **and the
footnote area**: footnotes stay part of the page they are printed on, as before. It is an inclusion
test on the page structure rather than an exclusion by class name, so author markup that happens to
carry a `pagedjs_margin` class does not leave the flow, and a page with no content area stops the
run (exit 3) instead of being measured as empty. What that leaves unmeasured, stated because no rule
reports it:

- **Margin-box content.** A widow, an oversized block or an unfilled band inside a running header or
  footer is not judged. Generated margin content (`@top-center { content: "…" }`) never was.
- **A running element keeps exactly one record**: the in-flow original Paged.js leaves in the page
  content with an inline `display: none`. Snapshot 5 records each block's computed `display` and how
  many margin-box copies of it Paged.js printed (`marginCopies`), so the block rules that could
  select the original — `layout/unbreakable-block-too-tall`, `layout/heading-at-page-bottom`,
  `type/excessive-word-spacing` — record it as `excluded` with the reason
  `rule/target-in-margin-box`, outside the coverage base, and never as measured. Until this repair
  it counted as measured at 0 px, and a document whose only avoid block was a running element
  reported full coverage for a check that looked at nothing. An element the author hid
  (`display: none`, no margin copies), or one inside a hidden subtree or a closed `<details>`, is
  `rule/target-not-rendered`. The type rules still read a running element's source text once,
  attributed to that hidden position, where there is no box for evidence to mark. A page is
  anchored to its first rendered block, so the hidden original never anchors one.
- **A `display: contents` block is judged by what it prints, never by its zero box.** It generates
  no box of its own while its text and children are laid out. `layout/unbreakable-block-too-tall`
  asks about a box, and `break-inside` does not apply to an element without one, so such a block is
  `not-applicable` with the reason `rule/target-generates-no-box`, outside coverage; its children
  are candidates in their own right. (An unreleased intermediate state declined it against
  coverage instead, and a key/value grid whose `li` items were flattened with `display: contents`
  under a print rule `li { break-inside: avoid }` ended exit 4 with twelve declines, where it had
  ended exit 0.) An
  image-only `display: contents` figure is the same case, not an unrendered one.
  `layout/heading-at-page-bottom` places such a heading, and a block below it, by its visible line
  boxes; with no visible line but recorded lines it is excluded as `rule/target-not-visible`, and
  with no line or unrecorded lines it is declined as `env/invalid-measurement`, counted.
  `type/excessive-word-spacing` reads the visible lines of every block: lines that are all
  invisible are `rule/target-not-visible`, a block with no line at all (empty, or image-only) is
  `rule/no-text-lines`, and lines the snapshot did not record are declined as
  `env/invalid-measurement` — never a measurement of factor 0.
- **A box of zero by zero is not by itself "not rendered".** A block counts as not rendered only
  when the snapshot shows nothing printed from it: `display: none`, or recorded lines none of which
  is visible (an element inside a hidden subtree or a closed `<details>` has no line box). A
  zero-size block that is neither — `width: 0; height: 0; overflow: visible` prints its text
  outside the box, or its lines were not recorded — is placed by its visible lines where the rule
  reads positions (`layout/heading-at-page-bottom`, and the continuation rule's flow), measured
  from its lines by `type/excessive-word-spacing`, and declined as `env/invalid-measurement`,
  counted, by `layout/unbreakable-block-too-tall`, whose question is the height of a box that
  printed nothing of its own. A line is visible when any text on it is: visibility is read from
  each text node's element, so `p { visibility: hidden } span { visibility: visible }` prints and
  is measured. What remains: `layout/unbreakable-block-too-tall` still reads the BLOCK's own
  visibility, so a hidden block with a visible descendant is excluded there as not visible.
- **A split block is judged at the first fragment that printed.** `layout/unbreakable-block-too-tall`
  takes the block's lead fragment to be the first one laid out with a box of its own and visible,
  joined by source id; earlier fragments are recorded `not-applicable` as
  `rule/fragment-not-rendered`. Measured on 2026-09-25 with hostile documents: a script that set
  `display: none` on only the first fragment of a four-page avoid block, or marked it as a note and
  moved it into the footnote area where it has no box, hid the whole block (exit 0, where the base
  reported it at exit 1), because the later fragments were skipped as continuations of an excluded
  candidate. What remains: a script that hides EVERY fragment hides the block, which is then also
  not printed; a script that changes the first printed fragment's own `break-inside` changes the
  question the rule asks; and a two-fragment block whose first fragment is hidden is judged by the
  second fragment's box alone, as every two-fragment block is (see the rule page).
- **A `position: fixed` element is not measured at all.** Paged.js removes it from the flow, so there
  is no in-flow original, and its per-page clones are outside the content area. (An element whose
  `position: fixed` is an INLINE style is not recognised by Paged.js at all: it stays in the flow,
  is measured there, and is painted at the viewport origin, where its evidence marks cannot be
  placed.)
- **Markup that reproduces the page structure inside a running element comes back into the flow.**
  The test asks whether an element has an ancestor that is the area child of a page box. A running
  element whose own markup contains `<div class="pagedjs_pagebox"><div class="pagedjs_area">` makes
  its descendants pass that test in every margin-box clone, so they are measured once per page again
  — the pre-repair behaviour, with its false `layout/widow` findings and shared fingerprints, for that markup only.
  It cannot hide flow content from measurement: that would need an element of the real content area
  to lose the ancestor it has. A class name alone (`pagedjs_area` without the page-box parent) does
  not pass the test.
- **Inline SVG inside a margin box is still collected once per page, and SVG text there stops the
  run.** The SVG collector still reads the whole page, so a running element that contains an SVG
  contributes one SVG record per page, all with one key. When that SVG carries `<text>` and the
  element repeats on two or more pages, every clone carries the same injected target id,
  `svg/text-overflows-viewport` sees one target evaluated twice, and its accounting invariant ends
  the run `checker-crashed` (exit 3). Measured on 2026-09-24 on a three-page document with a
  running logo; it predates the flow repair above and is not changed by it.
- **Footnotes are in the flow, but a document with footnotes does not reach the rules.** Measured on
  2026-09-24 with the real paginator: a block footnote moved into the footnote area is recorded on
  its page and is an edge of that page's flow, and the source-id check accepts its position after
  the page content (`tests/live/breaks.test.ts`). The production run stops before any rule, though:
  Paged.js gives each footnote call an `href` built from the paginator's per-run random `data-ref`,
  the paired control run reads that as a changed resource, and the run ends
  `injection-interference` (exit 3). That holds for block and inline footnotes alike, before this
  repair and after it. Before it, a block footnote already stopped the run one step earlier, at
  the source-id order check.

**The source-id integrity check reads the order of the flow; copies outside it are checked for
identity, presence and the signature of the Paged.js step that put them there, not for order.**
Paged.js puts three kinds of copies out of source order: a running element's clones in the margin
boxes (which come before the content area in every page box), a block footnote in the footnote area
(after the page content) and a `position: fixed` clone at the head of every page box. The check used
to read every source id in the document in document order, so a running title that was not the
first element of the source — a heading before it, or a section around it — ended the run
`checker-crashed` (exit 3). What still fails the run: any attribute change of a reserved id,
anywhere; an unknown id, in the flow or out of it; an expected id that is nowhere; a flow whose
order differs from the source; an id found only in margin boxes, without the in-flow original every
running element keeps; an id in the footnote area outside an element Paged.js marked as a note
(`data-note="footnote"`); and an id in a page box that is not on every page, sits after the page's
content area, or also occurs in the flow — none of which Paged.js produces for a `position: fixed`
element. Each of those is an element a script moved out of the flow. What the signature cannot
tell apart is a script that reproduces it exactly — marks an element as a note before Paged.js moves
it, or clones it into the head of every page box and removes the original.

**Evidence marks follow the same boundary, and three kinds of page still cannot bind.** The overlay
places no mark on a margin-box or page-box clone: no finding can target one, and requiring a mark
for it left every page of a document with a running header unbound, so that the default run
(evidence binding on) ended exit 4 — measured on 2026-09-24 before this repair, with 24 unplaced
marks on a six-page document with two running elements. A fragment that bleeds into the side margin
is marked where it is printed, inside the page box; before this repair all 212 marks of a full-bleed
document were refused; measured after it, every one of the 212 is laid out exactly where the overlay
recorded it and inside the page box. Whether the PDF text layer then returns each mark at that
position can only be checked on a browser whose PDF carries the marks: the Chromium 141 build these
repairs were developed on writes a PDF with no mark in it at all, in the margin or not, so that
half is established by the live suite on current Chrome in CI and nowhere else. What does not bind,
and so ends a run with evidence binding on at `insufficient-coverage` (exit 4):

- a page whose flow contains a fragment pulled ABOVE or below the content box (a negative top
  margin, content hanging past the column): down the page a mark must lie inside the content box,
  so that mark is refused, and a fragment with no mark on its page leaves the page unbound. The
  bound is a conservative choice, not a measured necessity: the marks hang in Paged.js'
  multi-column fragmentainer, and on Chromium 141 a mark positioned above or below it printed at
  its DOM position; the vertical bound was kept rather than rely on that for every browser;
- a page carrying a footnote-area block, for the same reason (the footnote area lies below the
  content box) — moot today, because footnotes stop the run earlier;
- **a page with no source block at all, such as the blank page a `break-before: recto` inserts.**
  A page binds only on marks it carries (`src/render/evidence.ts`), and required evidence is
  complete only when every page binds (`src/core/engine.ts`), so every document with a
  parity-blank page ends exit 4 under evidence binding, with or without running elements. That is
  the evidence contract as it stands, read from the code; the margin-box repair did not change it.

**A page is anchored to the first block that starts on it.** A block that spans pages — `<main>`,
`<article>`, a section, a full-bleed block — has a fragment on every page it covers, and as an
ancestor it comes first in document order, so it used to anchor every one of those pages: the page
findings on them shared one fingerprint. Now the first block whose first fragment is on the page
anchors it. Only a page on which nothing starts — the middle of a single block taller than a page —
falls back to its first continuing block, and two such pages of the same block share an anchor. A
wrapper that starts on page 1 still anchors page 1, keyed by its author id or, without one, by the
signature of all its text, so without an id that page's fingerprint follows any edit inside the
wrapper.

**How often oversized `break-inside: avoid` blocks occur in real documents is not measured.** The
repair is arithmetically correct and conservative, but its frequency in the field is unknown, so
how much this changes in practice for a given project is unknown too. A project that sees a new
`error` after upgrading is seeing a block that never fitted; that is all this version claims.

**A two-fragment split is measured but never reported, and that is a proof obligation.** Paged.js
does not fragment natively — it produces two DOM elements — so `box-decoration-break` does not
apply here at all. What strips decoration at a split is Paged.js' own stylesheet, and it unsets
`margin` and `padding` on `[data-split-from]`/`[data-split-to]` but **not** `border`, and without
`!important`. A bordered block that is split therefore carries its border height once per fragment,
and an author rule with `!important` padding does the same — so two fragments can sum above the
page for a block that fitted unsplit. From three fragments on that cannot happen: an intermediate
fragment fills an entire content box and there is content before and after it, so the block is
taller than one page by construction. **The residual gap is a block split into exactly two
fragments whose real height does exceed the page: it is not reported, and the value recorded for it
is the first fragment's box rather than the sum** — exactly as in 0.5.0, and stated here because a
reader of the summed-height paragraph above would otherwise assume the sum is recorded everywhere. The residual risk
in the other direction is a block with borders thicker than the content of its own outer fragments,
which would have to be several tens of pixels per edge.

**The boundary is the content box of the page the block was laid out on.** Comparing against the
largest content box in the document was tried and is worse: in a document with a named landscape
page it raises the bar for every block on the portrait pages and hides real ones. What is observed
is that this block did not fit unbroken on this page, and that is what the finding says — it no
longer claims anything about pages it did not measure. A block that would have fitted on a
differently sized page elsewhere in the document is still reported, because it still broke its own
`break-inside: avoid` where it was.

**Flow membership is decided by page structure, never by coordinates, so a fragment that bleeds
into the margin still counts.** `layout/unbreakable-block-too-tall` sums every record carrying the
element's source id. A coordinate test ("a real fragment starts inside the content box") cannot tell
a margin box from a fragment that bleeds into the margin: measured on 2026-09-24, a
`break-inside: avoid` block with negative side margins had all six fragments at x = 18.91 against a
content box at x = 56.69, the filter discarded every one of them, the first fragment (335.81 px
against 340.16 px) was measured instead of the 1865.61 px sum, and the document came back `clean`.
It is reported again.

**Fragments are correlated by authoring-source id, and a split block that cannot be correlated is
declined, not measured on one piece.** A split block whose fragments carry no `sid` — every block of
a `--no-source-map` run, or an element a script created — has nothing to join its fragments by, and
neither has one whose sid does not account for exactly the fragments the snapshot counted.
`layout/unbreakable-block-too-tall` used to measure the first fragment of such a block, which
compares a piece with the page and can call a six-page block clean. It now declines it as
`env/invalid-measurement`, which counts against the rule's coverage floor: the run ends
`insufficient-coverage` (exit 4) rather than `clean`. An unsplit block without a sid is the whole
block and is still measured. In a `--no-source-map` run a split block does not reach the rule today:
measured on 2026-09-24, the sid-less source join refuses it first (`checker-crashed`, exit 3). The
decline is what remains once that join can join fragments.

**Naming an off-by-default rule in a config file turns it on, even with only options.** `rules` is
read as "the caller has an opinion about this rule": `false` disables, anything else enables, and
that includes an options object such as `{ "layout/half-empty-page": { "minNetFill": 0.4 } }`. For
the twelve rules that are on anyway this is invisible; for the one that is not, it means tuning it
also activates it. That is the intended reading — configuring a rule you do not want is not a
thing anyone does — but it is not obvious, so it is written down.

**`kill(pgid, 0)` answering `EPERM` is read as indeterminate, not as failure.** Measured on darwin
25.6.0, macOS answers `EPERM` transiently for a process group this process created and owns while
that group is being torn down — 8 of 20 acquisitions, every one followed within 10 ms by `ESRCH`
with the descendant dead. The producer cleanup therefore retries inside its existing bounded
deadline instead of failing on the first sample. What this does NOT establish is the kernel reason
for the answer; the behaviour is measured, not explained, and it was measured on one platform and
one version. An `EPERM` that outlives the deadline still fails the acquisition. The retry itself
and the deadline-expiry failure have **no test**: both live in closures that only run when the
environment produces `EPERM`, which is not deterministic. What is pinned is the errno truth table.

**Page fill counts glyph boxes, not line boxes, and has no ceiling.** `netFill` merges the
vertical bands of every text run's client rectangles — the glyph content area, not the line box —
and of replaced elements, and divides by the content box height. Half-leading and block margins
never enter it, so a page no further line would fit on reads roughly glyph height over line pitch,
which the font and the leading set. Measured on full pages that are not the last of their document
(Chromium 141 on Linux, Paged.js 0.4.3, the machine's default serif and sans-serif; not re-measured
on the current Chrome that CI runs): 0.58–0.72 at `line-height: 1.5`, 0.51–0.54 at 2, 0.34–0.36 at
3 (12 pt on A5 and 11 pt on A4). Both page-fill rules read this quantity. `layout/half-empty-page`
cannot separate a full page from a sparse one near its 0.60 threshold, and stays experimental and
off by default. `layout/orphaned-continuation-page` judges only a page whose content ends on it:
the next page does not open with its text running on, because a page whose text runs on and opens
the next page stopped for want of room. On a page it does judge it still reads net fill, so at
`line-height: 3` every such page falls below its 0.50 threshold however full it is and whatever
follows it: measured, 11 of 13 lines before a figure that did not fit read 0.29, and a tail page
filled to its last line 0.34. The "running on" test relies on the collector keeping margin-box
content out of the snapshot, as this release's collector does: a clone in a side margin box lies
inside the content box and would count as running text. A line-box fill, each text rectangle
widened to its line height, is the named next step for the net fill. It changes the snapshot shape and the quantity
behind the public options `minNetFill` and `maxNetFill`, which needs an owner decision, and it is
not in this release. None of these readings is a calibration.

**The 40-document corpus behind the `layout/half-empty-page` default is not in this repository.**
The 37-of-40 figure was measured on a corpus constructed for that purpose during the same work, and
it is not admitted here, not hashed here and not reproducible from this repository. Every place that
cites the number says "a corpus constructed for this purpose"; this paragraph says the rest of it.
The decision it supports is reversible by configuration and moves no exit code either way, which is
why it was taken on that evidence — the same standard would not have been enough for a gating rule.

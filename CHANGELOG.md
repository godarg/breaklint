# Changelog

## Unreleased

Changes on `main` since the `v0.6.0` tag. Nothing below is in the published 0.6.0 package.

### Rule behaviour

- **`layout/unbreakable-block-too-tall`: a `position: running(...)` element placed in a side
  margin box (`@left-middle`, `@right-middle`) is no longer summed into a false `error`, and a
  full-bleed block is no longer judged on one piece.** In 0.6.0 the filter that keeps per-page
  margin-box clones out of the fragment sum tested only the vertical axis. A side margin box starts
  at a content-box `y`, so its clones passed that test and a short running element repeated on
  three or more pages could be reported as a block taller than the page: the 0.6.0 rule reports
  582.00 px against 340.16 px for a 97 px side element on six pages. The 0.6.0 section below claimed
  this exclusion held "by construction"; it held for the top and bottom margin boxes only. The first
  repair (e46a1bf) added the horizontal axis, and that coordinate test was wrong in the other
  direction: a `break-inside: avoid` block with negative side margins has every fragment left of
  the content box, so all six fragments of a 1865.61 px block were discarded, its first fragment
  (335.81 px) was measured against the 340.16 px page, and the document came back `clean` at
  exit 0 — a regression against 0.6.0, which reported it. **The coordinate filter is gone.** Flow
  membership is now decided by the page structure, in the snapshot rather than in this rule (see
  *Fixed* below), and the rule sums every fragment of the element wherever its box lies: the
  full-bleed block is an `error` again at 1865.61 px, and the side-margin element is silent.
  Measured on 2026-09-24 with Paged.js 0.4.3, with evidence binding off, on the live fixtures
  `fullbleed-avoid.html` and `margin-running-elements.html`. With evidence binding on (the
  default) the exit code also depends on the page evidence, which this first repair still refused
  for both documents; see *Fixed* below.
- **The same rule declines a split block whose fragments it cannot join, instead of measuring its
  first fragment.** Fragments are joined by source id. A split block without one — every block of a
  `--no-source-map` run, or an element a script created — or one whose id does not account for
  exactly the fragments the snapshot counted used to be judged on its first fragment, which
  compares a piece with the page and can call a six-page block clean. It is now declined as
  `env/invalid-measurement` (newly listed in the rule's declared decline reasons). The decline
  counts against the rule's coverage floor, so such a run ends `insufficient-coverage` at exit 4
  where it could end `clean` before. An unsplit block without a source id is measured as before.
- **Three rules no longer count a block nothing was printed from as measured.** A block the
  browser did not lay out was a measured candidate of `layout/unbreakable-block-too-tall` (at 0 px),
  `layout/heading-at-page-bottom` ("with content below it") and `type/excessive-word-spacing` (with
  no lines). The case that matters is the in-flow original of every `position: running(...)`
  element, which Paged.js hides with `display: none`: a document whose only avoid block was a
  running element reported `unbreakable-block-too-tall` coverage 1/1 and a clean run, also under
  `--profile strict`, for a check that had looked at nothing. Such a block is now `excluded`,
  outside the coverage base, never measured, with the reason `rule/target-in-margin-box` for a
  running element's original and `rule/target-not-rendered` for a block the author hid (or one in
  a hidden subtree or a closed `<details>`). The two are told apart by the fields Snapshot 5 adds
  (next entry). Consumers see new evaluation rows with these reasons and smaller candidate and
  measured counts for these three rules on documents with running elements or hidden blocks. An
  empty paragraph (full width, zero height) has a box and is still measured.
- **Snapshot schema 5: every block records its computed `display` and its margin-box copies.**
  `BlockRecord.display` (the computed value) and `BlockRecord.marginCopies` (how many copies
  Paged.js printed in margin boxes, the clones of a running element) are required fields, checked
  by the snapshot invariants; the engine judges only a snapshot of its own stamp and refuses any
  other with `checker-crashed` (exit 3). The only stored snapshot, `examples/demo-snapshot.json`,
  is migrated; the demo's findings do not change. The report schema does not move. In the same
  stamp, `TextLine.visible` is true when any text on the line is visible — read from each text
  node's element — where it used to copy the block's visibility, so a hidden block's visible
  descendant (`p { visibility: hidden } span { visibility: visible }`) counts as printed.
- **A zero box no longer decides how a block is judged; its computed display does.** A
  `display: contents` block has no box of its own but prints its text and children:
  `type/excessive-word-spacing` measures it from its lines (a justified `display: contents`
  paragraph with a 3.74× gap is a finding, as on 0.6.0); `layout/heading-at-page-bottom` places such
  a heading, and a block below it, by its visible line boxes, where it used to read the zero box at
  the page origin and call every such heading followed; `layout/unbreakable-block-too-tall`
  records it as `not-applicable` (`rule/target-generates-no-box`, outside coverage), because
  `break-inside` does not apply to an element that generates no box. An intermediate state of this
  change declined it against coverage instead, and a key/value grid whose items were flattened
  with `display: contents` under `li { break-inside: avoid }` ended exit 4 with twelve declines
  where 0.6.0 ended exit 0; it ends exit 0 again. An image-only `display: contents` figure is no
  longer called unrendered. Where a box-less block has no line to read,
  `layout/heading-at-page-bottom` excludes it when its lines are all invisible
  (`rule/target-not-visible`, so a hidden `display: contents` heading no longer ends a run at exit
  4) and declines it as `env/invalid-measurement` when it has no line or unrecorded lines. A box
  of zero by zero is not read as "not rendered" by itself: only `display: none` or recorded lines
  none of which is visible are. A zero-size block that printed its text outside its box
  (`width: 0; height: 0; overflow: visible`) is placed by its lines by the heading rule, measured
  by the word-spacing rule, and declined, counted, by `layout/unbreakable-block-too-tall` (an
  unreleased intermediate state excluded it, which turned a counted decline into a clean run).
  `type/excessive-word-spacing` no longer measures a factor of 0 from lines nobody saw: all lines
  invisible is `rule/target-not-visible`, no line at all (an empty or image-only justified block)
  is `rule/no-text-lines` (both outside coverage), and unrecorded lines are declined as
  `env/invalid-measurement`, counted. Both rules newly declare `env/invalid-measurement`.
- **A split block whose first fragment did not print is still judged.**
  `layout/unbreakable-block-too-tall` judged a split block at fragment 0, so a script that set
  `display: none` on only the first fragment, or moved it where it has no box, hid the whole
  block: measured on 2026-09-25, a four-page avoid block went from a finding (exit 1) to a clean
  run (exit 0). The block is now judged at its first fragment laid out with a visible box of its
  own, over the sum of all its fragments; the earlier fragments are recorded `not-applicable`
  (`rule/fragment-not-rendered`). Both hostile documents report the block again (exit 1).
- **The same rule's advice no longer claims the block "cannot fit unbroken on any page".** The
  finding message had already stopped making that all-pages claim from one measured page; the
  advice text in `Finding.remediation` now says the same thing (6af6008). Consumers that stored or
  compared advice text will see the new string.
- **`layout/widow` and `layout/orphan` no longer say that CSS `widows`/`orphans` are "ignored by
  Paged.js".** Paged.js 0.4.3 never reads either property, but it cuts every page where the
  browser's own column fragmentation broke, and the browser applies both there. Measured on
  Chromium 141 with Paged.js 0.4.3 over one geometry: `widows` 1, initial and 5 split a 9-line
  paragraph 8+1, 7+2 and 4+5; with room for one line, `orphans: 1` splits it 1+8 while the initial
  value and `orphans: 4` move it whole. The advice now says the browser applies both, that what is
  left to report is a split the browser had to relax (CSS Fragmentation Level 3 §4.3, which is why
  both rules stay warnings permanently), and that changing the block's own value moves the
  threshold and is not a fix. The levers are unchanged. `Finding.remediation.advice` changes for
  both rules; consumers that stored or compared it will see the new strings.
- **`layout/hyphen-across-page` no longer recommends soft hyphens, `hyphens: manual`, `&nbsp;`, or
  block-level `hyphens: none` in justified text.** Paged.js 0.4.3 marks a page split right after a
  soft hyphen exactly like a split inside a word (`hyphenateAtBreak`), so the old cure re-created
  the finding, and `manual` is the value under which soft hyphens break (measured). In a justified
  block the advice now changes only the boundary word — `<span style="hyphens: none">` or
  `white-space: nowrap` (both measured to leave no boundary hyphen), or rewording; `hyphens: none`
  on the paragraph remains the fix for a block that is not justified.
- **`type/excessive-word-spacing` and `layout/hyphen-across-page` state which of them owns
  `hyphens` and soft hyphens.** Their two texts pulled the same levers in opposite directions and
  said only that they did. The word-spacing rule now owns the block-level `hyphens` setting and the
  soft hyphens (`&shy;`) of justified blocks, and the hyphen rule defers to it on both there,
  changing only the boundary word; both advice texts say so, and the word-spacing advice adds that
  `hyphens: auto` hyphenates only where the rendering browser has a dictionary for the language —
  on the measured headless Chromium 141 it had none for English, so soft hyphens were the lever
  that worked. The order is declared in the new registry field `remediation.interactions`, which
  does not travel into reports: `Finding.remediation` still carries `advice` and `tested` only, and
  no report, snapshot or configuration schema stamp moves. Both advice strings change.
- **`layout/orphaned-continuation-page` no longer reports pages whose text runs on to the next
  page.** A page is judged only when what it carries ENDS on it: the next page does not open with
  text running on from it — a text line of a block that continues there whose glyph box starts
  less than one of that block's line heights below the top of the page's content, or that shares
  its line with an inline SVG starting there (the window then reaches one line height past the
  SVG's bottom), and that does not lie inside a block that starts there after it in document
  order. The rule records this as a third measurement, `ends-on-page`, in its evaluations. All figures below were measured on Chromium 141 with
  Paged.js 0.4.3.
  - Until now every page between the first and the last page of a block was reported as soon as
    its net fill read below 0.50. Such a page stopped because its next line did not fit, so it is
    full; but net fill counts glyph boxes, not line boxes, and it reads 0.34–0.36 at
    `line-height: 3`. A long paragraph with generous leading produced one warning per middle page
    (five on the new live fixture); none now. The same holds for a full page whose last block is a
    nested child that ends there while its wrapper's own text runs on, and for one followed by a
    page whose top carries a positioned badge or a relatively offset aside beside the running
    text, and for one whose next line carries a 70–100 px inline SVG: 0.6.0 reported those
    pages, and they are no longer reported. The extra room is given for inline SVG only: the
    snapshot records no box for an inline `<img>`, `<canvas>` or `<video>`, so the full page
    before such a line (an 80 px image or canvas under 48 px lines) is still reported — this errs
    toward reporting. The window uses the line height of the recorded block a line belongs to,
    not the line's own. A snapshot field for replaced-element boxes, planned alongside the
    line-box fill, is the follow-up.
  - A page that ends early is still reported, whatever the shape of the wrapper: a `<section>`
    whose own SVG, image or bare text was left high on a page because its next child, a
    `break-inside: avoid` figure, did not fit (net fill 0.08–0.39), with or without a border on
    the section and with the figure bleeding into the margins; and a section whose own SVG did not
    fit (0.31). 0.6.0 reported these pages, and so does this rule.
  - Only blocks of the page's flow count: a block with a box that lies at least partly inside the
    content box vertically. A `display: none` original of a running element and an empty
    positioned marker have no box, and a clone in a top or bottom margin box lies outside the
    content box, so none of them decides anything. Measured, such blocks hid a two-line tail page
    under a running header, which 0.6.0 did not report; it is reported now. The rule relies on
    the collector keeping margin-box content out of the snapshot, as this release's collector
    does: a clone in a side margin box lies inside the content box vertically.
  - The message now says what the page is: "Page N carries only content continued from an earlier
    page, which ends there, and its net fill is X %". Consumers that match the old message text,
    or read the evaluation's measurements by position, will see the change.
  - The decision reads the order in which the collector records a page's blocks, document order,
    and the live suite now pins that order.
  - Not fixed: at `line-height: 3` every page whose content ends on it is reported, however full
    and whatever follows it (11 of 13 lines before a figure that did not fit: 0.29); a line-box
    fill is the named follow-up (`docs/limitations.md`). A block that starts on the next page and
    covers the running text takes that text for its own, and the page before it is judged; this
    is pinned by a unit case and was not seen on a real document.
  - No schema stamp moves.
- **`layout/half-empty-page` no longer states a "measured ceiling" in its findings.** Every finding
  said the threshold "sits 0.086 below the measured ceiling of a full text page". Net fill has no
  ceiling: full, non-last prose pages at `line-height: 1.5` read 0.58–0.72 with this collector, and
  6 of 16 such pages read below the 0.60 threshold. The message now says what the quantity is —
  "net fill sums the glyph boxes of text, not its line boxes, so a page a reader calls full can
  read below this threshold" — and quotes no number. The rule page, `docs/agent-contract.md` and
  the source comments are corrected; the 0.6.0 entry below, which gives "about 0.686" as the
  figure for a full page, is corrected by this entry rather than rewritten. The rule page also no
  longer says the last page is "downgraded to a note": its finding keeps `warn`, and only the
  message says the page is likely intended. The rule stays experimental and off by default, and
  nothing here is a calibration.
- **`layout/heading-at-page-bottom` no longer reads a block footnote as page text, in either
  direction.** Paged.js lays a `float: footnote` block out in the footnote area below the content
  box, and the snapshot records it on the page it is printed on. The rule counted it as content
  following a heading, so a heading stranded at the foot of the text above the page's footnotes was
  never reported; and it judged a heading INSIDE a footnote (a structured note with its own heading)
  against the content box, reporting it as stranded with -1.01 line heights left. A following block
  now counts only when it starts inside the content box, and a heading printed below the content
  box is not a candidate: it is recorded `excluded` with the new evaluation reason
  `rule/target-outside-content-box`, outside the coverage base. Consumers see stranded headings
  reported on footnote pages, and the false finding inside a footnote gone. Both tests read where
  the block is printed (`renderedBox`), so a `display: contents` block is placed by its lines.
- **`layout/orphaned-continuation-page` and `layout/half-empty-page` decline a page that prints only
  outside its content box.** A long footnote that Paged.js carries over to a page of its own leaves
  that page's content box empty (0 px tall on a measured example) while the page is full of
  footnote text. The continuation rule measured it as "continuation-only: false" — a checked page
  that was fine — and the half-empty rule as 0 % filled. Both now decline it as
  `env/invalid-measurement`, newly listed in both rules' declared decline reasons, and the decline
  counts against coverage, so such a page can lower a rule's coverage where it used to raise it.

### Added

- **A GitHub Action for gating HTML-to-PDF builds** (`action.yml` at the repository root, runner
  in `action/run.mjs`; neither is in the npm package). `uses: godarg/breaklint@<ref>` installs
  `breaklint@<version>` from npm, where `<version>` is that ref's `package.json` version — so a
  branch ref runs the last published release, not the branch's code, and a tag works only after
  its npm publish succeeded (until then the step ends with exit 3) — with the pinned peers `puppeteer-core@25.8.0`, `pagedjs@0.4.3`
  and `pdfjs-dist@6.2.108` (or uses the project's own install), hands it the runner's Chrome with
  the sandbox on, runs it once over bash-expanded HTML paths, and writes the canonical JSON plus
  SARIF, JUnit and Markdown rendered from that one report by breaklint's own reporters. The
  Markdown goes to the step summary. The step ends with breaklint's own exit code; exits 2, 3 and
  4 always fail it, and only exit 1 can be left ungated (`fail-on-exit: 2,3,4`). The Action's own
  setup failures use the same table (2 for a bad input, 3 for an install or runner that cannot
  run the check), and an exit 0 or 1 without its report is treated as 3, because node's crash
  exit is also 1. Inputs reach the runner as one `toJSON(inputs)` variable and are never pasted
  into a script; breaklint's output is printed with workflow commands switched off.
- **`docs/ci-recipe.md`**: a workflow to copy (build, check, keep the reports, upload SARIF from a
  separate job that alone holds `security-events: write`, skipped for forks), what each exit code
  does to the job, several documents, pull-request summaries, caching, and what is not covered.
  The README links it from Usage.

### Fixed

- **A directory named `*.html` ends with exit 2 before Chrome starts, instead of exit 3.** The
  input type is decided by the name, so a directory called `chapter.html` passed the extension and
  existence checks, started Chrome and ended exit 3 `source-acquisition-failed` with "input
  capture failed: resource byte limit exceeded" — an infrastructure verdict with the wrong cause for
  a mistake in the invocation, where the README promised exit 2. Anything that is not a regular
  file is now `breaklint: input is not a regular file: <path>`, exit 2, no report.
  `tests/e2e/input-validation.test.ts` pins exit 2 and an empty stdout for an existing and a
  missing `.md`, a directory named `.html` (also after a valid path) and a missing `.html`.
- **`--help` described exit 4 as including "no input"**; a run without an input path is exit 2.
  The exit-2 line now names every usage case and says that no report is written.
- **Margin-box content is no longer part of the flow: not in the snapshot, not in the collector's
  page edges, not in the evidence overlay, not in page anchors.** Paged.js clones every
  `position: running(...)` element into a
  margin box of every page and every `position: fixed` element into every page box, and each clone
  keeps the source id. Both in-page collectors read the whole `.pagedjs_page`, so every clone was
  one more fragment of its source block. Measured on 2026-09-24 with Paged.js 0.4.3 before this
  change: a six-page document with a one-line running title and an eight-line side running
  element carried seven records per element and reported ten `layout/widow`/`layout/orphan`
  warnings, all about clones (exit 1 under `--fail-on warn`); under a running header, the blank
  page a `break-before: recto` inserts was not blank, its two boundaries were classified
  `overflow` and `forced` instead of `parity`, `layout/orphaned-continuation-page` fired on it, and
  every page was anchored to the header. The snapshot and the collector now keep only blocks
  inside a page's content area (`.pagedjs_pagebox > .pagedjs_area`, which holds the page content
  and the footnote area — footnotes stay in the flow). A page is anchored to its first rendered
  block (a box, or line boxes), so the running element's in-flow original, which Paged.js hides with
  `display: none`, no longer anchors page 1 either. A page with no content area stops the run at
  exit 3 instead of being measured as empty. After the change both documents above have no
  findings. **What this leaves unmeasured is new and is stated in `docs/limitations.md`**:
  nothing printed in a margin box is judged by any block, line or page rule, and a
  `position: fixed` element is not measured at all. Inline SVG in a margin box is not covered by
  this change. This change itself is pure exclusion (the fields Snapshot 5 adds are a separate entry) — but
  `blocks`, `fragmentIndex`/`fragmentCount`, `blank`, the break causes and `firstSemanticBlockKey`
  mean something different for every document with running elements. The exit codes quoted here
  were measured with evidence binding off; the evidence side is the next entry.
- **With evidence binding on — the default — a running element, a `position: fixed` element or a
  fragment bleeding into the side margin no longer ends the run at exit 4 by itself.** The
  evidence overlay was a third whole-page reader: it tried to mark every source element on the
  page, including the clones, which lie outside the content box its marks hang in. Each clone was
  recorded unplaced, and a page with an unplaced element that has no placed mark never binds, so
  required evidence never completed. Measured on 2026-09-24 before this change (Paged.js 0.4.3,
  evidence on): `margin-running-elements.html`, `margin-running-parity.html` and
  `fullbleed-avoid.html` ended exit 4 with 24, 6 and 212 unplaced marks; after it, 0, 0 and 0. The
  overlay now skips everything outside the content area, as the snapshot does, and places a mark
  for an in-flow fragment in the side margin where it is printed, inside the page box; the
  vertical bound stays the content box, as a conservative choice (on Chromium 141 a mark above or
  below the content box was measured printing at its DOM position). Whether the PDF returns the new margin marks at
  their DOM position is established by the live suite on current Chrome only: the Chromium 141
  build used for this change writes no mark into its PDF at all. Still unbindable, so still exit 4
  with evidence on, and now stated in `docs/limitations.md`: a fragment pulled above or below the
  content box, a footnote-area block, and — unchanged, for every document — a page with no source
  block at all, such as the blank page a `break-before: recto` inserts.
- **A running title that is not the first element of the source no longer stops the run at exit 3.**
  The post-pagination source-id check compared the order of every source id in the document with
  the source order, and the margin boxes come before the content area in each page box, so the
  page-1 clone of a running title preceded a heading written before it, or the section that
  contains it: `checker-crashed`, measured on `margin-running-after-heading.html` and
  `margin-running-in-section.html`. The order is now checked over the page content only; margin-box
  clones, footnote-area blocks and `position: fixed` clones are checked for identity, presence and
  the signature Paged.js leaves: a note carries `data-note="footnote"`, and a fixed clone is at the
  head of every page box with no in-flow original. An attribute change of a reserved id, an unknown
  id anywhere, a missing id, a reordered flow, an id found only in margin boxes, and an element a
  script moved into the page box or the footnote area without that signature still fail the run
  (exit 3). Block
  footnotes now pass this check too, but still end the run at the paired control
  (`injection-interference`, exit 3), because Paged.js gives each footnote call a per-run random
  `href`; that is unchanged and recorded in `docs/limitations.md`.
- **Page-finding fingerprints change for every document with running elements** (or
  `position: fixed` elements, or a page whose first block is `display: none`). A page finding's
  fingerprint is keyed to the page's first semantic block. The margin boxes and page-box clones
  precede the content area in the page box, so for such a document that was, on EVERY page, that
  page's clone of the same running element — one source block, one key: three
  `layout/half-empty-page` findings on three pages carried one fingerprint, a collision the tool
  manufactured. They are now keyed to each page's first visible in-flow block, and findings about
  clones are gone. A baseline that keys
  on `Finding.fingerprint` (or on SARIF `properties.fingerprint`) will show the old page findings as
  gone and the re-keyed ones as new although the document did not change: take a new baseline
  after upgrading. `compareReports` does not match by fingerprint and is not misled: page-only
  findings are unmatchable there, and it never calls a finding `persisting` or `resolved` across
  two tool versions.
- **Page-finding fingerprints also change for every document whose content sits in a block that
  spans pages** — a `<main>`, `<article>` or `<section>` wrapper, a long `<div>`, a full-bleed
  block. As an ancestor it came first in document order on every page it covered, so it anchored
  all of them, and their page findings shared one fingerprint: four `layout/half-empty-page`
  findings on four pages of one `<article>` carried one fingerprint, measured on 2026-09-24; after
  this change the four are distinct. A page is
  now anchored to the first block that STARTS on it; only a page on which nothing starts falls back
  to its first continuing block. Page 1 of a wrapped document is still anchored to the wrapper;
  every later page moves to its first paragraph. The same baseline advice applies.
- **Documents with footnotes reach the rules instead of stopping at exit 3.** Paged.js builds each
  footnote call as `<a data-footnote-call="R" data-ref="R" href="#note-R">` from the note's
  per-run random `data-ref`, so the paired control run disagreed with the injected run about that
  `href` and every document with a `float: footnote`, block or inline, ended
  `injection-interference` (exit 3) — measured on 2026-09-25 on `footnotes-block.html` and
  `footnotes-inline.html` with the real paginator (patched Chromium 141, no evidence binding): exit
  3 before, exit 0 after. The control signature now records a call Paged.js built by its ordinal,
  and recognises it only together with the note it points at in a footnote area; a look-alike
  call without its note is still interference (`footnotes-planted-call.html`, exit 3), and a
  script that swaps source ids after pagination on a footnote page is still caught
  (`footnotes-sid-swap.html`, exit 3). This supersedes the statement in the entry above that block
  footnotes "still end the run at the paired control".
- **A block footnote's evidence marks are placed, from a layer in the page box.** The content-box
  layer refuses marks below the content box, so both marks of every block footnote were refused and
  every page with one stayed unbound (6 unplaced marks on the two pages of `footnotes-block.html`).
  The first repair hung a second layer in the footnote area; on Chrome 153 in CI one footnote page
  of `footnotes-block.html` and of `footnotes-named-page.html` still did not bind (evidence
  `partial`, 1 of 2). The footnote area clips and Paged.js packs the notes to its bottom, so a note
  filling the area has both edges on the clip edge. The layer now hangs in the page box, which does
  not clip inside the page; a mark may lie on the footnote area's edge but not outside it. Whether
  this binds on Chrome 153 is established by the live suite in CI, which now prints every mark's
  fate when a page does not bind; it is not observable on the Chromium 141 build used here. This
  supersedes the entry above that lists "a footnote-area block" as unbindable.
- **A block footnote no longer makes an overflow boundary inside a named-page chapter `forced`.**
  The collector read the footnote — after the page content in document order, and outside the
  `page: chapter` section it was written in — as the last node of its page, so the page before the
  boundary had no page name and the boundary was classified as a change of named page: on
  `footnotes-named-page.html` `layout/widow` and `layout/orphan` declined `env/forced-break` and the
  run ended exit 4. A page's edges are now read from its page content; the footnote still keeps its
  page from being blank.
- **A page Paged.js inserts for parity no longer blocks required evidence — and is not counted as
  bound.** A page binds only on marks it carries, and the blank page a `break-before: right`,
  `left`, `recto` or `verso` inserts carries none, so with evidence binding on (the default) every
  document with such a page ended `insufficient-coverage` (exit 4). Such a page is now excused from
  the binding requirement when it is proven empty by five answers that must agree: Paged.js marked
  it `pagedjs_blank_page`; its page area in the DOM is exactly Paged.js' empty page template (a
  structural test — the running header and page number in its margin boxes are expected and do
  not count); the delivered PDF's text layer has no text item reaching into the page area (its
  whole extent, so margin text running into the area counts); the delivered PDF's raster of the
  page area, rounded outward to whole pixels so a hairline on its edge is read, is one flat colour
  — a flat page or area background is paper, a gradient, image, partial fill or rule is not; and
  the snapshot calls the page blank and has no block on it. Its evidence record keeps
  `bindsFinding: false`. Measured on 2026-09-25 (patched Chromium 141): on
  `blank-right-running-header.html` the inserted page is proven blank and leaves the requirement;
  on `blank-generated-content.html`, whose blank page prints "This page is intentionally left
  blank." as generated content, it is not — that document still ends exit 4, by design. The exit 0
  of the first document is established on current Chrome in CI. This supersedes the entries above
  that list "a page with no source block at all" as unbindable.

- **The source-id check's refusal for an element moved into the footnote area no longer says it
  was found outside the footnote area.** Every element in the page area outside the page content
  that is not inside a Paged.js note lands in one refusal, including one moved INTO the footnote
  area without the note marker; the message now names what is missing (`data-note="footnote"`).
  Exit 3 as before.

### Documentation

- `docs/limitations.md` now states that a document with a page that carries no source block — the
  blank page a `break-before: recto` inserts — cannot complete required evidence: a page binds only
  on marks it carries, so such a run ends `insufficient-coverage` (exit 4) under evidence binding.
  That was already the behaviour; it was not written down.
- **`--out-dir <dir>` is documented and tested.** It was parsed, validated and applied — every
  live run writes its page PNGs and checked PDF there, by default into `./breaklint-report` in the
  working directory — and appeared in neither `--help`, the README nor `docs/configuration.md`, and
  no test named it. It is now in all three, `tests/e2e/input-validation.test.ts` pins its exit-2
  cases, and the live test `tests/live/cli-out-dir.test.ts` observes the evidence in the named and
  in the default directory (one more live test).
- The two documented blind spots of the community-intake secret tripwire — candidates shorter
  than 12 characters, and candidates containing a character outside `A-Z a-z 0-9 + / _ = . : % -`
  — are pinned on both sides of each boundary by `tests/e2e/community-intake-limits.test.ts`, so a
  detector change cannot make `docs/community-testing.md` wrong unnoticed.
- Naming an off-by-default rule in `rules` with only an options object enables it, exactly as
  `true` does. This was always the behaviour; it is now written down in `docs/limitations.md` and
  pinned by a contract test.
- **Stale contract statements corrected against the code.** The README said live reports use
  Report 4 (they use 5; readers accept 4 and 5), that `examples/demo.html` is the document behind the
  demo snapshot (no such file exists or ever did), that print uses a "verified" A4 layout (what is
  verified is the technical surface gate; the 0.6.0 human review did not pass) and that a live run
  needs `puppeteer-core@25.8.x` (the peer range is `>=25.8.0 <26`). `docs/source-bound-findings.md`
  listed the document report as 4 and the context pack as 1 (5 and 2). `docs/configuration.md` now
  says that any rule value other than `false` — an options object, even an empty one — enables a
  rule, and that `strict` also enables `layout/half-empty-page`; `tests/e2e/configuration-doc-claims.test.ts`
  pins both through the CLI. `docs/limitations.md` described a Paged.js exit 3 for a Markdown file;
  a non-`.html` name has ended with exit 2 before any renderer since 0.3.1, and Markdown text
  saved as `.html` is measured as HTML text (with no element in it, the run ends exit 3
  `geometry-cross-check-failed`).
- The shipped type declarations called `renderReport`'s input "a Report4" and
  `Finding.originalSource` "Report4's source/actionability truth"; `renderReport` reads document
  reports of schema 4 and 5 and screen reports, and `originalSource` has been part of every
  document report since schema 4. Comment-only; no type changed.
- **`SECURITY.md`** named 0.2.x as the supported line; only the latest published version receives
  fixes. It also said the sandbox claim was checked in the test suite, and no test checked it:
  `tests/unit/sandbox-boundary.test.ts` now pins the one browser launch, read with the TypeScript
  compiler's parser: an object literal of allow-listed keys (`executablePath`, `headless`,
  `userDataDir`, `args`, `detached`, `protocolTimeout`, `pipe`, `handleSIGINT`, `handleSIGTERM`,
  `handleSIGHUP`, `timeout`, `signal`, each with the reason it cannot touch the sandbox), no spread,
  no computed key and no key twice, with `args` the literal `[]` — and fails if any source, tool,
  test or workflow file names a sandbox-disabling switch. A launch reached through `.call`,
  `.apply`, `.bind`, an element access or an alias, and a `.mts` or `.cts` source, are not parsed
  for their options; the test's header states these limits.
- **The complete local gate is in `CONTRIBUTING.md`**, where `AGENTS.md` said it was and it was
  not: the `npm run` steps of `ci.yml` in CI's order, plus the packed-consumer checks.
  `docs/releasing.md` ran `test:real-document` before the build it needs, left out
  `make-mark-font --check`, `test:report-surface-mutants`, `docs:rules:check` and the packed
  consumer, and named 0.6.0 in its procedure; it is now version-neutral and complete.
  `tests/unit/workflow-gates.test.ts` holds both lists against the workflow. `CONTRIBUTING.md` no
  longer names schema numbers (it said Report 4 and Snapshot 3).
- **`docs/agent-contract.md` is now held against the code, and it contradicted it in six places.**
  It recommended removing `break-inside: avoid` for `layout/unbreakable-block-too-tall`, whose own
  advice says that clears the finding only by removing the rule's candidate; named an exit-2
  verdict `usage-error` (it is `usage`, and exit 2 writes no report); explained exit 4 as declined
  candidates only, with "unmeasured RTL runs" as an example (no rule declines on direction, and
  exit 4 also ends a run in which no rule measured anything, an empty input or incomplete required
  evidence); listed the research rules `svg/text-clipped` and `svg/text-ink-collision` among the
  rules that null `finding.source` (three released rules do); and named a `finding.id` that no
  finding carries. `tests/unit/agent-contract.test.ts` checks the exit table against
  `EXIT_CODE_BY_VERDICT`, every rule id against the registry, every `env/` id against `ENV_IDS` and
  the declaring rule, every field path against a real `--demo --format json` run, and every lever
  it proposes against the positive levers of that rule's `remediation.advice`; each of the six
  contradictions, reinserted, fails a named test. A decline list the page attributes to a rule
  must be that rule's complete coverage-relevant `declines`, so a rule that gains a reason fails
  the test until the page lists it.
- **The lever guard now also reads each rule page's Examples.** A lever counts as changed when the
  remedied example sets it to a new value, adds it or REMOVES it — deleting `break-inside: avoid`
  is the false repair the guard exists for. The remedied example of
  `layout/orphaned-continuation-page` changed `font-size`, which its advice does not propose; it now
  changes a preceding margin and `line-height`. The remedied example of
  `layout/unbreakable-block-too-tall` still uses `break-inside: auto`; that page is rewritten by
  another change of this release and is pending in the guard with exactly that one foreign lever,
  so anything added to the example fails, and the entry fails once it is no longer needed. A
  sentence proposes a lever clause by clause: "Delete …", "Drop …", "Strip …", "Change … to",
  "Override …", "Consider removing …", "You should remove …" and "Removing … fixes the finding"
  propose as "Remove …" does; a warning in one clause no longer exempts the others, a negation
  voids only when it negates the proposal verb ("does not fit" is not a warning) and then the list
  it opens, and a word inside a quoted span is not read as grammar. "Removing … fixes the finding"
  proposes only when nothing in the sentence says the fix is none — never, not, nothing, only
  because, without, false repair, hiding — and "clears the finding" is not a fix at all, so the
  false repair `layout/unbreakable-block-too-tall` describes is not read as a lever even without
  its "also". The reader is a heuristic that errs in both directions; on the advice itself an
  invented proposal is the silent one, because it widens what the guards accept, and
  `tests/unit/remediation-levers.test.ts` pins its contract sentence by sentence.
- **Erratum to 0.6.0.** The 0.6.0 entry that introduced `docs/agent-contract.md` says
  "`selfcheck:static` reads it, so its claims are held against the code". It did not:
  `selfcheck:static` scans that file for emoji, first-person wording, marketing words and
  uniqueness claims only, which is why the contradictions above shipped. The same entry's "five rules set
  `finding.source` unconditionally to null" counted two research rules.
- `docs/rules/layout-widow.md` and `layout-orphan.md` replace the warning "Chromium does not honour
  it under Paged.js" with the measured splits, and the widow page's 6+3 relaxation example now names
  the declaration that produces it (`widows: 6; orphans: 6`). `docs/rules/layout-hyphen-across-page.md`
  adds a justified remedied example and a measured limit: Paged.js sets its class only between ASCII
  word characters or after a soft hyphen, so a split next to a letter such as `ü` is not reported.
- `docs/agent-contract.md` no longer says Paged.js "does not implement CSS `widows` or `orphans` on
  paragraphs": the properties take effect through the browser's own fragmentation inside Paged.js's
  flow, and each is also its rule's threshold, so changing it is not a fix. The comment on the repair
  map in `src/api/context.ts` said "Chromium does not honour them under Paged.js" and now says the same
  as the agent contract.
- `docs/rules/layout-orphan.md` names the measured `orphans` 1 case without an `orphans: 1`
  declaration, which the guard now reads as a lowering proposal.
- `docs/rules/layout-orphaned-continuation-page.md`: the remedied example changed the font size,
  which is not a lever the rule's advice names; it now tightens the vertical margin above the
  paragraph. The page also states when a page counts as ending, what was measured, and the
  remaining limits, and `docs/limitations.md` says what page fill counts and what a line-box fill
  would change.
- `docs/limitations.md` states what the rules measure for footnote-area content, how the footnote
  call is recognised and what that recognition does not cover, where footnote evidence marks hang,
  and exactly when a parity-blank page is excused from binding and when it is not (a flat
  background colour is paper; a gradient, image, partial fill or rule is content).
  `docs/configuration.md` ("What the JSON report proves") and `docs/reporting.md` state the new
  meaning of `evidenceCoverage.expectedPages` and list every `ruleId: null` decline. The
  Documentation entry above about blank pages ending exit 4 describes the state before this
  change.

### Reporting

- **The context pack's repair option for `layout/unbreakable-block-too-tall` no longer proposes a
  false repair.** For a finding with a verified original source, `repair.options` in
  `context.json` and on the HTML bundle's finding card said "Adjust the verified block's break
  constraint or split its content; expected effect: the block can fit a page fragment". The
  rule's advice warns that the break constraint is the one lever that clears the finding without
  making the block fit. It now reads "Shorten the verified block or split its content into smaller
  sections deliberately; do not only remove its 'break-inside: avoid', which clears the finding
  without making the block fit; expected effect: the block no longer exceeds the content box of the
  page it is laid out on." Context pack schema unchanged (2): the field and its type are the same.
  `tests/unit/registry.test.ts` now checks every entry of that map against the levers its rule's
  advice proposes.
- **Meaning change consumers must note: `evidenceCoverage.complete` no longer implies that every
  page has `bindsFinding: true`.** `evidenceCoverage.expectedPages` used to be the document's page
  count; it is now the number of pages that must bind — the pages less those excused as proven
  blank (see *Fixed*) — and `complete` still means `boundPages === expectedPages`. Excused pages
  are listed as `env/parity-blank-page` rows in `documents[].notMeasured`, with `ruleId: null` and
  the page in `target.nodeKey` (`"page:N"`), one row per page and never aggregated; their
  `evidence[]` records keep `bindsFinding: false`. `env/parity-blank-page` with `ruleId: null` is
  new; the complete list of `ruleId: null` declines is in `docs/configuration.md`. No field is added
  or removed: the Report stamp stays 5 and the Snapshot stamp stays 4, by decision for this
  release.

### Tooling

- **The live late-mutation test no longer depends on when a timer fires.** Its fixture appends a
  paragraph on a 600 ms timer, so whether that lands before the snapshot, between the snapshot and
  a PDF, or after the last PDF is a race: 3 of 42 runs on the base commit produced no event, and the
  test, which required one, failed there. It now requires what the product guarantees: an event,
  or else neither the measured snapshot nor the delivered PDF (read with the production
  rasteriser) carries the late text.

- **The release workflow names its version once, and CI checks that it is the right one.**
  `release.yml` carried the release version as a literal 28 times; the literal tag trigger is now
  the only one in an executable line, and every job derives `RELEASE_VERSION` and `PACKAGE_FILE`
  from the triggering tag after proving that the tag, the trigger, `package.json` and both root
  fields of `package-lock.json` agree. `npm run test:release-tag` now also runs
  `tests/tools/release-workflow-contract.mjs --check` on every CI run, so the 0.6.0 incident — a
  version bump whose tag started nothing because the trigger still named the previous release —
  fails on the pull request that causes it. The derive step must always run and must invoke the
  script: no `if:`, no `continue-on-error:`, and exactly `run: node
  tests/tools/release-workflow-contract.mjs --derive-env`. Its `--self-test` rejects a pin moved
  alone, a version moved alone, a lock moved alone, a wildcard, a leftover release literal, a job
  that reads the identity without deriving it and four ways of disarming the derive step, and
  accepts a coherent release-prep commit. Run against the tree
  of that incident (the parent of 9d53577) it reports "a push of v0.6.0 would start nothing".
- **The changelog is checked against git, in three states.** `tests/tools/changelog-contract.mjs`,
  also in `npm run test:release-tag`: after a release, any change under `src/` since the last tag
  requires a non-empty `## Unreleased` section that names every changed rule id; while a release is
  prepared, the version's heading must carry a date or exactly `TBD-at-tag`, and no
  `## Unreleased` section or "(unreleased)" status line may remain; at the tag commit, which the
  release workflow checks before packing anything, only a date is accepted, and a placeholder that
  reached the tag fails with the instruction to date it in a final commit and tag that commit. The
  tag commit of 0.6.0 shipped `## 0.6.0 — unreleased` in the published tarball, and the two
  post-tag rule changes above had no section to go into; run against those two commits the check
  fails on exactly those points. Without release tags, or in a shallow clone whose history is cut
  above them, it fails instead of passing. A rule id counts as named only as a whole token
  (`layout/orphan` is not named by `layout/orphaned-continuation-page`), a moved rule module must
  name its old id too, and a heading date must exist (2026-02-30 is refused). Its `--self-test`
  builds throwaway repositories for 23 states, including a shallow clone, a `TBD-at-tag` heading
  before the tag (accepted) and at the tag (rejected).
- **The README that ships is checked against the CLI that ships.** The published 0.6.0 README says
  "one of its seven findings" and `rules run: 13`; `npx breaklint --demo` from the same tarball
  prints five findings and `rules run: 12`. The only guard read the repository README and ran the
  source CLI. Its parser now lives in `tests/tools/readme-demo-contract.mjs`, shared by the unit
  test and by the packed-consumer steps of `ci.yml` (Node 24 and the Node 22.13 floor) and
  `release.yml` (both clean consumers and the registry readback), which run it over
  `node_modules/breaklint/README.md` and the installed `bin` in a child process. Each run also
  rejects three corrupted copies of that README against the same output. Installed from the
  registry, 0.6.0 fails it on all three counts it states.
- **The pagination-residue record is no longer a CI or release step.** Its binding has been
  historical since 2026-09-18 — five of the six private documents no longer exist at their
  recorded digests — so `npm run test:pagination-residue` printed `NO CLAIM` and exited 0 having
  read none of them, with or without an artifact root; the only thing the step could fail on was
  its own manifest. A step that exits 0 over zero documents is a green light over nothing, so it
  was retired from `ci.yml` and `release.yml`, and `tests/unit/workflow-gates.test.ts` fails if it
  returns while the script reads nothing. The script stays as a local check of the record. The
  class remains held in CI by the public `tests/fixtures/fragmentainer-residue.html` in the live
  suite. `docs/releasing.md`, `docs/limitations.md`, `docs/status.md` and the corpus README said
  the step printed `SKIPPED` and could be run in full before a release; neither was true.
- **Schema stamps in the shipped documents are checked against the built package.**
  `tests/unit/docs-truth.test.ts` compiles `dist/` into a staging package and reads the stamps by
  running it (`tests/tools/docs-truth.mjs`): the report stamp from its CLI's `--demo --format json`,
  the context-pack and comparison stamps from its public API, the readable set and the snapshot
  stamp from its enums. Every "Report N", "report schema N", "Snapshot N", "context pack N" and
  contract-table row in README, SECURITY.md, `docs/**` and CONTRIBUTING.md must equal them unless
  that mention is stated as history within its own sentence — an arrow on it, a released version
  joined to it by "from"/"until"/"since"/"before", by "in" plus a transition verb, or by a
  transition verb between the version and the mention, "legacy" directly before it, or the exact
  readable set. A version elsewhere in the paragraph, a common word such as "was" or "from the",
  "legacy" elsewhere in the sentence or an arrow elsewhere in a table row does not count. Against
  the documents of the previous commit it names every stale line the README, CONTRIBUTING.md,
  `docs/source-bound-findings.md`, `docs/status.md` and `docs/configuration.md` carried; four
  genuinely historical sentences in `docs/releasing.md` and `docs/status.md` now name their release.
  Two lines in `docs/reporting.md` are listed in `tests/tools/docs-truth-pending.jsonl` for the
  change that owns that page; each entry matches exactly one issue by file, kind, number and exact
  sentence, so a copy of the sentence or a stale claim added to it fails, and an entry that
  matches nothing fails. The same check runs in `ci.yml`'s packed clean-install step against the
  installed `node_modules/breaklint` — the README and docs a user installs, and the stamps of the
  code installed with them. In the release workflow it runs with `--release`, which refuses any
  pending entry: a tag must not ship a sentence the check knows is stale, so a non-empty pending
  list stops the release before anything is published and names the sentences to correct. A run
  that finds no document to read fails instead of passing. The four tools this change adds to the workflows —
  `docs-truth.mjs`, `changelog-contract.mjs`, `release-workflow-contract.mjs` and
  `readme-demo-contract.mjs` — refuse any argument they do not know with exit 2, so a misspelt
  `--release=no` or `--Release` cannot quietly run pull-request mode at a tag.
- **`npm run docs:rules:check` is a CI step.** `AGENTS.md` says generated artifacts are checked
  with their generator; the rule-page remediation blocks written by `tools/write-rule-docs.ts`
  were checked in CI only by a unit test that re-derives the same assertion, and the generator's
  own `--check` ran in no workflow. The release workflow runs it too, and its clean consumers and
  registry readback run the docs-truth check against the installed package; `docs/releasing.md`
  says the release workflow repeats the complete gate, and `tests/unit/workflow-gates.test.ts` now
  fails when `release.yml` leaves out any `npm run` gate step `ci.yml` runs, and when a
  packed-consumer job of either workflow stops running the README-demo or the docs-truth check
  (in `release.yml`, with exactly `--release`) in a way whose exit code reaches the job: invoked by
  `node` itself, nothing chained or piped after it, errexit on, and neither the step nor the job
  conditional or allowed to fail. The local gate lists
  in `CONTRIBUTING.md` and `docs/releasing.md` follow, and the same test keeps them equal to
  `ci.yml`.
- **A live suite asks the browser what the advice claims.** `tests/live/fragmentation-levers.test.ts`
  (6 tests, registered in `tests/tools/live-run.mjs`) renders two
  self-authored fixtures through the production chain and pins, per case, the widows/orphans split
  and whether Paged.js marks a soft-hyphen split. The literals live in
  `tests/fixtures/fragmentation-levers.ts` and were recorded on Chromium 141; CI on the supported
  Chrome is the authority. The suite fails in both directions — a browser that stops applying a
  property, or applies it differently from what the published text says — and a red run lists the
  advice and page sentences the pin decides.
- **The registry guard that banned `widows`/`orphans` from all advice is now an allow-list derived
  from that pin.** It reads every rule's advice, summary and finding messages (sampled from the
  corpus fixtures, numbers normalised), every rule page outside its generated block, README.md,
  every `docs/*.md` page, and the comments of `src/api/context.ts`. The complete `layout/widow` and
  `layout/orphan` advice texts must equal their approved texts exactly. Every other unit that names
  `widows` or `orphans` (also spelled `widow-control`, "widow/orphan", "widow and orphan") must equal
  one of the reviewed units in `APPROVED_FRAGMENTATION_TEXTS`, at the place it is approved for: a whole
  advice, summary or message, otherwise a paragraph, heading, table row or list item — so a sentence
  added to such a paragraph fails even if it does not name a property. A unit asserting that the
  browser applies a property, including the measured 6+3 relaxation, is approved only while the pin
  shows that; an approval for text that is no longer published also fails. Two checks hold even for
  an approved unit, and also run on fenced code, HTML comments and inline `style=` attributes: in every
  pin state, no proposal to lower an author's own value (a lowering verb or comparative such as lower,
  smaller, reduce, decrease, remove, reset, drop or unset near the property, or a 0/1, `initial`,
  `unset` or `revert` value given to it by `:`, `=`, `to`, `of` or "value of"); and, while the pin
  says a property is not applied, no proposal to set or raise it, including any numeric value. A
  numeric value above 1 is not treated as lowering, because it is how a measured case is named. Not
  covered: a paragraph that neither names a property nor belongs to a pinned advice text. Two review
  rounds walked around earlier versions of this guard with 22 phrasings; all of them, and more controls
  per check, are kept in the unit suite. Each text the pin decides is also checked to be present and
  to agree with the pin.
- **`remediation.interactions` is validated.** A lever is one of `INTERACTION_LEVERS` (`hyphens`,
  `soft-hyphen`). `defineRule` refuses a malformed declaration (self reference, unknown relation,
  lever or scope, an advice that does not name its partner or never mentions the lever); the registry test
  runs `interactionProblems` over all rules and refuses a pair declared on one side only or with
  both sides the same. `npm run docs:rules:write` renders a generated "Precedence" line into both
  rule pages from the field, and `docs:rules:check` keeps it current. A docs check refuses any advice
  or rule page that names block-level `hyphens: none` for justified text.
- **SARIF output is validated against the SARIF 2.1.0 JSON schema.** The schema is vendored,
  test-only, from `microsoft/sarif-sdk` (MIT) under `tests/fixtures/sarif-schema/`, with its
  source commit, licence and sha256 recorded; the one normative OASIS errata01 constraint that copy
  lacks (a region needs `startLine`, `charOffset` or `byteOffset`) is restored in memory by the
  checker. `--demo --format sarif`, every canonical report state and a report with physical
  locations validate; fifteen single-fault corruptions are rejected. JUnit gets an XSD-free
  structural check (failure counts equal the `<failure>` elements) and Markdown a verdict-line
  check, each with negative controls. breaklint's SARIF needed no change.
- **A new `action` job in `ci.yml`** runs the Action with `uses: ./` against the tarball the same
  commit packs, with real Chrome, in seven arms: clean (passes), a gating finding over two
  documents from one glob (fails), exit 1 left ungated (passes), a font that fails to load (exit 3,
  fails), a missing path plus a shell-substitution canary (exit 2, fails, nothing executed), the
  paths `--fail-on` and `never` (exit 2; without the dash guard they would become the option
  `--fail-on never` and the arm would end clean with exit 0) and a `fail-on-exit` that would let
  exit 4 pass (refused, exit 2). `continue-on-error` keeps the failing arms from ending
  the job, and `tests/tools/action-selftest.mjs` then asserts every arm's recorded outcome, exit
  code and verdict and validates the SARIF, JUnit and Markdown it wrote. An optional
  `action-code-scanning` job uploads the findings arm's SARIF only when the repository variable
  `BREAKLINT_ACTION_UPLOAD_SARIF` is `true`, and never for a fork's pull request. The one
  internal module the Action depends on, `dist/report/index.js` (not a public export; the package's
  `exports` map is unchanged), is also held locally: a unit test builds `src/` the way
  `npm run build` does and loads it through the runner's own loader. No `npm run` step was added,
  so the local gate lists are unchanged.

## 0.6.0 — 2026-09-18

A minor rather than a patch for the reason `docs/releasing.md` gives for 0.5.0: the canonical
document report changes structure, so its schema stamp moves. **Report 4 → 5** and **agent context
pack 1 → 2**. Snapshot stays 4 and Configuration Contract stays 1.

### What a consumer has to do

- **Report 5 adds one optional property, `Finding.remediation`** — `{ advice: string, tested:
  boolean }`. Nothing was removed and nothing changed type. A reader that accepts Report 4 will
  usually accept Report 5 unchanged; a strict decoder that rejects unknown properties will not,
  which is the whole reason the stamp moved rather than staying at 4.
- **Stored Report-4 artefacts remain readable.** `READABLE_REPORT_SCHEMA_VERSIONS` is `[4, 5]`, and
  `compareReports`, `writeReportBundle` and `createContextPack` all accept both. A saved schema-4
  report is pinned in the suite to still produce a full context pack rather than the legacy stub.
  Only the emitter moved.
- **Context pack 2 gains a required key and three card keys.** The pack itself gains
  `whatWasNotMeasured`; each finding card gains `fingerprint`, `source` and `remediation`. A
  consumer that validates the pack against schema 1 must move to 2; there is no shape in which 1
  and 2 are distinguishable by inspection, which is why the stamp moved.
- **The context pack's own limits are unchanged, and no 100/1200 default ever shipped.** A schema
  bump invites the opposite assumption, and a draft of this work did briefly raise the defaults to
  `maxFindings: 100` / `maxTextPerField: 1200` and drop the input clamp — that draft was never
  released and is not in this version's history. Against the released 0.5.0, measured rather than
  asserted: `git show v0.5.0:src/api/context.ts` reads `?? 40` and `?? 400`, the current file reads
  the same, and both clamp a caller's value into range. For the same reason `repair.options` has
  nothing removed from it: `RuleMeta.remediation` is new in this release, so there was no generic
  advice in 0.5.0's `repair.options` to take out. What did change there is named above — the
  `layout/widow` and `layout/orphan` strings.
- **`whatWasNotMeasured[].candidateCount` is `null` in the screen profile.** `checkPage` records a
  two-rule candidate total, so a per-rule denominator does not exist there. `declinedCount` counts
  rule/target decisions in both profiles and stays comparable; `floor` was already null.

### Two default behaviours change, and one of them can newly fail a build

- **`layout/unbreakable-block-too-tall` now measures a split block over its fragments.** Until now
  it read the FIRST fragment and skipped the rest, on the stated ground that "the block's height is
  a property of the block" — which holds only while the block is unfragmented. Measured on
  2026-09-18 with a six-page `break-inside: avoid` section: the paginator split it into six
  fragments, fragment 0 measured 596.36 px against a 680.31 px page content box, and the document
  came back `clean` at exit 0. The one rule this tool gates on by default was silent about a block
  five and a half pages tall that had asked not to be broken. The same document now reports
  3759.70 px against 680.31 px and exits 1.
  **This can turn a green build red.** A project whose documents contain oversized
  `break-inside: avoid` blocks that the paginator was already splitting will see a new `error`.
  That is the correct outcome — the block never fitted — but it arrives without any change on the
  consumer's side, so it is named here rather than in a footnote. The change is conservative in the
  other direction: a block SHORTER than a page that is split only because it began low on one sums
  to less than a page and stays silent. Fragments are correlated by their authoring-source id; a
  block whose fragments carry none keeps the old first-fragment behaviour rather than guessing.
  A four-eyes review of that sum found a false positive before it shipped, and it is worth naming
  because the mechanism is not obvious: Paged.js implements `position: running(...)` by cloning the
  element into the margin box of every page, and the clone keeps the source id. Measured: an
  ordinary twelve-page document with a three-line running header reported thirteen "fragments" of an
  81.59 px header, 979.08 px against a 619.83 px page, as `severity: error`. A box now only counts
  towards the flow when it starts inside the content box of its page, which excludes a margin box by
  construction. The underlying `fragmentIndex`/`fragmentCount` fields of the snapshot still count
  those clones; repairing the collector is a separate change and is named in `docs/limitations.md`.
  A second independent review then found the other two ways the sum can lie, and both are closed.
  **A split block is only reported from the third fragment on.** Paged.js does not fragment
  natively — it produces separate DOM elements — and its own stylesheet unsets `margin` and
  `padding` at a split edge but not `border`, and without `!important`. Two fragments can therefore
  sum above the page for a block that fitted unsplit; from three on they cannot, because an
  intermediate fragment fills a whole content box and carries content before and after it. A
  two-fragment block records the FIRST fragment's box and is reported only if that alone exceeds
  the page, exactly as in 0.5.0 — so a block that really is too tall and happens to split into
  exactly two pieces is still not reported. `docs/limitations.md` names that gap rather than
  leaving a reader of the summed-height sentence above to assume the sum applies everywhere.
  **And the boundary is the page the block was laid out on.** The message used to end "It cannot fit
  on any page", which is an all-pages claim from one sample; comparing against the largest content
  box in the document was tried instead and is worse — in a document with a named landscape page it
  raises the bar for every block on the portrait pages and hides real ones. The finding now names
  the page and its content box and says the block did not fit *there*.
- **`layout/half-empty-page` is no longer active in the default profile.** Measured on a
  40-document corpus built to exercise it, it fired on 37 of them. Its quantity saturates —
  `netFill` sums line-box heights and so counts neither leading nor block margins, capping a fully
  set text page at about 0.686 against a threshold of 0.60 — so most of those 37 are pages a reader
  calls full. A warning that appears on nine documents in ten teaches its reader to skip warnings,
  and that cost is paid by the twelve rules that are right.
  Nothing is removed: the rule keeps its id, its page, its options and its place in the config
  schema, it is still `experimental` and still moves no exit code, and three unchanged paths turn
  it on — `profile: "strict"`, `rules: { "layout/half-empty-page": true }`, or
  `--only layout/half-empty-page`. The id is unchanged deliberately: it has been public since 0.5.0
  and lives in configurations, `--disable` invocations, stored reports and fingerprints. The
  threshold was NOT lowered instead; 0.60 is uncalibrated, and a second uncalibrated number would
  have moved the noise rather than accounted for it.
  A profile now decides WHICH rules run, not only how loudly they report. `profile: "strict"` is
  therefore no longer expressible as `default` plus `failOn: warn` plus full coverage floors — it
  also asks for the off-by-default rule, and the contract test that asserted the equivalence says
  so now.

### Thirteen rules now say what to change, and say when nobody checked

- Every rule carries `remediation.advice`: what in the source produces the finding and what
  concretely to change. It reaches the terminal, the HTML report and `Finding.remediation`.
- **All thirteen declare `tested: false`,** and the terminal and HTML say so at the finding. The
  flag is a claim about evidence, not confidence: it can only become true once a gate runs a
  trigger/remedied pair, holds the applied diff against the advice text, checks that no new finding
  arrived, and deletes its target before each run. No such gate ships yet. The previous shape let
  the engine stamp `tested: true` on every remediation it copied, which is how an unverified string
  reaches an agent as a verified one.
- Four advice texts were corrected because a measurement applied the lever each one NAMES, alone,
  to the original trigger document. In **three** of the four the named lever left the finding in
  place and something else in the remedied file had done the work; the fourth described the rule's
  scope wrongly rather than naming an ineffective lever. The four: `artifact/local-uri` (there is no distribution root; every absolute path
  is reported), `layout/unbreakable-block-too-tall` (removing `break-inside: avoid` removed the
  candidate, not the height), `svg/text-overflows-viewport` (`overflow: visible` makes the target
  non-applicable and silences the only rule that gates by default), `layout/hyphen-across-page`
  (the rule keys on the paginator's own hyphenation class, so `hyphens: none` alone leaves the
  finding in place).
- `type/excessive-word-spacing` advises `hyphens: auto` and `layout/hyphen-across-page` advises
  `hyphens: none`. Both texts now name the other rule and say the two pull in opposite directions
  and that neither threshold is calibrated. A human loses an evening to that; an agent on a
  two-attempt budget oscillates.
- **`repair.options` changed for `layout/widow` and `layout/orphan`.** They recommended adjusting
  "the widows setting" and "the orphans setting" — the one advice this project has measured to be
  inert on its own corpus. They now name `break-inside: avoid`, `break-before: page` and rewording,
  and they say which fragment the rule measures: `widow` the one that opens the next page, `orphan`
  the one that closes the page. Consumers reading `repair.options` will see different strings.
- The coverage shortfall block no longer offers `--disable <rule>` in the same words for every
  rule. For a rule whose `error` severity is the only gate this tool has by default, the line now
  says what disabling it costs.

### Reports

- The terminal report opens with a verdict banner and an exit code, sorts findings by document,
  page, severity, rule and position on the page, and prints a coverage block.
- The HTML report carries a remediation box per finding, the untested sentence where it applies,
  and an itemised coverage shortfall block that names the verbatim decline reason and the options.
- **The printed report is longer: 43 page rasters across the four canonical states, up from 32**
  (clean 5, findings 12, infrastructure 13, insufficient-coverage 13). The remediation surface is
  what grew.
- **The printed report no longer ends on a page carrying a single coverage record.** Records do not
  fragment, so the terminal page receives the remainder of the pack, and which remainder that is
  depends on where the findings section above happens to end — measured: twelve pages, ninety-three
  non-whitespace characters on the last. The last two records are now bracketed in a container that
  may not break. The bracket changes no flow height and is inert for every other remainder.

### Documentation

- **One remediation text per rule, and a gate that keeps it that way.** `remediation.advice` in
  `src/rules/**` is what the CLI prints and what travels to every consumer as
  `Finding.remediation`; `docs/rules/<id>.md` is what a person reads. They were written separately,
  and measured on 2026-09-17, 10 of 13 pairs disagreed — the pages between them named eight levers
  the rules do not know, including "remove `break-inside: avoid`" for the one rule whose own advice
  explains why that clears the finding without fixing anything, and "leaving fewer trailing lines"
  for `layout/widow`, which measures the fragment that OPENS the next page. The rule is now the
  single source: each page carries the advice verbatim in a generated block, may add context around
  it, and may not propose a lever the rule does not name. `npm run docs:rules:write` regenerates,
  `npm run docs:rules:check` verifies, and `tests/unit/registry.test.ts` carries the same assertion
  so the unit suite fails on drift. Two doc-only levers were promoted into the rules because they
  are true and checkable from the code — `type/straight-quotes` now names the tags it never
  measures and its `excludeTags` option, `artifact/local-uri` now names an absolute URL on the
  publishing host. The rest were dropped rather than promoted, `text-wrap: pretty` among them:
  nothing in this repository has checked them.
- New `docs/agent-contract.md`: what an agent driving this tool can rely on. It states that no rule
  ships `calibrated: true`, that the fingerprint deliberately carries no page, ordinal, fragment
  index or node key — with the `ord:<n>` exception that applies to a page carrying no semantic
  block — and which five rules set `finding.source` unconditionally to null. `selfcheck:static`
  reads it, so its claims are held against the code.
- `docs/rules/layout-half-empty-page.md` replaces "fires on approximately 90 % of real-world
  documents" with what was measured: 37 of 40 on a corpus constructed for the purpose, and no
  real-world corpus measured at all.

### Apparatus

- Three print mutation controls — `broken-coverage`, `broken-trust-geometry` and
  `broken-terminal-density` — were declared in the renderer and run by nothing, so none of them had
  ever executed. Measured: the first two produce a genuine failing run and are now wired into
  `test:report-surface-mutants`; `broken-terminal-density` could not go red at all and is removed.
  The mutation runner now holds the renderer's allowlist against its own control list, so a control
  that nobody runs is a failing gate.
- New control `broken-tail-cohesion` releases the coverage tail bracket and forces four records per
  page, reproducing the underfilled terminal page exactly. It asserts the phase it reproduces, so a
  future rule count that no longer leaves a remainder of one fails loudly instead of going green.
- The report-surface render manifest carries its own version. Report 4 → 5 briefly moved that stamp
  too; it is back at 4, because the manifest's own structure did not change.
- **The pagination-residue record says that it is historical, instead of failing forever.** Its
  private half compares admitted digests against a bundle that is not in this repository. Measured
  on 2026-09-18: one of the seven admitted artifacts still exists at its recorded digest; the shared
  stylesheet and five of the six documents have changed since the measurement of 2026-09-06. The
  digests were not re-recorded — the expectations beside them were measured on the old bytes, and a
  drifted byte is a red gate, not a re-recorded expectation. The manifest now carries
  `binding.status: "historical"` with the re-measurement in it, and the gate prints a NO CLAIM line
  naming that reason, the same no-claim shape it already used for an absent artifact root. The class
  itself is unaffected: `tests/fixtures/fragmentainer-residue.html` is public and is what CI runs.
- **A cleanup verification read one errno as a verdict it does not carry.** `acquireProducedDocuments`
  closes the process group it owns and then proves it is gone with `kill(pgid, 0)`. Every answer
  except `ESRCH` was treated as "cannot verify" and failed the whole acquisition. Measured on
  darwin 25.6.0 over 20 acquisitions: 8 probes answered `EPERM` for a group this process had created
  and owned, and in all 8 the next probe — 0 ms or 10 ms later — answered `ESRCH` with the
  descendant dead. So 40 % of otherwise successful producer runs on a loaded developer machine
  reported `source/producer-incomplete`, which is the machine this tool is for. `EPERM` is now read
  as indeterminate and retried inside the bounded deadline it already had; an indeterminate answer
  that survives the deadline still fails the acquisition, and a group that is genuinely still there
  still fails as "survived bounded cleanup". The errno truth table is pinned in a unit test.
  Measured after: 0 of 24 spurious failures at a higher load than the 8-of-20 run.
- **Three unit tests bounded a subprocess start-up and reported the result as a product defect.**
  `source-boundary-regressions` raced a 700 ms and a 2 s acquisition budget against spawning a node
  process that spawns another, and read the descendant's pid file without checking it existed —
  under load the answer was `ENOENT`, which reads in the TAP output as a cleanup failure. The
  descendant now registers synchronously from its parent the moment it is spawned, the budgets are
  sized for what they wrap rather than for a stopwatch, and a missing registration says so instead
  of throwing. `render-run`'s cleanup-escalation test bounded a 5 s product wait at 8 s and failed
  at 8700 ms on a busy machine; the lower bound is the claim and is unchanged, the ceiling now only
  separates "waited" from "hung". Measured on this machine before the change: three full runs of
  that file, three red. After: three full runs, three green, the last at a higher load than any of
  the three that failed.
- **The `selfcheck:live` red control had an expiry date and reached it.** It multiplied the first
  finding card's own height with `transform: scaleY(20)`, so the injected fault was a multiple of
  the card's content. Once each card gained a remediation box, the same injection produced a card
  the paginator fragmented into nineteen pieces; the rule measured fragment 0 at 895.9 px against a
  1031.8 px page and the whole chain went green on a real fault. The injected height is now
  absolute, and the control additionally asserts that the block it reported is the one that was
  injected, at its whole height. Verified to go red on this release and on 0.5.0 alike, and
  verified to fail loudly when the injected height is put back below the page.

## 0.5.0 — 2026-09-13

- Add installed public producer, existing-page, comparison and canonical report-bundle APIs.
- Version live document Report/Snapshot contracts to 4; preserve separate Configuration Contract 1.
- Bind generated input bytes and verified original source ranges through bounded producer receipts; preserve unknown and ambiguous provenance.
- Preserve the exact diagnostic PDF and hash-bound page evidence; fix cross-page overlay marks that could change print scale. Required evidence gaps now prevent a clean claim.
- Add visible web overflow and clipping diagnostics with named scroll/overlay exceptions, bounded inventory and explicit unsupported paint/stability states.
- Compare positive target measurements under verified revision, configuration, resource and renderer conditions; reduced coverage is never a repaired finding.
- Add offline human cards and bounded untrusted AI context from the same JSON, with checked evidence assets and explicit omissions.
- Extend the Actions one-tarball release route to test ESM, require(ESM), TypeScript and a real Playwright consumer.
- Pre-release review corrections: withhold host paths after brackets in AI-context diagnostics, keep `$` sequences from document text literal in written HTML, refuse symlinked bundle files, require a positively measured baseline before a comparison reports `resolved`, and align the exported screen-options schema with runtime validation.


## 0.4.0 — 2026-09-05

A minor rather than a patch for one reason: on a document whose paginator left unplaceable
table content in an overflow column, `exitReason` changed from `checker-crashed` to
`render-unstable`. Exit code 3 in both cases, report schema unchanged.

### Content a paginator could not place is now named, not reported as a crash

The first run against a corpus that was not this repository's own: eighteen chapters of a shipped
HTML bundle. Twelve measured. Six ended `exit 3`, `checker-crashed`, with the payload
`{"freezeChanged":true,"mutationDelta":0,"sidMutationDelta":0,"sidIssues":[],"pageErrors":[],
"networkActivity":0,"inFlight":0,"pendingBodies":0}` — a fatal verdict with no cause a reader could
act on, and no fixture in this repository had ever produced it.

- **Measured what the six had that the twelve did not.** Not size, not inline script, not generated
  content, not duplicate ids, not the number of tables. Paged.js fragments a page by making
  `.pagedjs_page_content` a multi-column container whose pitch is the content width plus a gap of
  `margins + bleed + 1000px` — 1816 px on this corpus. Content it fails to move onto a new page
  stays in the second column, one pitch to the right, clipped out of sight by an `overflow: hidden`
  sheet. **6 of 6** failing documents had at least one page carrying a TABLE box there; **0 of 12**
  passing documents did. Two of the twelve carried residue of other kinds — a `<p>`, an `<em>` — and
  measured cleanly, which is why residue alone is reported and not made fatal on its own.
- **Why a table.** `page.pdf()` renders in print media, where Paged.js's own stylesheet re-sizes
  `.pagedjs_page` and `.pagedjs_sheet` to `height: 100%`. The fragmentainer height changes and the
  overflow column is re-fragmented. Ordinary block content reproduces its boxes; a table row cannot
  be split, so it moves back into the first column — and it stays moved. Sampled four times at
  300 ms after the PDF, the layout never returned to its pre-PDF state.
- The PDF reconciliation now reports `render-unstable` rather than an anonymous `checker-crashed`.
  Nothing crashed: the PDF does not reproduce the geometry the rules measured, which is the same
  statement `evidence.ts` already makes about a divergent mark page. The event names the freeze
  components that moved, the individual box entries with both values, and the residual elements with
  their source ids, pages and the column pitch.
- The geometry cross-check names the same cause. Measured on a reduced document: the in-page probe
  and CDP's layout tree disagreed by exactly one pitch, 1816.0000 px against a 0.05 px tolerance,
  and the sentence told the reader that this tool's own probe could not be trusted. It could.
- Added `tests/fixtures/fragmentainer-residue.html`, reduced from one of the six until no product
  text remained: no `@page`, no print stylesheet, no `break-inside`, no script — a default-letter
  page, a 68ch measure and a table that crosses a page boundary. That reduction is itself the
  measurement that nothing exotic is required, and it is what holds this class in CI.
- Added `corpus/public/pagination-residue-v1` as a **hash-only record**. The six documents are
  chapters of a paid product — 27 492 of that bundle's 69 017 words — and this repository is public
  and MIT, so their SHA-256 values, byte lengths, rights and privacy review and exact expected
  residue are public while their bytes are not. This is the `private_nonredistributable` shape
  `docs/validation/corpus-contract-v1.md` already defines: *"a hash-only public record documents
  existence without pretending that an unavailable artifact was verified."* Without
  `BREAKLINT_RESIDUE_CORPUS_ROOT` the gate prints `SKIPPED`, says how many documents it did not
  read, and makes no success claim; with it, nothing is softened — every admitted byte is hashed
  before Chrome starts and the per-document residue pages, counts and pitch are compared exactly.

### Named, with numbers: what a haloed SVG label costs

`env/svg-painted-bounds-unsupported` reads as an environment limit and is not one.
`docs/limitations.md` now carries the measurement: over the same eighteen documents, two chapters
measured 30/30 and 24/24 SVG `<text>` targets at coverage 1, while three declined 15, 17 and 3 —
exactly their count of `<text paint-order="stroke fill" stroke="var(--bg)">`, the ordinary halo that
keeps a diagram label legible over a line. `getBBox()` returns the fill outline, so the tool refuses
to judge an overflow against a box that describes different ink. The named next step is written down
too: the fill box and the fill box inflated by `stroke-width / 2` are a sound two-sided bound, and on
that corpus the halos are 2–4 px, so almost all 35 declined targets are decidable without an ink
pass.


## 0.3.1 — 2026-08-30

The first `v0.3.0` tag run stopped before publication: both clean consumers installed the optional
renderer peers correctly, but the real-document gate started their CLI with the repository checkout
as its working directory. Local and ordinary CI runs inherited the checkout's dev dependencies and
therefore hid that boundary error. Version 0.3.1 makes the child working directory mandatory and
passes it explicitly in the source and both installed-package gates; the failed tag is retained
rather than moved, and no `breaklint@0.3.0` package or GitHub Release was created.

### Real-document robustness before trust infrastructure

- Added a mandatory real-document gate over two frozen, rights- and privacy-reviewed public HTML
  artifacts. The third-party Project Gutenberg document was not authored for this repository; it
  produces exactly 9 pages, measures 9/13 rules and exits 0. The first-party Dargel document
  separately exercises absent-resource packaging: exactly 6 pages, 11/13 rules measured and Exit 0.
  Both admitted SHA-256 values, exact semantic counts and infrastructure contracts are pinned. The
  published 0.2.3 package is the recorded red control: the third-party document ends Exit 3 before
  producing a usable report. CI, the source release gate and both clean installed tarball consumers
  run both documents.
- Fixed the geometry oracle without widening its `0.05 px` tolerance. CDP's four-corner quad is now
  converted to an axis-aligned envelope using all corners; the former shortcut was wrong by 23 px
  on a rotated HTML block. SVG graphics descendants are excluded from the CSS-box cross-check
  because CDP includes stroke/paint extents while `getBoundingClientRect()` reports SVG geometry.
  Authored CSS can likewise reset a source block to an inline formatting box whose child-union has
  different CDP/GCR semantics; that box is excluded while its block children remain eligible. The
  two real corpus SVGs differed by up to 0.5477 px and 3.0656 px, and the third-party HTML exposed
  an 18 px inline-box difference. None was a tolerance problem.
- Standalone `.svg` and every other non-HTML input now fail deterministically with usage Exit 2
  before the renderer starts. Inline SVG in `.html`/`.htm` remains supported by the released SVG
  viewport rule. The previous path parsed arbitrary extensions as `/document.html` and failed late.
- A failed image decode is no longer an anonymous `checker-crashed` when the source explicitly
  declares positive `width` and `height` attributes and the browser measures a box exactly equal
  to both values. It
  becomes the named, non-fatal
  `image-content-unavailable` event with a non-identifying resource index and measured dimensions.
  Absolute file URLs and remote query strings are not persisted in the report. Missing authored
  dimensions, a differing or zero-size rendered box, and authored CSS overrides remain fatal because
  replacement text is not stable image geometry and the absent content can change layout.

### Thirteen released rules, not fifteen advertised definitions

- Withdrew `svg/text-clipped` and `svg/text-ink-collision` from the released registry, CLI config,
  generated schema, SARIF catalogue, community issue form and demo. Production acquisition has no
  ink pass and never wrote `inkCollected: true`; counting both rules was a capability claim over a
  path no document reached. Their modules and 78/78 real-renderer M3 lab remain explicitly
  research-only for a later, separately designed ink milestone.
- Migration from 0.2.x: a config that names either withdrawn rule ID now fails closed as invalid
  usage (Exit 2). Remove those keys; there is no replacement rule until a production pixel pass
  has an independent oracle and real-document coverage.
- Removed all hand-authored ink counts and `inkCollected: true` from the demo snapshot. `--demo`
  now reports seven real rule-chain findings, 13 rules run and 11 rules measured; it cannot display
  an SVG ink finding that live acquisition cannot create.
- Kept every released rule `calibrated: false`. No threshold, severity, structural proof-source-A
  threshold or calibration type changed.

### Plan and public truth

- Split the former parked M3-1 plan: M3-1a covers rights-cleared corpus breadth and acquisition
  robustness and is active before governance; M3-1b retains blind human labels, adjudication,
  external attestation and externally controlled freeze and remains parked. The disabled
  attestation workflow stays disabled.
- Rewrote the current-state section and marked contradictory pre-release passages as historical.
  README, rule docs, limitations and generated schema now describe the same 13-rule,
  0/13-calibrated product contract. The coordinated website copy has a separate repository,
  work item and deployment gate; this package does not claim that deploy before it is live.
- Kept the 0.2.3 human report-surface ledger historical instead of restamping 32 cells without a
  person. The 0.3.1 release gate reconstructs all 32 current cells and verifies 59 physical
  artifacts (24 screens, 4 PDFs, 31 page rasters), decoded pixels, contrast, accessibility, print
  fragmentation and a pixel-mutation red control, while making no human-review claim.

## 0.2.3 — 2026-08-29

Released from annotated tag `v0.2.3` after the independent verifier passed the complete state with
no open Blocker/High finding. The Founder reviewed and accepted the 21 changed rendered views and
the complete PDF set, and the ledger is bound to that review. The tag workflow exercised one
checksum-bound tarball in clean Node 22.13.0 and Node 24 consumers before publishing those exact
bytes to npm with signed provenance and attaching them to the GitHub Release.

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

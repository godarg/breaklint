# `layout/orphaned-continuation-page`

| | |
|---|---|
| severity | warn |
| threshold | `netFill < 0.50`, on a page whose content ends there: the next page does not open with its text running on |
| proof source | — |
| calibrated | **no** |

## What is checked

A page holds nothing but the tail of a block that began earlier.

A page that is neither a parity blank page nor one the author forced open (both are declined) is reported when all three of these hold, and its evaluation in the JSON report records all three:

- `continuation-only` — every block of the page's flow is a continuation of a block that began on an earlier page;
- `ends-on-page` — what the page carries ends on it: the next page does **not** open with text running on from it;
- `net-fill` — the page's net fill is below `maxNetFill`.

"Text running on" is a text line of a block that continues onto the next page and that opens it: its glyph box starts less than one of that block's line heights below the top of the next page's content (the higher of its first fill band and its first block that starts there) — or an inline SVG shares the line (the SVG overlaps the glyph box vertically, lies across the line's block horizontally, and itself starts less than one line height below the top), in which case the line is as tall as the SVG makes it and the window reaches one line height past the SVG's bottom. Such a line must also not lie — by the centre of its box, within 1 px — inside a block that starts on the next page and follows the continuing block in document order: a wrapper's lines include its children's, and the caption of a carried figure is recorded as the section's line too, but it is the figure's. Measured under 48 px lines: 70–100 px inline SVGs on the first line's baseline, glyph boxes starting 56–86 px down; the full page before each is not reported. Text that resumes below a block-level SVG shares no line with it and keeps the one-line window.

"The page's flow" means the blocks that have a box and lie at least partly inside the page's content box, top to bottom. The in-flow original that a `position: running()` element leaves behind with `display: none`, and an empty positioned marker, have no box and move nothing. The rule relies on the collector keeping margin-box content out of the snapshot, as the collector of this release does: a clone of a running or fixed element in a top or bottom margin box normally lies outside the content box, but a clone in a side margin box does not, and would count.

## Why

The threshold is chosen. `data-split-from` proves a fragment is a continuation; it does not prove a defect.

`ends-on-page` is not chosen. When the text of a block runs on to the next page and opens it, the page stopped because its next line did not fit, so it is full, whatever its net fill reads. Without this condition the rule reported every page between the first and the last page of a long block once the leading was generous: net fill counts glyph boxes, not line boxes, and full pages of one long paragraph measured 0.34–0.36 at `line-height: 3` (12 pt on A5 and 11 pt on A4; Chromium 141, Paged.js 0.4.3, the measuring machine's default serif).

Anything else that opens the next page means the page ended early and is judged: a block that starts there, an image or an SVG that did not fit, a forced break, the end of the document. The condition reads no box of the continuing block, so a wrapper's border kept at the split or a full-bleed child does not change it, and it does not ask which block closes the page, so a nested child that ends there while its wrapper's text runs on does not make a full page a tail. Measured (Chromium 141, Paged.js 0.4.3):

- a `<section>` whose own 200 px SVG was left alone on a page because its next child, a `break-inside: avoid` figure, did not fit reads 0.31 and is reported; with an image instead, 0.39; with three lines of bare text, 0.08; with a 2 px border and padding on the section, or with the figure bleeding 20 mm into both margins, 0.31 — 0.6.0 reported all of these, and so does this rule;
- the same section whose second, 500 px SVG — its own content, not a block — did not fit reads 0.31 and is reported;
- a section with bare text after its paragraph, and a float split into an empty first fragment, left full middle pages whose last block ends there; the wrapper's text runs on, and neither page is reported;
- an absolutely positioned badge (`top: 0`) and a relatively offset aside at the top of the next page, beside the running text, no longer make the full page before it a tail.

Neither half of this needs a threshold or a calibration; it follows from how the paginator breaks.

## Limits and known false alarms

A block footnote printed on the page is not fresh content: it lies in the footnote area below
the content box and is not part of the page's flow, so a page that carries only a continuation and
the footnote of that continuation is still reported. Its fill is the fill of the content box, which
Paged.js shortens by the footnote area's height. A page whose content box holds nothing while it
prints blocks elsewhere — a long footnote carried over to a page of its own — is declined as
`env/invalid-measurement`, counted against coverage: its flow is empty and its fill is the fill of
an empty box.

Declined after a forced incoming break. Reading the break reason from the computed style is verifiably wrong in both directions: `break-before: page` from a stylesheet reads back as `auto`, while the same declaration written inline survives as `page` and is measured *not* to take effect.

**At a large line height every tail page is reported, however full.** A page whose content ends on it is judged by net fill, and net fill counts glyph boxes, not line boxes: with the fonts measured here a page filled to its last line reads 0.51–0.54 at `line-height: 2` and 0.34–0.36 at `line-height: 3`, and the reading depends on the font. So at `line-height: 3` any tail page falls below 0.50, whatever follows it — a forced break, the end of the document, or a block that did not fit. Measured: a page holding 11 of its 13 lines, followed by a figure that did not fit, reads 0.29 and is reported; a tail page filled to its last line reads 0.34 and is reported. A line-box fill would remove that; it changes the snapshot and the meaning of `maxNetFill`, and it is not in this release.

**A block that covers the running text takes it for its own.** A block that starts on the next page, follows the continuing text in document order and contains the centres of its lines — a positioned overlay, for instance — makes that text look like its own, and the full page before it is judged. Pinned by a unit case; not measured on a real document.

**Side margin boxes need the collector.** With a collector that records margin-box clones, a clone in a side margin box lies inside the content box vertically, carries text and continues from page to page: it counts as running text on the next page and, where it first appears, keeps a tail page from carrying continuations only. Measured with such a collector: a two-line tail page under a running element placed in a side margin box was not reported. The collector of this release excludes margin-box content, and with it the same page is reported.

**The extra room is given for inline SVG only.** The snapshot records a box for every SVG, but none for an inline `<img>`, `<canvas>` or `<video>`. A first line on the next page that carries one of those on its baseline keeps the one-line window, and the full page before it can be reported: measured with an 80 px image or canvas under 48 px lines, the glyph box starts 66 px down and the full page before it is reported. This errs toward reporting. The window also uses the line height of the recorded block a line belongs to, not the line's own: text in an element the collector does not record as a block — a `display: block` span, a custom element — is measured against its enclosing block's line height. The follow-up is a snapshot field for replaced-element boxes (and a line's own line height), planned alongside the line-box fill; both change the snapshot.

**Elements the collector does not record as blocks count as their wrapper's content.** The collector records only a fixed set of block tags. A monolithic element outside that set that starts with text — an `inline-block` callout, a `display: block` span with padding or margin, a custom element — is not a block of its own: when it opens the next page, its text counts as the wrapper's running text, and the page before it is not judged even if the element was carried over whole. Measured with such callouts; the collector is not widened in this release.

**The top of the next page is quantised.** Where the top comes from the first fill band, it is read from `topGap`, which the snapshot rounds to 0.01 of the content-box height — about ±3 px on an A5 page. A line whose glyph box starts within that distance of the one-line bound can fall on either side of it.

**Document order matters.** It is the order in which the collector records the blocks of a page, and the rule relies on it: a wrapper comes before its children, so on the next page a continuation comes before any child of it that starts there, and only such a later block can own the continuation's lines. Blocks of the footnote area lie below the content box and are not part of the page's flow here; measured on the live fixtures `footnotes-block.html`, `footnotes-named-page.html` and `footnotes-heading-in-note.html`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/orphaned-continuation-page -->
A continuation page holds only a tiny trailing fragment of an earlier block. Tighten preceding vertical margins, padding, or line-height on earlier pages to pull the remaining lines back, or insert 'break-before: page' earlier to balance content across pages.
<!-- end generated remediation: layout/orphaned-continuation-page -->

## Examples

### Firing case (trigger)

```html
<!-- The last two lines of a long paragraph overflow onto page 2, and the next chapter forces a
     page break right after them: page 2 carries only the end of that paragraph -->
<style>
  h1 { margin-bottom: 4em; }
  p { line-height: 1.5; }
  .chapter { break-before: page; }
</style>
<h1>Chapter one</h1>
<p>…enough text to fill page 1, and two lines more…</p>
<h1 class="chapter">Chapter two</h1>
```

### Firing case (a carried child)

```html
<!-- The section's own chart is left alone on a page because its next child, a figure that must
     not break, does not fit under it. The section continues, but the next page opens with the
     figure, not with text running on: the page ended early, and it is reported. -->
<section>
  <p>…text to the foot of page 1…</p>
  <svg width="300" height="200">…</svg>
  <figure style="break-inside: avoid">…500 px…</figure>
</section>
```

### Non-firing case (remedied)

```html
<!-- A tighter vertical margin above the paragraph on page 1 pulls its last two lines back -->
<style>
  h1 { margin-bottom: 0.5em; }
  p { line-height: 1.5; }
  .chapter { break-before: page; }
</style>
<h1>Chapter one</h1>
<p>…the same text, now ending on page 1…</p>
<h1 class="chapter">Chapter two</h1>
```

### Non-firing case (a continuing block)

```html
<!-- A paragraph that runs over five pages: pages 2 to 4 carry nothing but its continuation,
     and at line-height 3 their net fill reads about 0.35. The paragraph goes on to the next
     page from each of them, so none is judged; only the page it ends on is. -->
<p style="line-height: 3">…five pages of text…</p>
```

Illustrative, like every example on these pages: the advice ships `tested: false`, and no
trigger/remedied pair in this package demonstrates it. The remedied example changes a preceding
vertical margin, which the advice names. `tests/unit/registry.test.ts` compares
every CSS lever it tracks between trigger and remedied example against the levers the advice
proposes; `line-height` is one of them, margins are not.


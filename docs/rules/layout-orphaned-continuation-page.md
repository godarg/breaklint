# `layout/orphaned-continuation-page`

| | |
|---|---|
| severity | warn |
| threshold | `netFill < 0.50`, on a page whose last block ends there |
| proof source | — |
| calibrated | **no** |

## What is checked

A page holds nothing but the tail of a block that began earlier.

A page that is neither a parity blank page nor one the author forced open (both are declined) is reported when all three of these hold, and its evaluation in the JSON report records all three:

- `continuation-only` — every block of the page's flow is a continuation of a block that began on an earlier page;
- `ends-on-page` — what the page carries ends on it: its last block in document order is that block's final fragment, **or** the next page (the next one that is not a parity blank) opens with a block that starts there;
- `net-fill` — the page's net fill is below `maxNetFill`.

"The page's flow" means the blocks that have a box and lie at least partly inside the page's content box, top to bottom. A `position: running()` element that Paged.js clones into a margin box, and the in-flow original it leaves behind with `display: none` and no box, are not content of the page and move neither condition. "Opens with" means that every block before the fresh one on the next page, in document order, is a wrapper of it: it starts no higher than the fresh block (within 1 px) and spans it horizontally.

## Why

The threshold is chosen. `data-split-from` proves a fragment is a continuation; it does not prove a defect.

`ends-on-page` is not chosen. When the text of a block runs on to the next page and opens it, the page stopped because its next line did not fit, so it is full, whatever its net fill reads. Without this condition the rule reported every page between the first and the last page of a long block once the leading was generous: net fill counts glyph boxes, not line boxes, and full pages of one long paragraph measured 0.34–0.36 at `line-height: 3` (12 pt on A5 and 11 pt on A4; Chromium 141, Paged.js 0.4.3, the measuring machine's default serif).

The second half of the condition exists because "the last block continues" does not prove that. A wrapper such as `<section>` or `<article>` continues onto the next page whenever any of its children is carried there, and its own content on the page — bare text, an image, an SVG — can end high on it. Measured: a section whose own 200 px SVG was left alone on a page because the next child, a `break-inside: avoid` figure, did not fit read 0.31 and was not reported; with an image instead, 0.39; with three lines of bare text, 0.08. When the next page opens with a block that starts there, the break fell between blocks, and each of those pages is now reported. Neither half needs a threshold or a calibration; both follow from how the paginator breaks.

## Limits and known false alarms

Declined after a forced incoming break. Reading the break reason from the computed style is verifiably wrong in both directions: `break-before: page` from a stylesheet reads back as `auto`, while the same declaration written inline survives as `page` and is measured *not* to take effect.

**At a large line height every tail page is reported, however full.** A page whose content ends on it is judged by net fill, and net fill counts glyph boxes, not line boxes: with the fonts measured here a page filled to its last line reads 0.51–0.54 at `line-height: 2` and 0.34–0.36 at `line-height: 3`, and the reading depends on the font. So at `line-height: 3` any tail page falls below 0.50, whatever follows it — a forced break, the end of the document, or a block that did not fit. Measured: a page holding 11 of its 13 lines, followed by a figure that did not fit, reads 0.29 and is reported; a tail page filled to its last line reads 0.34 and is reported. A line-box fill would remove that; it changes the snapshot and the meaning of `maxNetFill`, and it is not in this release.

**A wrapper's own image or SVG that does not fit is not caught.** When such a replaced element moves to the next page, the wrapper's continuation opens that page with content of its own, which cannot be told apart from text running on, so the page before it counts as full. Measured: a section whose own 500 px SVG did not fit under its other, 200 px SVG, left a page at 0.31 that is not reported. Put the element in its own block, a `<figure>` or a `<div>`, and the next page opens with that block and the page is reported.

**A float at the top of the next page counts as opening it.** A fresh floated block that the next page's continuing text flows beside starts at the height of that text and lies inside its wrapper, so the page before it is judged although its text ran on. Not measured.

**"Last" means last in document order.** That is the order in which the collector records the blocks of a page, and the rule relies on it: a wrapper such as `<main>` or `<section>` comes before the paragraph inside it, so the page ends in the paragraph, not in the wrapper, and on the next page a wrapper's continuation comes before the fresh child it holds. Blocks of the footnote area lie below the content box and are not part of the page's flow here; no document with footnotes was measured.

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
     figure: the break fell between blocks, and the page is reported. -->
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


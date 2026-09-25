# `layout/unbreakable-block-too-tall`

| | |
|---|---|
| severity | error |
| threshold | the page content box height |
| proof source | A |
| calibrated | **no** |

## What is checked

A block with `break-inside: avoid` is taller than the content box of the page it was laid out on.
An unsplit block is judged on its box. A block the paginator had to split anyway is judged on a
lower bound — the height of the text lines and the replaced content (images, SVG, canvas, video,
embedded frames, form controls) in its fragments — and the finding says **"at least"**.

## Why

One of two rules that carry `error`. A measured height against a structural boundary: a block taller
than the page cannot keep its own promise not to break there. That is arithmetic, not convention —
and it is why the number it reports must be one the block is provably at least as tall as, never an
estimate.

## Limits and known false alarms

It declines rather than judges, and every decline counts against the rule's coverage (a run with a
decline of this rule ends with exit 4 under the default floor): multi-column layout of the block
itself (`env/multicolumn`), vertical writing (`env/vertical-writing`), and every block whose height
the snapshot cannot establish (`env/invalid-measurement`, below). The evaluation row of a decline
names what was not established.

**An unsplit block** is judged on its box, exactly. It is declined when the box is not its laid-out
height: when the block or an ancestor is transformed (`flow-hazards`: `self:transformed` or
`around:transformed`), or when the box reaches past the sheet into the overflow column Paged.js
hides beside the page, where the browser reports the union of both columns one page tall
(`box-within-the-sheet`). A very tall image the paginator could not split is its own box and is
reported (measured: a block holding a 500 px SVG, reported at 500 px on a 340.16 px page).

**A split block is reported as a lower bound, not as its height.** Paged.js does not fragment
natively: it builds one element per page, repeats a block's border (and `!important` or inline
padding) at every split edge, and, because it ignores that repeated bottom edge when it picks the
break, pushes the last line before the split into the hidden overflow column. The fragment boxes do
not add up to the block in either direction: measured on 2026-09-24, a block 301.19 px tall had
fragment boxes summing to 417.47 px, and a margin Paged.js unset at a split made another sum 12 px
short of its block. What the rule adds up instead is, per fragment, the extent of its text lines
and replaced content that start in the page's own column, clipped to the fragment box, less the
snapshot's rounding and any overhang of glyph boxes taller than the line height; the sum is rounded
down. Measured on Paged.js 0.4.3 (patched Chromium 141): a plain block split in two reads 7.34 px
below its unsplit height; a figure of five 200 px panels and a caption 2.71 px below; a block with a
20 px border split in three 88.33 px below (40 px of border, two lines in the overflow column, the
half-leading at the fragment ends).

Why the sum is at most the unsplit height: inside one fragment, content in a single untransformed
block-direction flow keeps the offsets it has in the unsplit block, and Paged.js places each piece of
content once, in order. So each fragment's extent is a piece of the unsplit block, the pieces follow
one another, and what a split adds (repeated borders and padding, the overflow of the repeated
bottom edge) lies outside every extent. That argument holds only for content in one flow, so a split
block is **declined** when the snapshot records anything else inside it, on it or around it — the
Snapshot 5 `flowHazards`:

- an element inside it that is absolutely or fixed positioned, relatively offset, sticky,
  transformed, floated, multi-column, a flex or grid container, a table row of two or more cells, in
  vertical writing, or pulled up by a negative block margin; replaced content that overflows a
  block-level ancestor that does not clip it. Measured on 2026-09-25 (Paged.js 0.4.3, patched
  Chromium 141): paragraphs moved 55 px up and 70 px down by `position: relative` made the lines of a
  block 301.19 px tall read 360.19 px, a two-column descendant made a block 335.81 px tall read
  347.13 px — both above the 340.16 px page. **A split block containing a table of two or more
  columns, or a multi-column, flex or grid layout, is not judged.**
- the block itself or an ancestor up to the page content being any of those, except the
  inside-only negative margin and overflow.

It is declined too where the fragments themselves show a premise failing: text of two elements side
by side; a piece of a split element that does not end or begin its fragment (the paginator repeated
or moved content; measured with an absolutely positioned caption); content reaching out of its own
element's box by more than its glyph overhang (a fixed height repeated on every fragment); nothing
countable at all.

**A split block whose bound is at or below the page is declined as inconclusive**, with the bound on
the row: it is never reported, and it is never called clean either. The lower bound proves nothing
there, and nothing in the snapshot proves such a block fits — the fragment boxes are no upper bound.
This is the case of a block that fits an empty page but was split because an ancestor's border took
the room, and of a block barely taller than a page whose borders and padding the bound leaves out.

What the snapshot cannot see is assumed, and a document that breaks one of these assumptions could be
reported although the block would have fitted:

- the hyphen Paged.js appends at a split inside a word (U+2011) is no wider than the one the browser
  drew there, and a continued piece of a paragraph does not wrap into more lines than the same text
  had unsplit (Paged.js unsets `text-indent` on it);
- every line box is at least as tall as the smallest `line-height` of the elements recorded in its
  fragment;
- no content is repeated or moved by the paginator without an element of its own, and nothing sits
  side by side without an element of its own (inline blocks).

Content the bound does not count — borders, padding, margins, backgrounds, generated content, list
markers, empty boxes, a line in the overflow column — only makes the bound smaller. A fragment on a
page whose content box has a different width from the first fragment's (a named landscape page) is
left out, and the row records how many were (`fragments-left-out`).

A block the paginator split is judged on all of its fragments, joined by source id. A split block
whose fragments cannot be joined — it has no source id (a `--no-source-map` run, or an element a
script created), or its source id does not account for every fragment the snapshot counted — is
declined as `env/invalid-measurement` rather than judged on one fragment.

Which records are fragments is decided by the page structure, not by coordinates. A fragment that
bleeds into the page margin (negative margins, a full-bleed figure) still counts. Content in a page
margin box is not part of the flow and is not measured: a `position: running(...)` element is
represented only by its in-flow original, which Paged.js hides with `display: none`. A block with
no layout box — that original, or anything else under `display: none` — was never placed by the
paginator, so it is recorded as `excluded` (`rule/target-not-rendered`), outside the coverage base,
and never as a measurement of 0 px. A split block whose first piece has no box but a later piece
does was placed, and is declined instead. See `docs/limitations.md`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/unbreakable-block-too-tall -->
A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where the paginator had split it anyway, the reported height is a lower bound — the height of the text lines and the images or other replaced content in its fragments, without borders, padding or the space around them — so the block is at least that tall. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.
<!-- end generated remediation: layout/unbreakable-block-too-tall -->

## Examples

### Firing case (trigger)

```html
<!-- A5 page, 20 mm margins: about 640 px of content per page. Forty one-line
     paragraphs at 11pt/1.5 with 4pt between them come to about 1090 px, so Paged.js
     splits the section in two anyway, and neither fragment is taller than a page.
     The finding counts the text lines and replaced content only (measured on
     2026-09-24 and again on 2026-09-25: "at least 1070.45 px tall across the 2
     fragments"). -->
<section style="break-inside: avoid;">
  <p>Paragraph 01 of the section: one line of body text.</p>
  <!-- … paragraphs 02 to 39 … -->
  <p>Paragraph 40 of the section: one line of body text.</p>
</section>
```

### Non-firing case (remedied)

```html
<!-- The same content split deliberately into two sections, each shorter than a page.
     Both still ask not to be broken, and both can keep that promise. -->
<section style="break-inside: avoid;">
  <p>Paragraph 01 of the section: one line of body text.</p>
  <!-- … paragraphs 02 to 19 … -->
  <p>Paragraph 20 of the section: one line of body text.</p>
</section>
<section style="break-inside: avoid;">
  <p>Paragraph 21 of the section: one line of body text.</p>
  <!-- … paragraphs 22 to 39 … -->
  <p>Paragraph 40 of the section: one line of body text.</p>
</section>
```

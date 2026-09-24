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
lower bound — the height of the text lines in its fragments — and the finding says **"at least"**.

## Why

One of two rules that carry `error`. A measured height against a structural boundary: a block taller
than the page cannot keep its own promise not to break there. That is arithmetic, not convention —
and it is why the number it reports must be one the block is provably at least as tall as, never an
estimate.

## Limits and known false alarms

It declines three things rather than judging them, and every decline counts against the rule's
coverage: multi-column layout (`env/multicolumn`), vertical writing (`env/vertical-writing`), and a
split block it cannot bound (`env/invalid-measurement`, below).

**A split block is reported as a lower bound, not as its height.** Paged.js does not fragment
natively: it builds one element per page, repeats a block's border (and `!important` or inline
padding) at every split edge, and, because it ignores that repeated bottom edge when it picks the
break, pushes the last line before the split into a hidden overflow column beside the page. The
fragment boxes therefore do not add up to the block: measured on 2026-09-24, a block 301.19 px tall
that fits the page had fragment boxes summing to 417.47 px. What the rule adds up instead is, per
fragment, the extent of the text lines that start in the page's own column, clipped to the fragment
box. Everything a split adds or removes lies outside those extents, so their sum cannot exceed the
unsplit height — but it is below it by the block's own borders and padding, by every line Paged.js
pushed into the overflow column (such a line is printed nowhere), and by the half-leading at both
ends of every fragment (3.66 px per fragment at 10pt/1.4). Measured: a plain block split in two reads
7.33 px below its unsplit height, a block with a 20 px border split in three 88.32 px below (40 px of
border, two lines in the overflow column, 11 px of half-leading). A split block whose bound stays at
or below the page is **not reported**, even when the block itself would not have fitted: the bound
is one-sided.

A split block is **declined** instead of bounded where the snapshot shows the bound's premises
failing:

- text of two elements side by side in one fragment — cells of one table row, flex or grid items, a
  float beside a paragraph. Paged.js lays out every fragment of a table as a table of its own, with
  its own column widths, and moves the cells after a split cell to the next page whole; measured, a
  two-column row split inside its first cell produced 697.95 px of lines for a block 522.38 px tall.
  **A split block containing a table of two or more columns is therefore not judged.**
- a piece of a split element inside a fragment that does not end or begin the fragment's text: the
  paginator repeated or moved content. Measured: an absolutely positioned caption at the foot of a
  split block made Paged.js lay the same lines out again on the next page.
- a text line reaching out of its own element's box by half its height or more: text overflowing a
  fixed height (repeated with that height on every fragment), or moved by an offset or a transform.
- no text line at all: a split block of images has nothing to bound it with.

What the snapshot cannot see is assumed, and a document that breaks one of these assumptions can be
reported although the block would have fitted:

- **no absolutely positioned, fixed or transformed text inside the block that stays inside its box,
  no side-by-side content without an element of its own** (inline blocks, anonymous flex items, text
  beside an image float), **and no content the paginator repeats outside an element of its own**;
- the hyphen Paged.js appends at a split inside a word (U+2011) is no wider than the one the browser
  drew there;
- every line box is at least as tall as the smallest `line-height` of the elements recorded in its
  fragment. Where a glyph box is taller than that line height, the overhang is given back per
  fragment rather than counted on both sides of a split.

A fragment on a page whose content box has a different width from the first fragment's (a named
landscape page) is left out of the bound: its text would break into different lines.

An unsplit block is judged on its box. When that box itself overflows the page into the overflow
column — content Paged.js found no break in, such as one very tall image — the browser reports the
union of both columns, which is never taller than the page: such a block is never reported, and the
height recorded for it is not its height (measured: 321.19 px recorded for a block 301.19 px tall).

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
and never as a measurement of 0 px. See `docs/limitations.md`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/unbreakable-block-too-tall -->
A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where the paginator had split it anyway, the reported height is a lower bound — the height of the text lines in its fragments, without borders, padding or the space around them — so the block is at least that tall. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.
<!-- end generated remediation: layout/unbreakable-block-too-tall -->

## Examples

### Firing case (trigger)

```html
<!-- A5 page, 20 mm margins: about 640 px of content per page. Forty one-line
     paragraphs at 11pt/1.5 with 4pt between them come to about 1090 px, so Paged.js
     splits the section in two anyway, and neither fragment is taller than a page.
     The finding counts the text lines only (measured on 2026-09-24: "at least
     1070.45 px tall across the 2 fragments"). -->
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

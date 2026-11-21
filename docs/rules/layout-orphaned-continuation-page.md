# `layout/orphaned-continuation-page`

| | |
|---|---|
| severity | warn |
| threshold | `netFill < 0.50`, on a page whose content ends there: the next page does not open with its text running on |
| proof source | — |
| calibrated | **no** |

## What is checked

A page holds nothing but the tail of a block that began earlier. A page that is neither a parity
blank page nor one Paged.js forced open (both are declined) is reported when all three hold, and
its evaluation in the JSON report records all three:

- `continuation-only` — every block of the page's flow continues a block that began earlier;
- `ends-on-page` — the next page does **not** open with text of that block running on;
- `net-fill` — the page's net fill is below `maxNetFill`.

"Text running on" means a line of the continuing block starts less than one of its line heights
below the top of the next page's content.

## Why

The threshold is chosen; `data-split-from` proves a fragment is a continuation, not a defect.
`ends-on-page` is not chosen. When a block's text runs on and opens the next page, the page
stopped because its next line did not fit, so it is full whatever its net fill reads. Anything
else opening the next page means the page ended early, and it is judged.

## Limits and known false alarms

- Declined after a forced incoming break, which is a paginator decision, not a verified author
  intent. See [the break cause](../known-limits.md#the-break-cause-of-a-page-boundary).
- **At a large line height every tail page is reported, however full.** Net fill counts glyph
  boxes, not line boxes: a page filled to its last line reads about 0.51–0.54 at
  `line-height: 2` and 0.34–0.36 at `line-height: 3`, depending on the font.
- The extra window is given for inline SVG only; an inline `<img>`, `<canvas>` or `<video>` on
  the first line keeps the one-line window, which errs toward reporting.
- Elements the collector does not record as blocks (an `inline-block` callout) count as their
  wrapper's running text.

## Calibration

`calibrated: false`: the threshold is not fitted to real documents.

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

Illustrative: the advice ships `tested: false`. The maintainers' record of the measurements behind this rule is
[in the source repository](https://github.com/godarg/breaklint/blob/v0.11.1/maintainers/rule-notes/layout-orphaned-continuation-page.md).

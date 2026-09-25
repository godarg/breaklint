# `layout/orphaned-continuation-page`

| | |
|---|---|
| severity | warn |
| threshold | `netFill < 0.50` |
| proof source | — |
| calibrated | **no** |

## What is checked

A page holds nothing but the tail of a block that began earlier.

## Why

The threshold is chosen. `data-split-from` proves a fragment is a continuation; it does not prove a defect.

## Limits and known false alarms

A block footnote printed on the page is not fresh content: it lies in the footnote area below
the content box and belongs to a call in the text above it, so a page that carries only a
continuation and the footnote of that continuation is still reported. Its fill is the fill of the
content box, which Paged.js shortens by the footnote area's height.

Declined after a forced incoming break. Reading the break reason from the computed style is verifiably wrong in both directions: `break-before: page` from a stylesheet reads back as `auto`, while the same declaration written inline survives as `page` and is measured *not* to take effect.

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
<!-- A long paragraph overflows onto page 2 with just 2 trailing lines, and nothing else follows -->
<p>
  First line of paragraph...<br>
  ...many lines on page 1...<br>
  Line spilling onto page 2.<br>
  Last line on page 2.
</p>
```

### Non-firing case (remedied)

```html
<!-- By slightly reducing font size or margins, the trailing lines pull onto page 1 -->
<p style="font-size: 10pt; line-height: 14px;">
  All lines of the paragraph fit onto a single page cleanly.
</p>
```


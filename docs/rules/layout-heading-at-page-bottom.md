# `layout/heading-at-page-bottom`

| | |
|---|---|
| severity | warn |
| threshold | 2 of the heading's own line heights |
| proof source | — |
| calibrated | **no** |

## What is checked

A heading is the last thing on a page; what it introduces begins on the next.

## Why

The threshold is chosen. Using the heading's own line height rather than a fixed pixel count at least makes it scale with the typography instead of with the page size.

## Limits and known false alarms

A block set in the columns of a multi-column ancestor — the container's `column-count` other than `auto` or `1`, or any `column-width` — is declined as `env/multicolumn`, like a block with columns of its own; the decline counts against coverage. `column-count` is not inherited, so through 0.6.0 such a block was measured on the union of its column fragments. A `column-span: all` direct child of the container lies across the columns and is measured. A block on a page withdrawn because content lies past its page box (`env/pagination-residue`: Paged.js left it in its overflow column, and the PDF does not print it) is declined, and the decline counts against coverage.

A heading with anything under it on the same page is not stranded and is not reported.

A heading that was not rendered — no layout box and no line boxes — does not end any page: the
in-flow original of a running heading, which Paged.js hides with `display: none` while its clones
print in the margin boxes, is recorded as `excluded` (`rule/target-not-rendered`), outside the
coverage base. A `display: contents` heading has no box of its own but prints its text; it is
placed by its line boxes and ends where its last line does. A heading with neither a box nor
visible line boxes is declined as `env/invalid-measurement`, and the decline counts against
coverage. Headings inside a margin box are not measured. See `docs/limitations.md`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/heading-at-page-bottom -->
A heading sits at the bottom of the page with less room than the uncalibrated threshold following it. Add 'break-after: avoid;' to the heading style rule so it advances with its following content, or insert an explicit 'break-before: page;' before the heading.
<!-- end generated remediation: layout/heading-at-page-bottom -->

## Examples

### Firing case (trigger)

```html
<div style="height: 240mm;">Preceding content filling the page.</div>
<h2>Section Title Stranded At Bottom</h2>
<!-- The following paragraph breaks onto page 2 -->
<p>This body text starts on page 2.</p>
```

### Non-firing case (remedied)

```html
<div style="height: 240mm;">Preceding content filling the page.</div>
<h2 style="break-after: avoid;">Section Title Moved With Text</h2>
<!-- With break-after: avoid, the heading moves to page 2 with its paragraph -->
<p>This body text starts on page 2.</p>
```


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

A heading with anything under it on the same page is not stranded and is not reported.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

A heading sits stranded at the very bottom of a page without its following section content. Add 'break-after: avoid' (or 'page-break-after: avoid') to the heading selector (e.g. 'h1, h2, h3 { break-after: avoid; }'), or insert an explicit 'break-before: page' to move the heading to the next page.

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


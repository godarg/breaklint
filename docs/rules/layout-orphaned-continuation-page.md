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
<!-- A generous margin above a long paragraph pushes its last two lines onto page 2, and nothing else follows -->
<h2 style="margin-bottom: 48px;">Section</h2>
<p style="line-height: 1.6;">
  First line of paragraph...<br>
  ...many lines on page 1...<br>
  Line spilling onto page 2.<br>
  Last line on page 2.
</p>
```

### Non-firing case (remedied)

```html
<!-- Tightening the preceding vertical margin and the line-height on page 1 can pull the trailing lines back -->
<h2 style="margin-bottom: 12px;">Section</h2>
<p style="line-height: 1.5;">
  First line of paragraph...<br>
  ...every line now fits on page 1.
</p>
```

Illustrative, like every example on these pages: the advice ships `tested: false`, and no
trigger/remedied pair in this package demonstrates it. The example changes only levers the advice
names — a preceding vertical margin and `line-height` — which
`tests/unit/registry.test.ts` checks for every rule page.


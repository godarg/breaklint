# `layout/orphan`

| | |
|---|---|
| severity | warn |
| threshold | the element's own `orphans` value |
| proof source | — |
| calibrated | **no** |

## What is checked

The closing lines of a block on a page are fewer than the author asked for.

## Why

The mirror of `layout/widow`, with the same permanent ceiling of `warn` for the same reason.

## Limits and known false alarms

Skipped after a forced outgoing break, and on blocks with no visible text line.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

A block begins near the bottom of a page leaving fewer opening lines before a page break than the uncalibrated threshold asks for. Use `break-inside: avoid` on the block or paragraph to keep it intact, insert an explicit `break-before: page` to move it to the top of the next page, or adjust preceding spacing to allow more lines to fit.

> [!WARNING]
> Do not propose or set the CSS `orphans` property as a fix. `orphans` is absent from Paged.js 0.4.3 and Chromium does not honour it under Paged.js.

## Examples

### Firing case (trigger)

```html
<p style="margin-top: 235mm;">
  First line of paragraph at the very bottom of page 1.<br>
  Remaining lines flow onto page 2.
</p>
```

### Non-firing case (remedied)

```html
<p style="margin-top: 235mm; break-inside: avoid;">
  First line of paragraph moves to page 2.<br>
  Remaining lines flow on page 2.
</p>
```


# `layout/unbreakable-block-too-tall`

| | |
|---|---|
| severity | error |
| threshold | the page content box height |
| proof source | A |
| calibrated | **no** |

## What is checked

A block with `break-inside: avoid` is taller than the page it must fit on.

## Why

One of two rules that carry `error`. Two directly measured heights, a structural boundary: a block taller than every page cannot keep its own promise not to break. That is arithmetic, not convention.

## Limits and known false alarms

Multi-column and vertical writing are declined rather than judged.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

An element with 'break-inside: avoid' is physically taller than the page printable area, forcing unavoidable overflow or clipping. Remove 'break-inside: avoid' to allow the block to split across pages, or reduce the element's height, padding, font-size, or contained rows/items so it fits within a single page.

## Examples

### Firing case (trigger)

```html
<!-- Page content height is ~257mm; 300mm block cannot fit -->
<div style="break-inside: avoid; height: 300mm; background: #eee;">
  Content too tall to fit on any single page.
</div>
```

### Non-firing case (remedied)

```html
<!-- Allow the tall block to paginate naturally -->
<div style="break-inside: auto; height: 300mm; background: #eee;">
  Content splits across pages cleanly.
</div>
```


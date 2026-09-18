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

<!-- begin generated remediation: layout/unbreakable-block-too-tall -->
A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where it had already been split into three or more fragments, the reported height is the sum of those fragments, which is the height its content needed. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.
<!-- end generated remediation: layout/unbreakable-block-too-tall -->

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


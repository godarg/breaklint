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

- Multi-column and vertical writing are declined rather than judged.
- A split block is judged on all of its fragments, joined by source id. Fragments that cannot be
  joined (no source id, for example after `--no-source-map`) are declined as
  `env/invalid-measurement` and count against coverage.
- A block split into exactly two fragments is reported only if the first fragment alone exceeds
  the page; from three fragments on, the summed height is reported. See
  [known limits](../known-limits.md).
- Fragments are found by page structure, not coordinates: a fragment bleeding into the margin
  still counts, while content in a page margin box is not measured. Hidden blocks and
  `display: contents` blocks are outside coverage; a zero-size block that printed visible lines
  anyway is declined.
- A block is judged at its first fragment that printed; hiding only that fragment does not hide
  the block.

## Calibration

`calibrated: false`. The boundary is structural (the page's content box), not a fitted number.

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
<!-- Split the content deliberately into sections that each fit a page -->
<div style="break-inside: avoid; height: 150mm; background: #eee;">
  First part of the content.
</div>
<div style="break-inside: avoid; height: 150mm; background: #eee;">
  Second part of the content.
</div>
```


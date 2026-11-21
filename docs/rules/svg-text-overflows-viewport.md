# `svg/text-overflows-viewport`

| | |
|---|---|
| severity | error |
| threshold | overshoot > 0 px |
| proof source | A |
| calibrated | **no** |

## What is checked

A text element lies outside its SVG's viewport and is not drawn.

## Why

The second rule carrying `error`. Two directly measured boxes, a structural boundary. Both are normalised through `getScreenCTM()` before comparison: `getBBox()` returns local coordinates, and on a transformed group local (60, 0) is absolute (284.57, 70.78) — an error of 235.46 px. Comparing a local box against an absolute viewport is a different measurement, not an approximation.

## How the boxes are obtained

The collector reads each `<text>`'s `getBBox()` and normalises it through `getScreenCTM()`, taking
**all four** transformed corners: under a rotation, one diagonal understates the extent in both
axes. Both primitives are captured before any author script runs.

- **Only painted text is a target.** Text inside `<defs>`, with `visibility: hidden`,
  `opacity: 0`, or with neither fill nor stroke is neither a candidate nor a decline.
- **A nested `<svg>` is its own record**, compared against the viewport that actually clips it.
- **A label flush with the edge is not a finding.** Both boxes are rounded from the same source,
  so rounding cancels rather than accumulates.

## Limits and fail-closed cases

- With `overflow: visible` the glyphs are painted after all; the rule declines, and the target
  does not count against coverage.
- A `<text>` whose screen box cannot be read declines with `env/svg-ctm-unavailable` and counts
  against coverage.
- Visible stroke, paint servers, text decoration, clip paths, masks, filters and `<use>`
  instances decline with `env/svg-painted-bounds-unsupported`, except a narrow halo case whose
  stroke stays strictly inside the viewport.
- An SVG root with border, padding, rounded clipping or a transformed ancestor declines with
  `env/svg-viewport-geometry-unsupported`.

Because this is an error rule with a coverage floor of 1, any coverage-relevant decline ends the
run with exit 4 rather than a guessed result.

## Calibration

`calibrated: false`. The zero boundary is structural, not a fitted threshold; the maintainers'
[validation architecture](https://github.com/godarg/breaklint/blob/v0.11.1/maintainers/validation/architecture.md)
describes how it is checked against an independent geometry implementation.

## Remediation

<!-- begin generated remediation: svg/text-overflows-viewport -->
Text rendered inside an SVG extends outside the SVG viewport bounds and is clipped. Enlarge the SVG 'viewBox' or its width/height, or adjust the <text> coordinates ('x', 'y', 'text-anchor'). 'overflow: visible' on the container also clears the finding, but it does not move the text: the viewport then no longer clips, the target becomes non-applicable and this rule stops measuring it. Use that only where the overflow is intended.
<!-- end generated remediation: svg/text-overflows-viewport -->

## Examples

### Firing case (trigger)

```html
<svg viewBox="0 0 100 100" width="100" height="100">
  <!-- Text x=140 extends well beyond the 100px viewBox width -->
  <text x="140" y="50" font-size="14">Clipped Text Outside Viewport</text>
</svg>
```

### Non-firing case (remedied)

```html
<!-- Enlarge viewBox or reposition text so it sits within the viewport -->
<svg viewBox="0 0 300 100" width="300" height="100">
  <text x="20" y="50" font-size="14">Contained Text Inside Viewport</text>
</svg>
```


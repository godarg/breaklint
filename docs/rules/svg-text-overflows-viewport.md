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

The second rule carrying `error`. Two directly measured boxes, a structural boundary. Both are brought into **one coordinate system** before comparison: the viewport coordinate system of the outermost `<svg>` — CSS px, origin at its content-box corner, before any CSS transform or zoom. `getBBox()` returns the text's own user-space coordinates, and on a transformed group local (60, 0) is absolute (284.57, 70.78) — an error of 235.46 px. Comparing a local box against an absolute viewport is a different measurement, not an approximation.

The browser clips SVG content in exactly that system and applies the CSS transform and zoom that carry it to the screen only afterwards. Containment is invariant under that affine map, so it is decided there — not between screen rectangles, which under a rotation are only envelopes and can put a clipped label "inside".

## How the boxes are obtained

**The text box.** The collector reads each `<text>`'s `getBBox()` and carries it through
`getCTM()` — the text's matrix into its nearest viewport's coordinate system — and, for a text in a
nested `<svg>`, through the enclosing viewports' `getCTM()` chain into the outermost frame. It takes
**all four** transformed corners rather than two opposite ones. Under a rotation the min/max over a
single diagonal is smaller than the real extent in both axes, and this rule compares extents. The
same corners through `getScreenCTM()` give the screen box a finding reports as its position; the
two must agree (the local matrix carried to the screen is the text's own `getScreenCTM()`, to
0.005 px), or the target cannot be placed and declines as unreadable.

**The clip rectangles.** For an outermost SVG the viewport is its content box, `(0, 0, cw, ch)`:
the computed width and height, less border and padding where `box-sizing: border-box` includes
them. Computed values, not `getBoundingClientRect()`: they are unzoomed while the client rect is
zoomed. The clip is that box when `overflow-clip-margin` is `content-box` (the user-agent default
on every SVG root), and otherwise the padding, border or content box it names grown by its length —
`10px` alone grows the **padding** box, and `padding-box` serialises as `0px`. `auto` and `scroll`
clip like `hidden` and `clip` on an SVG root. For a nested `<svg>` the viewport is its
`x`/`y`/`width`/`height` in its parent's user space, carried into the frame; its client rect is the
union of its **content**, not its viewport, and was never a clip edge. A text is drawn in full only
inside its own viewport's clip and every enclosing one, and the rule measures against all of them.

**The proof.** The frame rests on values read inside the page. The collector therefore maps the
reconstructed content box to the screen (`getScreenCTM() · getCTM()⁻¹` of the outermost SVG) and
compares it with CDP `DOM.getBoxModel()` — the browser's layout tree, read out of process — and,
where the clip is grown from the padding or border box, that box too. They must agree to 0.005 px
in the frame, or the SVG declines. The number is half of the snapshot's 0.01 px resolution: a
finding needs a stored overshoot of at least 0.02 on that grid, so a frame wrong by less than
0.005 cannot be what puts a label past the edge. It is sized by what the comparison reads —
Chromium serialises computed lengths with six significant digits (a used width of 1234.515625 px
reads `1234.52px`) — and every model error seen while building this disagreed by 5 px or more.
Measured on Chromium 141 over padding, fractional border-box sizing, rotation and zoom of the SVG
and its ancestors, the live fixtures and the public first-party corpus document: at most
3.75e-4 px, each time the six-digit serialisation of a pt-sized width. Computed padding is the
specified length rather than the used one (`3.333333px` reads `3.33333px`, layout uses
3.328125), so a clip margin grown from the padding box of such an SVG declines rather than resting
on it.

**The value a finding reports** is the overshoot in that frame: CSS px of the SVG before its CSS
transforms and zoom. Up to 0.6.0 it was screen px. For an SVG with no CSS transform or zoom between
it and the page the two are the same number; under `zoom: 2` the frame value is half the screen
distance.

Both halves of that are measured in `tests/fixtures/svg-text-geometry.html`. A label at 90 degrees
has a LOCAL box inside the viewport and a screen box outside it, so `getBBox()` alone reports
nothing there. A second label at 45 degrees separates four corners from two: its four-corner box
crosses the viewport edge by 15.82 px while its two-corner box stays 28 px inside. At exactly 90
degrees the two boxes coincide, which is why the first fixture cannot make that distinction and an
independent review was right to say the claim was unmeasured until the second one existed.

**A `<text>` that is not painted is not a target.** Chrome answers `getBBox()` and
`getScreenCTM()` for an element inside `<defs>` and yields a box 609.65 px outside the viewport —
this rule would report an error about something that is never painted. The collector asks
`getBoundingClientRect` first, and an element with an empty rect is neither a candidate nor a
decline. The same holds for `visibility: hidden`, `opacity: 0` and a `<text>` with neither fill
nor stroke — those lay out normally and return a full rect, so they are read from the computed
style instead. Fully transparent computed paint is excluded by the same rule. Every one of them
is the `<defs>` case through another door; `checkVisibility` is one input, not a paint oracle.

**A nested `<svg>` belongs to its own record.** `querySelectorAll` reaches into it from the outer
element, which collected the same label twice and compared it against the outer viewport rather
than the one that actually clips it. Each record takes only the targets whose nearest `<svg>`
ancestor is itself — and is then measured against its own clip and the clips of the SVGs around it.

Every primitive involved — `getBBox()`, `getCTM()`, `getScreenCTM()`, the matrix and rectangle
coefficients, the SVGLength values — is captured before any author script runs, for the same
reason the rest of the geometry is: a document that replaces them could otherwise decide what this
rule sees.

Until 0.2.3 no geometry was collected at all. Every SVG arrived marked unmeasurable with a reason
this rule had not declared, which is a fatal `checker-crashed` by design — so any document holding
a figure ended in exit 3 rather than being checked.

## Limits and fail-closed cases

With `overflow: visible` the glyphs are painted after all, and the rule declines rather than
reports. Those targets are not counted against coverage either: the question does not arise for
them, and one such figure would otherwise take an error rule with a coverage floor of 1 below its
floor and end the run in exit 4. The decline stays in `notMeasured`.

A `<text>` whose screen box cannot be read — no CTM, or `getBBox()` throwing on a target with no
rendered geometry — declines with `env/svg-ctm-unavailable` and DOES count against coverage: that
is a target this rule ought to have judged and could not.

`getBBox()` also omits painted geometry introduced or removed by visible stroke, a paint server,
text decoration, clip path, mask or filter. Text instantiated through `<use>` is inside a closed
instance tree. Those cases decline per target with `env/svg-painted-bounds-unsupported`; they stay
in the denominator, so the rule ends in exit 4 rather than inventing a box or silently losing the
candidate.

Border, padding, `overflow-clip-margin` in every serialised form, 2D CSS transforms, the
individual `rotate`/`scale`/`translate` properties and zoom — on the SVG or any ancestor — are
measured, not declined. Up to 0.6.0 each of them declined the whole record. What still declines the
whole record with `env/svg-viewport-geometry-unsupported`, counted against coverage, is geometry
this build does not reconstruct:

- a rounded clip: a corner radius larger than border plus padding on both axes, so the clip is not
  the rectangle compared against; and any radius together with a clip margin other than the
  default;
- a 3D transform, perspective or motion path on the SVG or an ancestor;
- `overflow-x` and `overflow-y` that differ: on Chromium 141 a one-axis clip even moves the clip
  edge to the padding box;
- a nested `<svg>` with a transform, with a clip margin, rotated or skewed within the outer frame,
  or whose computed `x`/`y`/`width`/`height` disagree with its attributes — CSS sizes a nested SVG
  (measured: a `width` rule overrides the attribute for the clip), so the attributes no longer
  describe its viewport;
- an `<svg>` inside a `<foreignObject>`, which the foreignObject and the enclosing SVG clip too;
- an SVG whose reconstructed content box CDP does not confirm, or for which CDP gives no box model.
  Only a record with no potential target at all — every `<text>` unrendered, no `<use>` — is not
  declined for that, because there is nothing its viewport could clip that this rule judges.

The snapshot names which case applied (`SvgRecord.viewportDiagnostic`); the report carries the
coverage reason.

**A label flush with the edge is not a finding.** The threshold is zero and the boxes are rounded
to two decimals, so a review asked whether a label ending exactly on the viewport edge produces a
0.01 px error. Measured, on the sharpest case that can be constructed — `textLength` set to the
full width of the viewBox, so the box ends on the edge by construction — the rule stays silent.
The clip rectangle and the label box are now derived separately and rounded separately, which is
exactly what the 0.01 px resolution guard (`SNAPSHOT_ROUNDING_PX`) is for: a stored overshoot must
exceed it to count.

**What a finding measures is the typographic cell, not the ink.** `getBBox()` is advance by
ascent plus descent; a label whose cell crosses the edge while its glyphs stay inside is reported.
The live fixtures therefore use a glyph whose ink fills its cell. Replacing the cell by an ink
bound is separate, later work.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

M3-0 classifies this rule as `structural-validation`, not empirical threshold optimisation. The lab
reproduces outside, enlarged-viewBox and `overflow: visible` cases against an independent geometry
implementation and then exercises the unchanged production decision. The zero boundary is
unchanged, and `calibrated: false` remains unchanged. See
[`../validation/architecture.md`](../validation/architecture.md).
Any future structural acceptance report must likewise be derived from complete target-level
outcomes. The validator obtains finding/clean/declined from the source-pinned unchanged registry
`Rule.run` over the receipt-bound boxes and overflow state; this does not introduce a tunable
threshold.
Contract-simulation rows cannot make the structural claim ready. A claim-grade run still requires
a separately supplied capture bundle and attestation bound to the exact real-render receipt and
frozen renderer, plus an owner-approved external trust root that M3-0 does not possess.

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


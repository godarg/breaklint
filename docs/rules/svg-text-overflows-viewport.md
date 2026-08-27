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
**all four** transformed corners rather than two opposite ones. Under a rotation the min/max over a
single diagonal is smaller than the real extent in both axes, and this rule compares extents. The
live fixture `tests/fixtures/svg-text-geometry.html` contains a label whose LOCAL box is inside the
viewport and whose screen box is not; reading `getBBox()` alone reports nothing there.

Both primitives are captured before any author script runs, for the same reason the rest of the
geometry is: a document that replaces them could otherwise decide what this rule sees.

Until 0.2.3 no geometry was collected at all. Every SVG arrived marked unmeasurable with a reason
this rule had not declared, which is a fatal `checker-crashed` by design — so any document holding
a figure ended in exit 3 rather than being checked.

## Limits and known false alarms

With `overflow: visible` the glyphs are painted after all, and the rule declines rather than
reports. Those targets are not counted against coverage either: the question does not arise for
them, and one such figure would otherwise take an error rule with a coverage floor of 1 below its
floor and end the run in exit 4. The decline stays in `notMeasured`.

A `<text>` whose screen box cannot be read — no CTM, or `getBBox()` throwing on a target with no
rendered geometry — declines with `env/svg-ctm-unavailable` and DOES count against coverage: that
is a target this rule ought to have judged and could not.

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

# `layout/half-empty-page`

| | |
|---|---|
| severity | warn (experimental) |
| threshold | `netFill < 0.60` or `topGap > 0.50` |
| proof source | — |
| calibrated | **no** |

## What is checked

A page carries far less content than its content box allows.

## Why

**Experimental, and therefore never gates — not even at `--fail-on warn`.** The ceiling of `netFill` on a fully set text page is 0.686, because line boxes do not cover leading. The threshold is 0.60. Eighty-six thousandths separate *full* from *flagged*, and a typeface with more leading can spend that.

What is measured is `netFill`, the summed height of semantic bands — not `verticalFill`. A page holding one absolutely positioned line at the foot reads `verticalFill` 0.992; the same line at the head reads 0.056. Identical content, a spread of 0.936. `verticalFill` measures where the content is, not how much there is.

## Limits and known false alarms

A parity blank page is declined, not reported: it has `netFill` 0 and would fire under any threshold, and the author asked for it with `break-before: right`. The last page is downgraded to a note when it also carries no continuation and no forced break.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

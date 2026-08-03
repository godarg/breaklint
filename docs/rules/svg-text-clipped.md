# `svg/text-clipped`

| | |
|---|---|
| severity | warn |
| threshold | `missingInk > 0.05` |
| proof source | — |
| calibrated | **no** |

## What is checked

Part of a text's glyph ink is removed by a clip path or mask.

## Why

Measured as a counterfactual: the same target rasterised as it stands (`T`) and with clipping neutralised (`T0`). Asking `isPointInFill` whether the glyph is inside the clip would take the truth from the API under test.

**Per target, not per SVG.** Under one shared mask the value depends on how much other text stands nearby: on the dilution fixture a genuine 0.627 collapses to 0.0435, below the threshold, and the defect disappears. A threshold on a dilutable quantity is not a threshold.

Ink is defined against the empty pass, not an assumed background. An earlier version compared against white and missed a pale yellow line entirely; later a renderer's default background turned out to be (18, 18, 18).

## Limits and known false alarms

A clip that contains the text is not a finding. Unstable ink passes are discarded, never averaged — an averaged unstable value is an invented one.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

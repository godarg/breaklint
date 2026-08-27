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

## Availability in this build

**This rule measures nothing today, on any document.** It needs the SVG ink passes, which are M3
work and are not implemented in the collector: `inkCollected` is false for every SVG, and the rule
declines each target with `env/pixel-oracle-unavailable`.

Until 0.2.3 that decline was charged to coverage, so a single inline SVG ended the run in exit 4.
It now leaves the coverage base and stays in `notMeasured`, where it names this rule, the reason
and the number of targets. The rule is registered and its logic is covered by fixtures carrying
ink counts — what is missing is the measurement, not the decision.

## Limits and known false alarms

A clip that contains the text is not a finding. Unstable ink passes are discarded, never averaged — an averaged unstable value is an invented one.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

M3-0 adds an independent oracle contract and a real-renderer seven-fixture lab. It reproduces the
group-selector zero and the shared-mask dilution counterexample, validates target attribution, and
keeps construction truth separate from the unchanged production decision. This establishes
calibration infrastructure, not calibration readiness: the checked-in corpus has zero eligible real
documents and no frozen holdout. See [`../validation/architecture.md`](../validation/architecture.md).
The mandatory G2 nested-group case uses non-identity `translate(10,0)`; its authored clip boundary
is checked through the applied text target's real CTM. Future claim evaluation is target-row based,
with oracle/annotation/adjudication snapshots and a closed measurement receipt bound to the frozen
holdout. The validator executes the source-pinned unchanged registry `Rule.run`; it does not accept
an outcome-authored prediction or a parallel clipping formula.
Contract-simulation receipts remain outside the real-evidentiary denominator. A later claim-grade
run additionally requires a separately supplied capture bundle and attestation bound to the exact
real-render receipt rows, plus an owner-approved external trust root that M3-0 does not possess.

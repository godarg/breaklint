# `svg/text-clipped`

> **Research definition — not a released rule in 0.3.1.** This module is absent from the CLI
> registry, configuration schema, SARIF catalogue and demo. It remains here with the M3 lab so a
> future production integration has an explicit decision contract instead of an implied feature.

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

Production acquisition writes `inkCollected: false` for every SVG and has no isolated pixel pass.
Version 0.3.1 therefore withdrew this rule from `ALL_RULES` instead of registering a definition
that no real document can reach. Only the explicit validation registry executes it over controlled
M3 lab projections; that is research evidence, not a product capability.

## Limits and known false alarms

A clip that contains the text is not a finding. Unstable ink passes are discarded, never averaged — an averaged unstable value is an invented one.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why any future release must keep it advisory until the calibration boundary changes.

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

# `layout/orphan`

| | |
|---|---|
| severity | warn |
| threshold | the element's own `orphans` value |
| proof source | — |
| calibrated | **no** |

## What is checked

The closing lines of a block on a page are fewer than the author asked for.

## Why

The mirror of `layout/widow`, with the same permanent ceiling of `warn` for the same reason.

## Limits and known false alarms

Skipped after a forced outgoing break, and on blocks with no visible text line.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

# `type/straight-quotes`

| | |
|---|---|
| severity | warn |
| threshold | occurrences: 0 permitted |
| proof source | — |
| calibrated | **no** |

## What is checked

A straight quotation mark or apostrophe appears in typeset prose.

## Why

A warning and nothing stronger: the same characters are legitimate as the inch mark and the arc minute.

## Limits and known false alarms

A digit immediately before the character exempts it. A program quotation inside `code` is excluded structurally.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

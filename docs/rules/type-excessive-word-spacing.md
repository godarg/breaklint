# `type/excessive-word-spacing`

| | |
|---|---|
| severity | warn |
| threshold | > 3.0× the natural space |
| proof source | — |
| calibrated | **no** |

## What is checked

Word gaps in a justified block are far wider than the natural space.

## Why

The threshold is chosen. Word boxes are held for every line of every justified block; an earlier version limited them to a window around page boundaries, which contradicted the rule that needs them. Keeping them all costs a measured 4 221 bytes per page — about 8 MiB over 2 000 pages.

## Limits and known false alarms

Blocks with an explicit `word-spacing` are out: the width is a stated intention. Table cells are out: a justified cell has no room to do better.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

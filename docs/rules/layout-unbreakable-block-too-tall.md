# `layout/unbreakable-block-too-tall`

| | |
|---|---|
| severity | error |
| threshold | the page content box height |
| proof source | A |
| calibrated | **no** |

## What is checked

A block with `break-inside: avoid` is taller than the page it must fit on.

## Why

One of two rules that carry `error`. Two directly measured heights, a structural boundary: a block taller than every page cannot keep its own promise not to break. That is arithmetic, not convention.

## Limits and known false alarms

Multi-column and vertical writing are declined rather than judged.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

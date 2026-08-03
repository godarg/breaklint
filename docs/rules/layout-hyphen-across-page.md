# `layout/hyphen-across-page`

| | |
|---|---|
| severity | warn |
| threshold | occurrences: 0 permitted |
| proof source | — |
| calibrated | **no** |

## What is checked

A word is split by a hyphen across a page boundary.

## Why

Detected by the paginator's own class, never by comparing characters. The hyphen glyph is configurable, so a character comparison would miss a document that changed it — and would fire on a compound word that legitimately ends a line with a hyphen.

## Limits and known false alarms

A compound word at a page boundary without the paginator's class is not reported.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

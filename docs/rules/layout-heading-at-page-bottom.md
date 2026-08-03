# `layout/heading-at-page-bottom`

| | |
|---|---|
| severity | warn |
| threshold | 2 of the heading's own line heights |
| proof source | — |
| calibrated | **no** |

## What is checked

A heading is the last thing on a page; what it introduces begins on the next.

## Why

The threshold is chosen. Using the heading's own line height rather than a fixed pixel count at least makes it scale with the typography instead of with the page size.

## Limits and known false alarms

A heading with anything under it on the same page is not stranded and is not reported.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

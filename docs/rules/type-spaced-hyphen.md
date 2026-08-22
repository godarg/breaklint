# `type/spaced-hyphen`

| | |
|---|---|
| severity | warn |
| threshold | occurrences: 0 permitted |
| proof source | — |
| calibrated | **no** |

## What is checked

A hyphen stands between spaces where the convention asks for a dash.

## Why

Permanently a warning. The German orthography ruleset distinguishes hyphen from dash by **function**, and a minus sign in `x - y = 0` is neither — about that case the ruleset says nothing at all.

## Limits and known false alarms

Mathematical use is excluded by a ±12-character neighbourhood test. **That window is chosen and unmeasured**; no corpus of real prose stands behind it. `code`, `pre`, MathML and any run whose `lang` differs from the locale are structurally excluded, on the ancestor chain.

Configuration may add ancestor tag names with `excludeTags`, for example
`{"rules":{"type/spaced-hyphen":{"excludeTags":["samp"]}}}`. These are HTML tag names, not CSS
selectors; they are lower-cased and deduplicated before the rule runs.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

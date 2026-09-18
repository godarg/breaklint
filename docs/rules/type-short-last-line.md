# `type/short-last-line`

| | |
|---|---|
| severity | warn |
| threshold | < 15 % of the measure AND < 2 em |
| proof source | — |
| calibrated | **no** |

## What is checked

The closing line of a paragraph is a stub.

## Why

Both conditions must hold. The relative test alone fires on narrow columns where a short last line is unavoidable; the absolute test alone fires on wide measures where a 15 % line is still a good line. Both numbers are chosen.

## Limits and known false alarms

Single-line paragraphs, centred text, and the non-final fragment of a split block are all out of scope.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: type/short-last-line -->
The final line of a paragraph is shorter than the uncalibrated threshold (a runt). Insert a non-breaking space ('&nbsp;') between the last two words to prevent a single word from standing alone, or reword the paragraph to balance line lengths.
<!-- end generated remediation: type/short-last-line -->

## Examples

### Firing case (trigger)

```html
<p style="width: 500px; font-size: 20px; font-family: serif;">
  This is the first line of the paragraph which extends across the measure.<br>
  it.
</p>
```

### Non-firing case (remedied)

```html
<p style="width: 500px; font-size: 20px; font-family: serif;">
  This is the first line of the paragraph which extends across the measure and concludes with a balanced final sentence.
</p>
```


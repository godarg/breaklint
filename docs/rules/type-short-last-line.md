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

A block set in the columns of a multi-column ancestor — the container's `column-count` other than `auto` or `1`, or any `column-width` — is declined as `env/multicolumn`, like a block with columns of its own; the decline counts against coverage. `column-count` is not inherited, so through 0.6.0 such a block was measured on the union of its column fragments. A `column-span: all` direct child of the container lies across the columns and is measured. A block with a `column-width` of its own (`columns: 8em`) is in columns as well and is declined the same way; so is every block of a document whose `html` or `body` sets columns. Its width would be the union of its columns. A block on a page withdrawn because content lies past its page box (`env/pagination-residue`: Paged.js left it in its overflow column, and the PDF does not print it) is declined, and the decline counts against coverage.

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


# `layout/half-empty-page`

| | |
|---|---|
| severity | warn (experimental) |
| threshold | `netFill < 0.60` or `topGap > 0.50` |
| proof source | — |
| calibrated | **no** |

## What is checked

A page carries far less content than its content box allows.

## Why

**Experimental, and therefore never gates — not even at `--fail-on warn`.** The ceiling of `netFill` on a fully set text page is 0.686, because line boxes do not cover leading. The threshold is 0.60. Eighty-six thousandths separate *full* from *flagged*, and a typeface with more leading can spend that.

What is measured is `netFill`, the summed height of semantic bands — not `verticalFill`. A page holding one absolutely positioned line at the foot reads `verticalFill` 0.992; the same line at the head reads 0.056. Identical content, a spread of 0.936. `verticalFill` measures where the content is, not how much there is.

## Limits and known false alarms

A parity blank page is declined, not reported: it has `netFill` 0 and would fire under any threshold, and the author asked for it with `break-before: right`. The last page is downgraded to a note when it also carries no continuation and no forced break.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

A page content area has a net fill ratio below the uncalibrated 60% threshold. If this page naturally concludes a section, chapter, or document, this is expected and may be disregarded. If unintended, check whether a subsequent block forced an early break with `break-before: page` or an oversized `break-inside: avoid` container, and adjust preceding margins or spacing.

> [!NOTE]
> **This rule saturates.** `netFill` merges the client rectangles of a page's text runs and replaced elements and divides the summed band height by the content box height. Half-leading falls between the bands, and no element margin ever enters the rectangles, so the quantity is systematically smaller than the fill a reader perceives: a page of prose at `line-height: 1.5` reaches at most about 0.686, against a threshold of 0.60. Measured on a 40-document corpus constructed for this purpose, it fired on 37 of 40 documents, including pages a reader would call full. No measurement on a corpus of real-world documents exists. It is classified as experimental and never gates CI.

## Examples

### Firing case (trigger)

```html
<!-- A page with only one short paragraph has a net fill ratio of ~3% -->
<p>Only a single line of text on this page.</p>
```

### Non-firing case (remedied)

```html
<!-- Content fills > 60% of the net page height -->
<table style="width: 100%; border-collapse: collapse;">
  <!-- Sufficient rows to fill the page content area beyond 60% net fill -->
  <tr style="height: 650px;"><td>Substantial content block filling page</td></tr>
</table>
```


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

**Experimental, and therefore never gates — not even at `--fail-on warn`.** `netFill` sums the glyph boxes of a page's text, not its line boxes, so a page no further line would fit on reads roughly glyph height over line pitch — a figure set by the font and the leading, not a fixed ceiling. Measured with this collector on full pages that are not the last page of their document (Chromium 141, Paged.js 0.4.3, the measuring machine's default serif and sans-serif): 0.58–0.72 at `line-height: 1.5` — 0.69–0.72 for pages of one long paragraph, 0.58–0.63 for prose with 1 em paragraph margins, where 6 of 16 full pages read below the threshold — then 0.51–0.54 at `line-height: 2` and 0.34–0.36 at `line-height: 3` (12 pt on A5 and 11 pt on A4). The threshold is 0.60. Full pages fall on both sides of it, so it cannot gate.

What is measured is `netFill`, the summed height of semantic bands — not `verticalFill`. A page holding one absolutely positioned line at the foot reads `verticalFill` 0.992; the same line at the head reads 0.056. Identical content, a spread of 0.936. `verticalFill` measures where the content is, not how much there is.

## Limits and known false alarms

A parity blank page is declined, not reported: it has `netFill` 0 and would fire under any threshold, and the author asked for it with `break-before: right`. The last page keeps its `warn` finding, but when it also carries no continuation and no forced break, the message says it is likely intended.

A page whose content box holds nothing while it prints blocks elsewhere — a long footnote that Paged.js carried over to a page of its own — is declined as `env/invalid-measurement`, counted against coverage: `netFill` is the fill of the content box, which on such a page is empty (0 px tall under a full footnote area on a measured example), so "0 % filled" would describe a page full of footnote text.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/half-empty-page -->
This rule fires on either of two quantities: the page's net fill ratio fell below the uncalibrated threshold, or its content starts more than half a page down. Read the finding's measurement to see which. If the page naturally concludes a section, chapter or document, either is expected and may be disregarded. If unintended: for low fill, check whether a following block forced an early break with 'break-before: page' or an oversized 'break-inside: avoid' container; for a late start, look for a leading margin, an empty block or a float above the first line.
<!-- end generated remediation: layout/half-empty-page -->

> [!NOTE]
> **This rule saturates.** `netFill` merges the client rectangles of a page's text runs and replaced elements and divides the summed band height by the content box height. Half-leading falls between the bands, and no element margin ever enters the rectangles, so the quantity is systematically smaller than the fill a reader perceives: full pages of prose at `line-height: 1.5` read 0.58–0.72, against a threshold of 0.60, and less with more leading. Measured on a 40-document corpus constructed for this purpose, it fired on 37 of 40 documents, including pages a reader would call full. No measurement on a corpus of real-world documents exists. It is classified as experimental, never gates CI, and since 0.6.0 is no longer active in the default profile — `profile: "strict"` or `rules: { "layout/half-empty-page": true }` turns it back on.

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


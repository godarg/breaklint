# `layout/widow`

| | |
|---|---|
| severity | warn |
| threshold | the element's own `widows` value |
| proof source | — |
| calibrated | **no** |

## What is checked

The opening fragment of a block on a page carries fewer lines than the author asked for.

## Why

**`error` is permanently excluded.** CSS Fragmentation Level 3 §4.3 drops the widow/orphan rule when keeping it would leave too few break points. So `lines < widows` does not prove a defect — it may be exactly the relaxation the specification permits, and this version has no way to prove the relaxation was unwarranted.

The earlier justification for the downgrade was itself unmeasured: *in 230 runs no violation occurred*. At `widows: 6` the same layout produces 6+3, which **is** a violation — a permitted one, because with 9 lines and widows+orphans = 12 no conforming split exists. A run that fails to produce a case has not shown the case does not exist.

## Limits and known false alarms

A block with no visible text line is skipped: there is no text to strand. Without that, a fragment carrying only a figure was reported as a widow with *0 lines* — found by the corpus cross-check, not by review.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

A block fragments across a page break leaving fewer trailing lines than the uncalibrated threshold asks for. If this occurs inside a table row, keep the row together with `tr { break-inside: avoid; }`. For paragraphs, prevent the split with `break-inside: avoid`, force an earlier break with `break-before: page`, or reword/re-space the text.

> [!WARNING]
> Do not propose or set the CSS `widows` property as a fix. `widows` is absent from Paged.js 0.4.3 and Chromium does not honour it under Paged.js.

## Examples

### Firing case (trigger)

```html
<p style="margin-top: 220mm;">
  This paragraph begins near the bottom of the page.<br>
  It continues for another line.<br>
  And leaves a lone third line on the second page.
</p>
```

### Non-firing case (remedied)

```html
<p style="margin-top: 220mm; break-inside: avoid;">
  This paragraph begins near the bottom of the page.<br>
  It continues for another line.<br>
  And moves entirely to the second page rather than leaving a widow.
</p>
```


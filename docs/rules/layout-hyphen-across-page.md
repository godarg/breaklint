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

## Remediation

<!-- begin generated remediation: layout/hyphen-across-page -->
The last text line on a page ends in a hyphen that breaks a word across the page boundary. The rule reads the paginator's own hyphenation class, so it only reports a hyphen Paged.js introduced — a hard hyphen you typed is not reported, and turning hyphenation off only helps where the paginator was doing the hyphenating. Apply 'hyphens: none' or 'hyphens: manual' to the paragraph, reword slightly, or insert non-breaking spaces ('&nbsp;') or soft hyphens ('&shy;') to shift the line break. Note that disabling hyphenation can produce 'type/excessive-word-spacing' findings in justified text; the two rules pull in opposite directions and neither threshold is calibrated.
<!-- end generated remediation: layout/hyphen-across-page -->

## Examples

### Firing case (trigger)

```html
<!-- Paragraph with automatic hyphenation fragments across pages at a hyphenated word -->
<p style="hyphens: auto;">
  ...text ending page 1 with a hyphenated word...
</p>
```

### Non-firing case (remedied)

```html
<!-- Disabling hyphens prevents hyphenation across the page break -->
<p style="hyphens: none;">
  ...text wraps whole words cleanly before the page break...
</p>
```


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

Paged.js 0.4.3 sets the class only when the characters on both sides of its split are ASCII word
characters or soft hyphens (`/^\w|\u00AD$/` in `hyphenateAtBreak`). A word split next to a letter
such as `ü` or `ß` therefore carries neither the class nor a hyphen and is not reported —
measured on Chromium 141 with a page split between `ü` and `ß` in an `overflow-wrap: anywhere`
paragraph.

A boundary hyphen inside an inline element is reported on the block that holds it. Paged.js puts its
class on the parent of the text node it cut, so when the cut word sits inside `<em>`, `<a>` or
`<span>` the class is on that element. The rule used to read the block's own classes and missed it
(measured on patched Chromium 141: the same split reported without `<em>` and silent with it). The
collector now records the mark per block (`boundaryHyphen`, Snapshot 5), on the nearest source block
around the marked element; a wrapper further out does not carry it. The mark is what Paged.js
does, not the class alone: the fragment's LAST text node must end in the hyphen glyph Paged.js
appends (U+2011; breaklint never configures another), and the element holding that text node, or
one between it and the block, must carry the class. An author's `pagedjs_hyphen` class on an element
that holds no cut word is not a boundary hyphen.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/hyphen-across-page -->
The last text line on a page ends in a hyphen that breaks a word across the page boundary. The rule reads the paginator's own hyphenation class, so it only reports a hyphen Paged.js introduced — a hard hyphen you typed is not reported. Paged.js marks a page split that falls inside a word, and a split right after a soft hyphen counts as one: do not insert soft hyphens ('&shy;') to cure this finding, and do not rely on 'hyphens: manual', under which soft hyphens still break. In justified text 'type/excessive-word-spacing' owns the block-level 'hyphens' setting and where soft hyphens go, so change only the boundary word there: wrap it in '<span style="hyphens: none">' or 'white-space: nowrap', or reword slightly. In a block that is not justified, 'hyphens: none' on the paragraph is the direct fix.

**Precedence.** `hyphens` in justified blocks: [`type/excessive-word-spacing`](type-excessive-word-spacing.md) owns the block-level setting, and this rule defers to it, acting only on the affected word.

**Precedence.** Soft hyphens (`&shy;`) in justified blocks: [`type/excessive-word-spacing`](type-excessive-word-spacing.md) owns where they are inserted, and this rule defers to it, acting only on the affected word.
<!-- end generated remediation: layout/hyphen-across-page -->

## Examples

### Firing case (trigger)

```html
<!-- Paragraph with automatic hyphenation fragments across pages at a hyphenated word -->
<p style="hyphens: auto;">
  ...text ending page 1 with a hyphenated word...
</p>
```

### Non-firing case (remedied), a block that is not justified

```html
<!-- Not justified: disabling hyphenation on the paragraph prevents the boundary hyphen -->
<p style="hyphens: none;">
  ...text wraps whole words cleanly before the page break...
</p>
```

### Non-firing case (remedied), a justified block

```html
<!-- Justified: the block's hyphens setting belongs to type/excessive-word-spacing, so only the
     boundary word changes -->
<p style="text-align: justify; hyphens: auto;">
  ...text ending page 1 with <span style="hyphens: none">boundaryword</span> and more text...
</p>
```


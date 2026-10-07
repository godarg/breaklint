# `layout/half-empty-page`

| | |
|---|---|
| severity | warn (experimental, never gates) |
| threshold | `netFill < 0.60` with remaining room, or `topGap > 0.50` |
| proof source | — |
| calibrated | **no** |

## What is checked

This optional page check reviews low glyph/visual-band coverage and unusually late starts. It
records `net-fill`, `top-gap`, `bottom-space`, `minimum-recorded-line-height`,
`natural-document-end` and `outgoing-paginator-break` in each measured evaluation.

Low coverage can warn only when the page is not a natural document ending and its bottom space
can fit at least twice the smallest positive line height recorded for a visible boxed block on that
page. If no such line height exists, the guard is unavailable; the finding says so. The bottom
space is derived from the recorded vertical fill and content-box height, not from the net ratio.
A late start above `maxTopGap` can warn independently, including at document end.

## Why the rule remains experimental

Net fill sums merged glyph/visual bands rather than occupied line boxes. Leading and margins
make a page look fuller than this ratio. Historical collector experiments found full prose pages
at 0.58–0.72 with `line-height: 1.5`, 0.51–0.54 at 2 and 0.34–0.36 at 3 (Chromium 141,
Paged.js 0.4.3, the measuring host's default fonts). A purpose-built historical 40-document
exercise fired on 37 documents. Those observations motivated default-off behavior; they do not
measure the candidate's current accuracy or establish a fixed ceiling.

The two-line-height guard prevents one bounded class of low-ratio warning. It does not
replace net fill with line-box occupancy, prove that a following block could fit, or identify an
avoidable source cause. The warning is experimental and never triggers exit 1, even when the
finding gate is `warn`. Coverage requirements can still make the run insufficiently measured.

## Accepted cases and explicit nonmeasurements

A natural document ending with low coverage is measured without that warning. A parity blank
page declines with `env/parity-blank-page`. Low coverage at an outgoing forced paginator ending
without a late start declines with `env/forced-break`. That observation does not establish that
the author wanted a short page. A late start remains measurable even when the ending is forced.

A chapter ending, title/part page or deliberate empty page needs verified design context. The
rule does not infer that intent from CSS. A smaller image, table or keep chain is a repair
candidate only after its actual placement and source cause are checked. The message names the
bottom-space measurement and paginator ending while leaving avoidability and author intent unknown.

## Calibration

`calibrated: false`. The candidate has not received the planned human example labels. Named
fixture/renderer checks and a bounded human evaluation are separate from population calibration.
Off in the default profile; strict, `--only` and explicit config enablement run it.

## Remediation

<!-- begin generated remediation: layout/half-empty-page -->
Inspect the page and its next page. Low glyph/visual-band coverage is not proof of an avoidable gap. Compare the reported bottom space with the actual following image, table or kept block; try a small size, margin or keep change only when that source cause is verified, then rerender both pages. For a late start, inspect leading margins, empty blocks and floats. A forced paginator ending is reported as unmeasured, and a natural document ending is accepted for low coverage; neither establishes author intent.
<!-- end generated remediation: layout/half-empty-page -->

## Examples

### Potential warning

A nonfinal page holds a short paragraph, has room for two recorded line heights, and its paginator
ending is not forced. A source-bound following figure may explain the gap; the low fill ratio
alone does not. Inspect both pages before changing image dimensions or a keep declaration.

### Accepted low coverage

The final page ends naturally with a short paragraph and no unusually late start. It receives
no low-coverage warning. A full prose page with low net fill but less remaining space than
twice the smallest recorded line height also receives none.

These are explanatory cases, not a tested repair pair. The registry advice remains untested.

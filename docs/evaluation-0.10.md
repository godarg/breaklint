# Bounded human evaluation for 0.10

On 2026-10-07 the maintainer reviewed ten selected real pages from three private product
documents. Each example included its actual page image, adjacent-page context where needed,
the published 0.9.0 report and the candidate report on the same HTML, CSS and resource bytes.
The four complete comparison runs retained 215 byte-identical page rasters under the same
renderer conditions. The baseline uses the published package through a private capture adapter
at its real producer boundary; this study does not claim stock CLI orchestration equivalence.
Product inputs and the review package remain private; public fixtures
are separately authored examples, not excerpts from paid products.

These are ten examples of changed or better explained behavior, rather than ten newly found
defects. The maintainer supplied six `defect` labels and four `acceptable/intended` labels:

| examples | observation | actual human feedback | resulting adjustment |
|---|---|---|---|
| E1–E2 | Existing table headers are absent on continuations; measured column tracks change. | A repeated header and shared widths would help. | Retain the bounded checks and the explicit source/geometry requirements. |
| E3 | A header is absent; the largest measured edge displacement is 12.47 CSS px. | A repeated header would help; the widths look almost identical. Consistency is desirable if they differ. | Describe displacement as a measurement, without inferring material reader impact from its magnitude. No threshold was tuned to this page. |
| E4 | The initial table fragment contains only its header; data starts on the next page. | The header should first appear with the first data row. | Report that specific measured context and suggest checking a local header/first-row keep before repetition. |
| E5 | Low glyph-band fill on an almost vertically full page. | Acceptable; the previous warning was unnecessary. | Retain the two-line bottom-space guard. |
| E6 | A title page has low fill and an observed outgoing forced break. | Acceptable; leave it as designed. | Retain the explicit forced-break nonmeasurement. The general rule still does not infer intent from CSS or page shape. |
| E7 | Short natural document end. | Acceptable; the previous warning was unnecessary. | Retain the document-end guard. |
| E8 | A low-fill page precedes a large figure, with separated chapter context. | A defect; keeping the chapter context with the figure on the next page is the preferred repair. | Preserve the gap warning and its unknown-cause wording. A product-specific keep remains a repair proposal, not a general keep exemption. |
| E9 | An inline SVG and its caption are together; the old version could not measure the body. | Acceptable; the candidate judged it correctly. | Retain the concrete SVG-body witness. This is improved positive measurement coverage. |
| E10 | A table ends beside its caption, but lacks a repeated header on its continuation. | A defect in table context; repeat the header and consider starting the heading with the table on the next page. | Keep the table warning separate from the measured correct caption placement. The page's defect label is not a caption-separation label. |

Three repair proposals were then tested on positive scratch copies made by the documented
product producer, with one explicit source change per trial. Keeping the initial table header
with its first data row moved both to the same page in E4; a later continuation still needed
a repeated header. Keeping chapter context with its figure in E8, and with its table in E10,
also brought the requested context together. Each trial created or enlarged a gap on the
preceding page. Those gaps remain reported rather than being exempted by the keep property.
Page counts, source text, SVG bytes and the document-wide visible PDF glyph multiset were
preserved. A glyph multiset does not establish reading order; source order was checked
separately. These are tested local proposals, not repairs to delivered products or universal
layout prescriptions.

For E3 an independent PDF text-position measurement confirmed a 3.30 mm shift at the second
column start. That verifies the displacement, not material reader harm. Two additional named
pages outside the ten examples exercised an almost vertically full page and a persistent
large gap. They were selected after feedback and had been examined previously.

The recorded answers are a human evaluation of these examples. They are not a blind random
sample or a population precision/recall estimate.
The controls used during implementation, and previously examined pages outside this selection,
must not be described as an independent blind holdout. New independent acceptance and release
gates remain separate requirements.

All rules retain `calibrated: false`. The two table checks and the two figure checks remain
optional because their proof requires supported source and rendered structures. The experimental
half-empty-page check remains optional because its fill and bottom-space tolerances request
review rather than establish a universal design boundary. Twelve existing checks remain enabled
by default. A product-specific preference is not promoted to a public rule merely because the
maintainer accepted it on these pages.

Table row membership, visible cell geometry and independent PDF/page controls validate the
named bounded mechanisms. Figure body equality and legacy-anchor controls validate their own
contracts. Human example labels, rules adjusted using those labels, validation on named controls
and any future threshold calibration are distinct claims.

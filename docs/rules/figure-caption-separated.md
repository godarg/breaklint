# figure/caption-separated

| | |
|---|---|
| severity | warn (off by default) |
| threshold | page distance between caption and body > `maxPageDistance` (default 0) |
| proof source | — |
| calibrated | **no** |

## What is checked

A `<figure>` whose `<figcaption>` lands on a different page than its body. The body is one
authored `<img>`, root inline `<svg>` or `<table>`, measured on its own, never through the
wrapper box. A responsive figure with several variants is supported when **exactly one** body
renders and every other variant is `display: none`. The warning names both pages; it does not
establish the cause, author intent, or that a keep remedy would fit.

A table body may span pages. Its source row and cell IDs, order, content and spans must match the
printed fragments (`rowSpan === 1`; rows of different lengths are measured), and each page's body
box is the union of its visible cells. The authored caption order decides which body page counts:
the last for a caption after the table, the first for a caption before it.

## Declined, not judged

Several rendered bodies or captions, split or repeated images, hidden, clipped, masked or
filtered bodies, unsupported flow, a source mismatch, duplicated or split data rows and
`rowSpan > 1` decline with their reason. An inline SVG needs a visible painted primitive.
Documents with executable scripts are measured only when the runtime DOM is verified unchanged
against the source; any DOM mutation, a `<base>` element or authored paginator attributes make the
figure inventory unavailable. A decline caused by a script names what was observed.

## Calibration

`calibrated: false`. Off in the default profile; `--profile strict` and explicit configuration run
it. A deliberately separated caption can be accepted with design context. For a table, a
whole-table keep is unsuitable when the body cannot fit one page; rerender every fragment and
check rows, columns and caption context after any change.

## Remediation

<!-- begin generated remediation: figure/caption-separated -->
Inspect the measured body boundary and caption on the named pages. For a short image or table with a short caption, try 'break-inside: avoid' on the figure or remove an unintended forced break on its caption. For a multi-page table, keep only the caption with the nearest body rows rather than keeping the entire table. These are untested suggestions: deliberate separation can be acceptable, and the rule does not prove the pagination cause or that a keep will fit.
<!-- end generated remediation: figure/caption-separated -->

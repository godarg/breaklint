# figure/caption-separated

Supports a standard `<figure>` with one authored `<img>`, root inline `<svg>` or `<table>` body and one
visible `<figcaption>`, as well as responsive multi-variant `<figure>` elements (for example a print-visible
`<svg>` paired with a mobile `display: none` variant) when **exactly one** authored body candidate renders
visible with a verified source identity and every other authored candidate is witnessed non-rendered
(`display: none` with zero layout boxes). Nested SVG belongs to its root body. The concrete body is measured
independently of the wrapper; it warns when page distance exceeds `maxPageDistance` (default 0).
The warning names both pages, but does not establish the pagination cause, author intent or that
a keep remedy would fit.

Multiple simultaneously rendered bodies, zero visible bodies, non-`display: none` hidden/broken/clipped
variants (such as `opacity: 0`, `visibility: hidden`, or `clip-path`), dropped or mismatched candidates,
split/repeated image bodies, missing/hidden geometry, clipping/masking/filter effects,
multiple captions, unsupported flow and source mismatch decline. An inline SVG needs a nonzero
paint primitive intersecting its viewport: a DOM paint-state witness, not an ink-mask proof.
A convenient wrapper box cannot replace this evidence. Non-executing data scripts
(`application/json`, `application/ld+json`) do not mark a document script-bearing; documents with
executable scripts or inline `on*` handlers unlock the figure inventory only when runtime-verified
mutation-free with exact DOM element-count parity and static-to-runtime figure/ID/anchor/reference
tree parity. Any DOM mutation, `<base>` element, authored `data-ref`/`data-next-break-before`/`data-undisplayed`,
no source-map mode and stored snapshots without an inventory decline inventory unavailable.

A table body can span several pages. Its source row/cell IDs, order, normalized content and
regular column spans (`rowSpan === 1` with uniform grid width) must match all actual printed
fragments; repeated existing header clones are allowed,
while duplicated/split data rows, `rowSpan > 1`, irregular spans and unknown membership decline. Each page's body box is the
union of its positive visible cell boxes. Neither the table nor figure wrapper supplies the body
measurement. Every visible table fragment needs such a witnessed box inside the page content
area, with supported horizontal single-column flow.

The authored caption order supplies `captionPosition`, without inferring design intent. For a
caption after the table, distance is measured from the last body page; for a caption before it,
from the first. The table may span pages without being separated from its caption. Missing order
in an older inventory, ambiguous body membership or unsupported table geometry declines.
This body check does not require an existing header; the separate continuation-header checks do.
An unverified or DOM-mutating script figure inventory remains unavailable even when the table
continuation checks can establish their own exact membership witness.

SVG identity uses a full normalized content hash and preserves meaningful text whitespace,
authored style, drawing attributes and content. Normalization follows measured Paged.js 0.4.3
parser changes: removed comments/non-text formatting nodes and `data-id` added from an existing
ID, without overwriting authored `data-id`. Breaklint/paginator addressing metadata is excluded;
`data-next-break-before` and `data-undisplayed` are excluded only after the authored inventory rules out source ownership.
This is a body-equality witness, not the coarser finding fingerprint. Changed body content cannot
borrow geometry from an unchanged wrapper.

Warning, off in the default profile; strict and explicit enablement run it. `calibrated: false`.
The planned human example evaluation is pending. A deliberately separated caption can be accepted
with design context; suggested size/keep changes remain untested.
For a table, inspect the measured body boundary and caption page before changing caption
placement or table sizing. A whole-table keep is unsuitable when the body cannot fit one page.
Rerender all table fragments and confirm row preservation, column alignment and caption context;
this is an untested suggestion, not proof of the break cause.

## Remediation

<!-- begin generated remediation: figure/caption-separated -->
Inspect the measured body boundary and caption on the named pages. For a short image or table with a short caption, try 'break-inside: avoid' on the figure or remove an unintended forced break on its caption. For a multi-page table, keep only the caption with the nearest body rows rather than keeping the entire table. These are untested suggestions: deliberate separation can be acceptable, and the rule does not prove the pagination cause or that a keep will fit.
<!-- end generated remediation: figure/caption-separated -->

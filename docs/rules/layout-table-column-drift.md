# layout/table-column-drift

This optional warning compares continuation data-cell left and right edges with the first visible header's column tracks, relative to each table fragment's own origin. Page stacking therefore does not create a displacement. The maximum measured displacement is compared with `maxColumnDriftPx` (default 2 CSS px). This is a chosen warning tolerance, not a calibrated proof threshold.

The supported source/fragment contract is the same as [the missing-header check](layout-table-header-not-repeated.md): exact row/cell membership and content, unit spans, a visible initial header and measured single-column horizontal flow. Split data rows, spanning cells, missing or unusable boxes, unsupported flow and source mismatch decline. A wrapper's width cannot replace the concrete cell boxes. Legacy snapshots without the table inventory decline.

The warning proves changed measured tracks. Deliberate different continuation widths can be acceptable; cause and intent remain unknown. Inspect both pages before applying fixed widths, and check wrapping, cell overflow and row preservation afterward. Header and drift symptoms on one source table are related targets, not automatically proof of one cause.

The displacement alone does not establish material reader impact. Inspect both page images;
a small difference can remain readable even when shared tracks would be more consistent.

Off in the default profile; strict and explicit enablement run it. `calibrated: false`; bounded geometry/PDF controls are separate from human evaluation and population calibration. Repair advice is untested.

## Remediation

<!-- begin generated remediation: layout/table-column-drift -->
Compare column boundaries on the named pages. Try an explicit colgroup or shared column-width constraints across fragments, then rerender and check every cell for wrapping and overflow. The measured displacement establishes changed tracks, not an incorrect author intention. The suggested repair has not been tested on this table.
<!-- end generated remediation: layout/table-column-drift -->

# layout/table-header-not-repeated

This optional warning checks a table's existing authored header against its actual printed continuation fragments. It does not invent a header from the first data row. An explicit `thead`, or the initial contiguous all-`th` rows of an older table, supplies the reference. The first visible fragment must contain that header. Each continuation with visible data is checked for the same visible header cells.

Snapshot 7 binds source row/cell identities, order, content and unit spans to measured cells. Repeated header clones are allowed; duplicated or partly split data rows, spanning cells, missing source membership and changed content decline. Headerless tables decline rather than receive an invented missing-header warning. Table and ancestor multicolumn/vertical flow decline. A missing inventory in a stored snapshot is an explicit nonmeasurement. A wholly hidden authored table is excluded only with an observed hidden block witness.

The finding identifies the continued table, reference page, missing header count, visible data rows and source location when available. It establishes a loss of column labels. It does not prove that the author dislikes this treatment or that a particular CSS declaration caused it. Header and column drift findings may concern the same table; a shared rule ID alone never establishes a shared cause.

When the initial fragment contains only the header, the finding also names that page and the
first data-row page. Check a local header/first-row keep before addressing later repeated
headers. This is measured context, not proof of the break cause.

Off in the default profile; strict and explicit enablement run it. `calibrated: false`; source membership and PDF controls validate the bounded check, not population accuracy. Repair advice is untested.

## Remediation

<!-- begin generated remediation: layout/table-header-not-repeated -->
Compare the named header and continuation pages. If the first fragment contains only the header, first try keeping that header with the first data row. Preserve the existing header and try a producer/Paged.js repeated-header handler or appropriate table-header-group styling for later fragments. Confirm that every data row remains exactly once, column edges stay aligned and page fill remains acceptable. A whole-table keep is unsuitable when the table cannot fit. This is an untested suggestion, not proof of the break cause.
<!-- end generated remediation: layout/table-header-not-repeated -->

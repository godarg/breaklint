# figure/dangling-reference

Checks fragment-only hrefs on `<a>` whose text contains Figure/Fig./Abbildung/Abb. or
Table/Tbl./Tabelle/Tab. followed by a number. The rule ID remains unchanged. All authored IDs,
including inline and SVG IDs, are indexed. Legacy `<a name>` targets supply fragment destinations
only when no authored ID has that name. Duplicate destinations and invalid fragment encoding
decline the containing source block.

One candidate is evaluated per containing source block; a warning reports its distinct missing
targets above `maxMissingTargets` (default 0). An old figure inventory without `namedAnchors`
cannot prove a missing destination merely because its ID index lacks it; that block declines.
Missing or incomplete inventory, source scripts/base elements and unsupported source addressing
remain explicit nonmeasurements. An absent reference candidate is distinct from an unmeasured one.

External links and unlinked textual numbers are outside scope. Location/page identify the
containing block, not the exact inline link. The check does not validate printed numbering,
printed page references or target visibility. Warning, default-off, uncalibrated; strict and
explicit enablement run it. Cause, intent and the proposed repair remain unverified.

## Remediation

<!-- begin generated remediation: figure/dangling-reference -->
Check the missing fragment targets named in the finding. Correct the local href or add the intended unique authored ID or legacy a[name] anchor. IDs take precedence over named anchors. The location identifies the containing source block, not the exact inline link. This check does not validate printed numbers, external references, or the target's visibility.
<!-- end generated remediation: figure/dangling-reference -->

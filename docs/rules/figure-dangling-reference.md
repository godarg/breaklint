# figure/dangling-reference

Checks fragment-only hrefs on `<a>` whose text contains Figure/Fig./Abbildung/Abb. followed by a number. All authored IDs, including inline and SVG IDs, are indexed. One candidate per containing source block; reports the number of distinct absent target IDs above `maxMissingTargets` (default 0). Duplicate IDs or invalid fragment encoding decline that block. External links and unlinked textual numbers are outside scope. Location/page refer to the containing block. Warning, default-off; no printed-number or target-visibility claim.

## Remediation

<!-- begin generated remediation: figure/dangling-reference -->
Check the missing fragment targets named in the finding. Correct the local href or add the intended unique authored ID. The location identifies the containing source block, not the exact inline link. This check does not validate printed figure numbers, external references, or the target's visibility.
<!-- end generated remediation: figure/dangling-reference -->

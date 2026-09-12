# Source identity and repair comparison

`checkProducedDocuments` can measure a host-owned local Git revision alongside the producer's
captured bytes. `compareReports` compares two canonical document reports and returns explicit
`new`, `persisting`, `resolved`, `unmatchable`, or `not-sufficiently-measured` rows. It keeps
follow-on findings visible. Its reason values are fixed categories, never commands or approvals.

```ts
import { checkProducedDocuments, compareReports } from "breaklint";

const options = {
  outputPaths: ["build/print.html"],
  revision: {
    repositoryRoot: "/absolute/owner/repository",
    sourcePrefix: "authoring", // producer logical source paths are relative to this directory
  },
};
const before = await checkProducedDocuments({ producer, options });
// Repair CSS/geometry, preserve the original author anchor and semantic node, then produce again.
const after = await checkProducedDocuments({ producer, options });
if (before.ok && after.ok) {
  const comparison = await compareReports(before.report, after.report, {
    revision: { repositoryRoot: options.revision.repositoryRoot },
  });
  console.log(comparison.results);
}
```

`producer` is the explicit host-controlled producer described in the producer API; it is never
read from document or manifest text. The revision option belongs to the host, too. The adapter
starts fixed read-only Git commands with `execFile`, a bounded timeout, and no shell. It disables
Git's filesystem-monitor command. No manifest can select its executable or command arguments.

The root must be the actual Git repository root with an existing `HEAD`. `sourcePrefix` defaults
to the repository root. The adapter captures tracked and non-ignored untracked regular files
under that prefix, with the producer's existing file/byte limits. Select a narrower prefix when
the repository contains more than 2,000 source files. Unsafe, protected, missing or symlinked
paths fail closed. Every producer input, including assets and dependencies, must match both
host snapshots at its exact logical relative path and hash. The repository/source state must
remain unchanged during execution; producer code also passes its separate before/after capture.
The public revision contains digests, commit/tree identities and observation time, with no
absolute repository path or source bytes.

Two verified working-tree snapshots can share the same measured base commit/tree. Different
commits require an actual `merge-base --is-ancestor` readback in the matching repository; pass
`compareReports` the host root for that check. A declared revision, missing receipt, unknown
source identity, foreign repository or foreign source prefix cannot establish continuity.

A target has a unique identity only when the complete verified original bytes contain a unique
author `id` or `data-source-id` at its exact parsed original element and the produced target is
not duplicated. No author anchor means `unavailable`. Duplicate anchors and duplicated copies
remain `ambiguous`; partial target enumeration withdraws unique identities. Neither page,
source offset, document order, run-local SID nor a measured rectangle substitutes for an anchor.
Healthy evaluations receive the same identity as findings through the actual engine path.

`canonical-node-v1` hashes the parsed original tag, namespace, exact text, complete child
structure, comments and attributes. It ignores only `class`, `style`, `x`, `y`, `dx`, `dy`,
`width`, `height`, `transform`, `textLength` and `lengthAdjust`, including those attributes on
descendants. Text is not normalized. Changing text, child structure or identity attributes
changes the semantic digest. Moving the unchanged node to another line retains the identity.

The identity contract is `logical-source-value-v1`. Removing and identically recreating a node
between two snapshots is not observable: the same unique semantic value in the same verified
logical document revision is considered the same comparison target. This is an integrity and
continuity check inside the owner's existing repository, with no protection against a host
deliberately fabricating its producer or historical report JSON.

Resolution requires matching logical scope, rule semantics/tool version, configuration,
renderer/environment, font identity and complete resource identity, plus verified revision
lineage and positive decisions for all relevant parts of the same unique target. The engine's
explicit all/any predicate supplies the health decision; a primary threshold or empty finding
list does not. Actual font-byte continuity uses a closed embedded-font witness: script-free
author documents with captured CSS `@font-face` URL resources, or a closed base64 font URL
whose decoded bytes exactly match a captured font asset, and a CDP readback confirming that
all glyphs within the completely enumerated paginated content use custom fonts. The owned CDP
session is prepared before navigation, so its activity participates in the normal acquisition
and PDF state checks. More than 2,000 content elements withdraw this bounded font witness.
Local font sources, script-built
fonts, absent readbacks and any system/fallback font leave `fontIdentity` unavailable.
System-font-only comparisons therefore cannot prove repair, even with equal family names.
This closes the unknown-font case without adding system-font discovery infrastructure.
The development HTTP-font fixture exposed font requests that did not settle after Paged.js
preview on the measured browser/driver. Such an acquisition remains an infrastructure failure;
the tracker is not forced quiet. The positive repair fixture uses the captured inline font path.
A captured non-font dependency may change during a verified repair when its
old and new hashes are inventory-bound. Changed font bytes, blocked/failed requests (including
an implicit favicon request), incomplete resources and unknown identity prevent resolution.
Use an explicit supported favicon declaration when an otherwise self-contained fixture must
avoid the browser's implicit blocked favicon request.

The two explicit applicability transitions currently admitted are a still-visible block with
measured `break-inside: avoid` becoming false, and still-rendered SVG text under measured
`overflow: visible`. Their rule-specific property receipts are required. Hiding or deleting a
target, disabled rules, missing decisions, reduced target parts, capped enumeration, declined
measurements, coverage failures and infrastructure failures cannot resolve it. Missing or
replaced target identity remains `unmatchable`. Page-only findings currently have no author
identity and therefore cannot promise a precise repaired target.

This comparison currently accepts document `Report` values. The screen API has its own
discriminated report and does not acquire a Git/source relation from a DOM selector alone.

For evidence displays, a current document finding may carry `target.renderBox` in
`css-page-top-left` coordinates with the measured outer page width/height. It is computed from
the actual outer page rectangle and target screen rectangle. Legacy snapshots without that
measurement omit it; consumers must not crop a PDF screenshot using `boxScreen` directly.

Focused verification:

```sh
node --test --experimental-strip-types tests/unit/revision-comparison.test.ts
```

The integration fixture executes the actual producer, browser acquisition and rules against
a temporary Git repository: an SVG label's negative x-coordinate becomes positive while its
author anchor/text remain unchanged. It also checks committed ancestry and failure categories.


`ok: true` from `checkProducedDocuments` means a report was produced; findings may still exist. A changed expected document set blocks repair comparison. Matched observations under incompatible conditions appear once as insufficiently measured. New findings require compatible scope, renderer, rules, resources and complete inventories. Captured CSS must use a dependency/asset input role to be served by the renderer; an authoring input alone is not a resource capability. Page-only targets and screen reports do not gain a repaired status through this API.

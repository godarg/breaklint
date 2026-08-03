import { defineRule } from "../../core/rule.ts";
import { resourceKey } from "../../core/fingerprint.ts";
import { makeFinding } from "../shared.ts";

/**
 * artifact/local-uri — a reference that only resolves on the machine that built the document.
 *
 * A warning, and the downgrade is deliberate. An earlier version claimed proof class A, which
 * demands a *geometric* invariant between two measured quantities. A URI scheme is not a
 * geometric quantity, and a local reference can be intentional. Proof class C — a resolution
 * invariant — describes exactly what this rule would need, and no spike supports it. A proof
 * class that exists only on paper is not a proof, so the rule warns.
 *
 * What it reads matters more than what it decides. It reads `uriRefs`, which holds every
 * URI-bearing attribute and every CSS `url()` from the DOM and the CSSOM — *whether or not the
 * browser fetched it*. Reading the list of requested resources instead would miss a `srcset`
 * candidate the browser never chose and a rule that never applied, and those are precisely the
 * references that survive to bite someone later.
 */
export const localUri = defineRule(
  {
    id: "artifact/local-uri",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "occurrences",
    defaultOptions: { maxOccurrences: 0 },
    summary: "A file: URI or an absolute build-machine path remains in the artefact.",
    declines: [],
  },
  (snapshot, ctx) => {
    const findings = [];
    let candidates = 0;
    let measured = 0;

    const permitted = Number(ctx.options.maxOccurrences ?? 0);
    let seen = 0;
    for (const ref of snapshot.uriRefs) {
      candidates += 1;
      measured += 1;

      const scheme = ref.scheme.toLowerCase();
      // A data: URI carries its own content; a relative path travels with the document.
      if (scheme === "data" || scheme === "") continue;
      const isFileScheme = scheme === "file";
      const isAbsoluteLocalPath = /^\/(?!\/)/u.test(ref.rawValue) && !/^\/\//u.test(ref.rawValue);
      if (!isFileScheme && !isAbsoluteLocalPath) continue;
      seen += 1;
      if (seen <= permitted) continue;

      findings.push(
        makeFinding({
          ctx,
          ruleId: "artifact/local-uri",
          severity: "warn",
          message:
            `occurrences: ${seen} (permitted: ${permitted}). ${ref.attribute}="${ref.rawValue}" resolves only on ` +
            `the machine that produced this document` +
            (ref.requested ? "." : " and was never fetched, so no load error revealed it.") +
            ` Heuristic: a local reference can be deliberate.`,
          page: 1,
          keyType: "resource",
          key: resourceKey(ref.resolvedUri),
          nodeKey: ref.nodeKey,
          sid: null,
          source: null,
          value: seen,
          threshold: permitted,
          unit: "occurrences",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured: [] };
  },
);

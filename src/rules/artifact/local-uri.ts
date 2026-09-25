import { defineRule } from "../../core/rule.ts";
import { resourceKey } from "../../core/fingerprint.ts";
import { makeFinding, targetEvaluation } from "../shared.ts";
import { urlInputText } from "../../core/uri-text.ts";

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
    remediation: {
      advice:
        "A resource points to a local filesystem URI ('file:') or an absolute machine path. The rule has no notion of a distribution root: EVERY absolute path is reported, inside the project or not, a root-relative '/docs/...', a protocol-relative '//host/...' and a Windows drive or share path included, because unless an http(s) <base href> governs it, an absolute path resolves against the file system of the machine that rendered the document. Replace it with a relative URL, an absolute URL on the host the document is published from, or embed the asset directly (e.g. a data URI for a small image).",
      // No trigger/remedied pair ships with this package and no gate re-runs one, so this
      // advice is untested in the sense the field defines.
      tested: false,
    },
  },
  (snapshot, ctx) => {
    const findings = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;

    const permitted = Number(ctx.options.maxOccurrences ?? 0);
    let seen = 0;
    for (const [refIndex, ref] of snapshot.uriRefs.entries()) {
      candidates += 1;
      measured += 1;

      const local = isLocalReference(ref);
      if (local) seen += 1;
      evaluations.push(targetEvaluation({ ruleId: "artifact/local-uri", keyType: "resource", nodeKey: ref.nodeKey, sid: null, occurrenceKey: String(refIndex), status: "measured", measurements: [{ name: "is-local-uri", value: local, unit: null, operator: "=", threshold: true }, { name: "local-uri-occurrence-index", value: seen, unit: "occurrences", operator: ">", threshold: permitted }], connective: "all", violated: local && seen > permitted }));
      if (!local || seen <= permitted) continue;

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
          key: resourceKey(localKey(ref)),
          nodeKey: ref.nodeKey,
          sid: null,
          source: null,
          value: seen,
          threshold: permitted,
          unit: "occurrences",
        }),
      );
    }
    return { findings, candidates, measured, notMeasured: [], evaluations };
  },
);

/**
 * Whether an authored reference names a place on some machine's filesystem.
 *
 * `scheme` is the AUTHORED scheme (see `uriParts` in `src/measure/snapshot.ts`), so every
 * absolute path has scheme "" exactly like a portable relative path, and the shape of the value
 * has to decide. `resolvedUri` says what the document base made of it: a file: URL into the local
 * tree, or, under an http(s) `<base href>` that governs the reference, a URL on that host.
 */
function isLocalReference(ref: { rawValue: string; scheme: string; resolvedUri: string }): boolean {
  const text = urlInputText(ref.rawValue);
  const scheme = ref.scheme.toLowerCase();
  if (scheme === "file") return true;
  // A Windows drive path. The URL parser reads `C:` as a one-letter scheme, so it is tested before
  // the scheme is trusted; no registered URI scheme has a single letter.
  if (/^[A-Za-z]:[\\/]/u.test(text)) return true;
  // Every other scheme names no local file: remote URLs, mailto:, data: (it carries its own
  // content), blob: (a browsing session's object), about:.
  if (scheme !== "") return false;
  // A scheme-less value resolved against an http(s) <base href> is a URL on the publishing host.
  if (/^https?:/iu.test(ref.resolvedUri)) return false;
  // Any leading slash or backslash: an absolute path, a root-relative path, a Windows share
  // (`\\server\share`) or a protocol-relative `//host/x`. From a document rendered out of a
  // local file every one of them resolves to a file: URL — `//host/x` to file://host/x. A relative
  // path, a fragment and `~/` (a plain path segment in a URL) are not local.
  return /^[\\/]/u.test(text);
}

/**
 * The fingerprint key of a local reference. A scheme-less value is keyed on its own text, resolved
 * against `file:///`: that is where it points from a document opened as a local file, and it
 * does not depend on where the checkout lives. Its `resolvedUri` does — `/docs/a.html` resolves to
 * file:///<checkout>/docs/a.html — and a fingerprint must not move with the directory.
 */
function localKey(ref: { rawValue: string; scheme: string; resolvedUri: string }): string {
  if (ref.scheme !== "") return ref.resolvedUri;
  const text = urlInputText(ref.rawValue);
  try {
    return new URL(text, "file:///").href;
  } catch {
    return text;
  }
}

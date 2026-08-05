/**
 * Why a page boundary is where it is — decided from what the paginator wrote, and nothing else.
 *
 * This is the most consequential classification in the tool. `forced` puts `env/forced-break` on a
 * boundary, and that silences rules 1, 2, 5 and 6 — four of the seven layout rules. A method that
 * over-reports `forced` therefore deletes measurement coverage silently, while the report goes on
 * looking orderly. A method that under-reports it turns every deliberate chapter opening into a
 * `layout/half-empty-page` finding. Neither error is cheap, and they point in opposite directions.
 *
 * TWO EARLIER METHODS ARE MEASURED-REFUTED AND MUST NOT COME BACK.
 *
 *   The browser cascade. Paged.js resolves CSS with its OWN parser, and the two disagree in both
 *   directions — nested `@media`, `@layer` ordering, an `!important` against an id selector. Over
 *   19 fixtures the rule walk is wrong in 11 and the fully resolved browser cascade in 4.
 *
 *   The remaining fill of the page. Refuted directly, not merely uncalibrated: a FREE boundary in
 *   front of a tall unbreakable block leaves 0.8542 of the page, while the smallest remainder at a
 *   FORCED boundary is 0.665. No threshold separates the two groups, so there was never a number
 *   to calibrate.
 *
 * WHAT IS READ INSTEAD. Paged.js writes its resolved decision into the tree itself, and
 * `shouldBreak()` reads exactly three attributes. Over the same 19 fixtures that method is wrong
 * in 0. The coupling to an undocumented internal is deliberate and is bounded by an exact version
 * pin with a fail-closed runtime check (L-35).
 *
 * MEASURED AGAINST PAGED.JS 0.4.3 FOR THIS IMPLEMENTATION, on documents built to carry every
 * boundary kind at once:
 *
 *   break-before via stylesheet CLASS      -> `data-break-before="page"` on the breaking node
 *   break-before via stylesheet ID         -> same
 *   break-before: recto                    -> `data-break-before="recto"`, and a blank page appears
 *   break-after via CLASS, ID or `p.adj+p` -> `data-previous-break-after="page"` on the node AFTER
 *   a named page (`page: named`)           -> `data-page="named"`, and the boundary has NO other
 *                                             attribute — the third branch of `shouldBreak()`
 *   break-before or break-after INLINE     -> NO attribute at all, and NO boundary. Inert.
 *
 * A FOURTH ATTRIBUTE EXISTS AND IS DELIBERATELY NOT READ. Paged.js also writes `data-break-after`
 * on the node that CARRIES the declaration. The contract names three attributes and reads
 * `data-previous-break-after` on the node after the boundary; that is the correct one, because it
 * is the node the boundary is being classified for. Reading `data-break-after` on the previous
 * page's last node would answer a question about a DIFFERENT boundary whenever the declaring node
 * is not the last one on its page. It is recorded here so the omission is a decision rather than
 * an oversight.
 */

import type { BreakCause } from "../core/types.ts";
import type { BreakCauseCascadeHint } from "../core/enums.ts";

/**
 * The values `shouldBreak()` treats as forcing. Read from the paginator's source, not invented:
 * anything else in these attributes (`auto`, `avoid`) does not break.
 */
export const FORCING_BREAK_VALUES: ReadonlySet<string> = new Set([
  "page",
  "left",
  "right",
  "recto",
  "verso",
  "always",
]);

export const BREAK_ATTRIBUTES = {
  before: "data-break-before",
  previousAfter: "data-previous-break-after",
  page: "data-page",
} as const;

/**
 * EXACT comparison — no trimming, no case folding.
 *
 * An earlier version normalised with `trim().toLowerCase()`, on the reasoning that the attribute
 * comes from a third party. That reasoning is backwards: this attribute is written by the
 * PAGINATOR, and the paginator compares the dataset value exactly. Normalising here makes this
 * classifier's notion of "forcing" strictly broader than the one that actually moved the content.
 *
 * Measured: an author-written `data-break-before=" Page "` produced NO break in Paged.js 0.4.3 —
 * the paragraph stayed on its page. The normalising version would have called such a boundary
 * forced and silenced four rules on it. Found by an adversarial cross-model audit; the unit test
 * that accompanied the old behaviour had pinned the wrong answer as correct.
 */
export function isForcingValue(value: string | null | undefined): boolean {
  return typeof value === "string" && FORCING_BREAK_VALUES.has(value);
}

/** Everything the classifier is allowed to look at for one boundary. */
export interface BoundaryFacts {
  /** The page AFTER the boundary carries no author content at all. */
  nextPageBlank: boolean;
  /** `data-break-before` on the first source-bearing node of the page after the boundary. */
  breakBefore: string | null;
  /** `data-previous-break-after` on that same node. */
  previousBreakAfter: string | null;
  /** `data-page` on the last source-bearing node BEFORE the boundary. */
  pageBefore: string | null;
  /** `data-page` on the first source-bearing node AFTER it. */
  pageAfter: string | null;
  /** Whether `afterPageLayout` handed out a break token for the page before the boundary. */
  hasBreakToken: boolean;
  /** Source ids, for the human-readable reason. Null when the node carries none. */
  sidBefore: string | null;
  sidAfter: string | null;
  /** Non-normative. Never consulted below — it is carried through, not acted on. */
  cascadeHint: BreakCauseCascadeHint | null;
}

export interface ClassifiedBoundary extends BreakCause {
  /** Human-readable, e.g. `break-before@s0007`. Empty when there is nothing to name. */
  reason: string;
}

/**
 * Classify one boundary.
 *
 * The order of the four branches is normative and is not an implementation preference:
 *
 *   1. a blank page is `parity` before anything else is asked, because a blank page has no first
 *      node to carry an attribute and no content to overflow. Asking the other questions first
 *      would read attributes off whatever happened to be nearby.
 *   2. `forced` beats `overflow` because `shouldBreak()` is consulted BEFORE the overflow check
 *      inside the paginator. A node with a forcing attribute that would ALSO have overflowed onto
 *      the next page is genuinely forced — that is L-33, and it is the correct attribution rather
 *      than a tie broken arbitrarily.
 *   3. a break token means the previous page ran out of room.
 *   4. anything left is `unknown`, which by §9 invariant 1 suppresses NOTHING: no rule silenced,
 *      no coverage lowered, no severity changed. The uncertainty is pushed in the direction where
 *      it is cheap. A wrong `forced` would cost four rules.
 */
export function classifyBoundary(facts: BoundaryFacts): ClassifiedBoundary {
  if (facts.nextPageBlank) {
    return { kind: "parity", determinedBy: "page-blank", cascadeHint: facts.cascadeHint, reason: "" };
  }

  if (isForcingValue(facts.breakBefore)) {
    return {
      kind: "forced",
      determinedBy: "pagedjs-break-attributes",
      cascadeHint: facts.cascadeHint,
      reason: `break-before@${facts.sidAfter ?? "?"}`,
    };
  }

  if (isForcingValue(facts.previousBreakAfter)) {
    return {
      kind: "forced",
      determinedBy: "pagedjs-break-attributes",
      cascadeHint: facts.cascadeHint,
      // The declaration lives on the node BEFORE the boundary, so that is the one to name — a
      // reader chasing this back needs the element they wrote `break-after` on.
      reason: `break-after@${facts.sidBefore ?? "?"}`,
    };
  }

  // The third branch of `shouldBreak()`: a change of named page breaks, with no break-before and
  // no break-after anywhere. Measured firing on a real boundary, and a reader that knows only the
  // two break attributes calls this boundary free.
  if (facts.pageBefore !== facts.pageAfter) {
    return {
      kind: "forced",
      determinedBy: "pagedjs-break-attributes",
      cascadeHint: facts.cascadeHint,
      reason: `page@${facts.sidAfter ?? "?"}`,
    };
  }

  if (facts.hasBreakToken) {
    return { kind: "overflow", determinedBy: "break-token", cascadeHint: facts.cascadeHint, reason: "" };
  }

  return { kind: "unknown", determinedBy: "undetermined", cascadeHint: facts.cascadeHint, reason: "" };
}

/** The first page's incoming cause and the last page's outgoing cause. Never null (§9 invariant 2). */
export function documentStart(): ClassifiedBoundary {
  return { kind: "document-start", determinedBy: "document-boundary", cascadeHint: null, reason: "" };
}

export function documentEnd(): ClassifiedBoundary {
  return { kind: "document-end", determinedBy: "document-boundary", cascadeHint: null, reason: "" };
}

/**
 * Turn a sequence of boundary facts into the per-page incoming and outgoing causes.
 *
 * `pages[i].incoming === pages[i-1].outgoing` is a snapshot invariant, and the way it gets broken
 * is two independent computations that agree by construction until one of them changes. Here the
 * boundary is classified ONCE and the same object is placed on both sides, so the invariant holds
 * by identity rather than by agreement.
 *
 * `boundaries[i]` is the boundary between page `i` and page `i + 1`, so a document of `n` pages
 * has `n - 1` of them.
 */
export function assignPageCauses(
  pageCount: number,
  boundaries: readonly BoundaryFacts[],
  /** Which pages are blank. §11.6 binds BOTH sides of a blank page to `parity`. */
  blankPages: readonly boolean[] = [],
): { incoming: ClassifiedBoundary; outgoing: ClassifiedBoundary }[] {
  if (pageCount <= 0) return [];
  if (boundaries.length !== pageCount - 1) {
    throw new Error(
      `breaklint: ${pageCount} pages need exactly ${pageCount - 1} boundaries, got ${boundaries.length}`,
    );
  }
  const classified = boundaries.map((facts) => classifyBoundary(facts));

  /**
   * §11.6 states the blank-page rule as a binding on the PAGE, not on the boundary:
   *
   *     blank ⟹ incomingBreakCause.kind = "parity" UND outgoingBreakCause.kind = "parity"
   *
   * The four-branch algorithm a few paragraphs earlier only asks whether the NEXT page is blank,
   * so it gives the boundary INTO a blank page `parity` and leaves the boundary OUT of it to be
   * decided by the following page's attributes. With `break-before: recto` that following page
   * carries the forcing attribute, so the blank page came out with `parity` incoming and `forced`
   * outgoing — which contradicts the contract's own invariant.
   *
   * The two statements are both in §11.6 and they disagree; the explicit invariant wins, because
   * it is the one a rule reads. A blank page is not a page whose exit the author chose — it exists
   * because of parity, and both of its edges say so. Found by an adversarial cross-model audit.
   */
  const parityOut = (index: number): boolean => blankPages[index] === true;
  const causes = Array.from({ length: pageCount }, (_, i) => ({
    incoming: i === 0 ? documentStart() : classified[i - 1]!,
    outgoing: i === pageCount - 1 ? documentEnd() : classified[i]!,
  }));

  for (let i = 0; i < pageCount; i += 1) {
    if (!parityOut(i)) continue;
    // The boundary object is shared with the neighbouring page by identity, so replacing it here
    // has to replace it on BOTH sides or the invariant `pages[i].incoming === pages[i-1].outgoing`
    // breaks in the act of satisfying a different one.
    const parity: ClassifiedBoundary = {
      kind: "parity",
      determinedBy: "page-blank",
      cascadeHint: null,
      reason: "",
    };
    if (i < pageCount - 1) {
      causes[i]!.outgoing = parity;
      causes[i + 1]!.incoming = parity;
    }
  }
  return causes;
}

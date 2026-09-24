import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import { declined, makeFinding, num, targetEvaluation } from "../shared.ts";

/**
 * layout/orphaned-continuation-page — a page whose only content is the tail of a block.
 *
 * The trap here is the forced break, and it is worth naming because reading it the obvious way
 * is verifiably wrong. `break-before: page` set from a stylesheet reads back as `auto` after
 * pagination; the same declaration written inline survives as `page` — and is measured *not*
 * to take effect. So a rule that asks `getComputedStyle` for the break reason gets it backwards
 * in both directions. The cause comes from the collector, which reads what the paginator itself
 * wrote into the tree.
 *
 * The second trap is the middle of a long block. "Every block here is a continuation" is also
 * true of every page between the first and the last fragment of a block that spans three pages
 * or more, and such a page is full by construction: the paginator only leaves a page when the
 * content overflows it. Net fill counts glyph boxes, not line boxes, so a full page reads far
 * below 1 — measured 0.34–0.36 at `line-height: 3` — and the rule reported every middle page of
 * a long paragraph set with generous leading. So a page is judged only when the block that
 * closes it ENDS there (`ends-on-page`): its last block in document order is that block's final
 * fragment. A page whose last block continues was left by overflow, whatever its net fill reads.
 * The guard needs no threshold; it follows from the break semantics. Its one measured cost: a
 * wrapper whose own bare text ends on the page while a child is carried to the next one (a tall
 * `break-inside: avoid` figure) also continues, so that nearly empty page is no longer judged.
 * The rule page states it; with the text in its own `<p>` the paragraph is last and it is judged.
 *
 * It rests on one invariant of the snapshot, stated here because the rule reads it and nothing
 * else in the type says so: `snapshot.blocks` is in collection order — page by page, and within
 * a page in document (pre-)order of the paginated tree. The collector walks `querySelectorAll`
 * once per `.pagedjs_page` (document order by specification) and assembly maps without
 * reordering; `fragmentIndex` is itself counted in that order. Two consequences carry the guard.
 * A wrapper (`main`, `section`) precedes its children, so the last block on a page is the
 * innermost block the page ends in; a wrapper that continues past the page comes before the
 * child that closes it. And every Paged.js margin box precedes `.pagedjs_area` in the page
 * template, so a `position: running()` clone in a margin box, wherever the collector records one
 * as a block, is never last on a page that has content of its own. The invariant is pinned from
 * both sides: the live suite checks the order the real collector produces, and the unit suite
 * checks that this rule reads the last block and nothing else.
 */
export const orphanedContinuationPage = defineRule(
  {
    id: "layout/orphaned-continuation-page",
    severity: "warn",
    proofSource: null,
    calibrated: false,
    experimental: false,
    unit: "fill ratio",
    defaultOptions: { maxNetFill: 0.5 },
    summary: "A page holds nothing but the tail of a block that began earlier.",
    declines: ["env/parity-blank-page", "env/forced-break"],
    remediation: {
      advice:
        "A continuation page holds only a tiny trailing fragment of an earlier block. Tighten preceding vertical margins, padding, or line-height on earlier pages to pull the remaining lines back, or insert 'break-before: page' earlier to balance content across pages.",
      // No trigger/remedied pair ships with this package and no gate re-runs one, so this
      // advice is untested in the sense the field defines.
      tested: false,
    },
  },
  (snapshot, ctx) => {
    const findings = [];
    const notMeasured = [];
    const evaluations = [];
    let candidates = 0;
    let measured = 0;
    const maxNetFill = num(ctx.options.maxNetFill, 0.5);

    for (const page of snapshot.pages) {
      candidates += 1;
      if (page.blank) {
        notMeasured.push(
          declined({ scope: "page", ruleId: "layout/orphaned-continuation-page", reason: "env/parity-blank-page" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "not-measured", reason: "env/parity-blank-page" }));
        continue;
      }
      // A page the author forced open is a decision. Judging its fill reports the intent back.
      if (page.incomingBreakCause.kind === "forced") {
        notMeasured.push(
          declined({ scope: "page", ruleId: "layout/orphaned-continuation-page", reason: "env/forced-break" }),
        );
        evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "not-measured", reason: "env/forced-break" }));
        continue;
      }
      measured += 1;

      // Collection order: within a page, document order (see the invariant above).
      const onPage = snapshot.blocks.filter((b) => b.page === page.pageNumber);
      const continuationOnly = onPage.length > 0 && onPage.every((b) => b.fragmentIndex > 0);
      const last = onPage.at(-1);
      const endsOnPage = last !== undefined && last.fragmentIndex === last.fragmentCount - 1;
      const violated = continuationOnly && endsOnPage && page.fill.net < maxNetFill;
      evaluations.push(targetEvaluation({ ruleId: "layout/orphaned-continuation-page", keyType: "page", nodeKey: page.nodeKey, sid: null, boxScreen: page.contentBox, status: "measured", measurements: [{ name: "continuation-only", value: continuationOnly, unit: null, operator: "=", threshold: true }, { name: "ends-on-page", value: endsOnPage, unit: null, operator: "=", threshold: true }, { name: "net-fill", value: page.fill.net, unit: "fill ratio", operator: "<", threshold: maxNetFill }], connective: "all", violated }));
      if (!violated) continue;

      const key = pageKey({
        firstSemanticBlockKey: page.firstSemanticBlockKey,
        pageOrdinal: page.pageNumber,
      });
      findings.push(
        makeFinding({
          ctx,
          ruleId: "layout/orphaned-continuation-page",
          severity: "warn",
          message:
            `Page ${page.pageNumber} carries only the end of a block that began on an earlier page, ` +
            `and its net fill is ${(page.fill.net * 100).toFixed(1)} %; threshold ` +
            `${(maxNetFill * 100).toFixed(0)} %. The break into it was an overflow, not a request.`,
          page: page.pageNumber,
          keyType: "page",
          key: key.key,
          nodeKey: page.nodeKey,
          sid: null,
          boxScreen: page.contentBox,
          source: null,
          value: page.fill.net,
          threshold: maxNetFill,
          unit: "fill ratio",
          ambiguity: key.ambiguous ? { groupSize: 2, resolvable: false } : null,
        }),
      );
    }
    return { findings, candidates, measured, notMeasured, evaluations };
  },
);

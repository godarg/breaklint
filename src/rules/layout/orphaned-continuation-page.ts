import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import type { BlockRecord, PageRecord, Snapshot } from "../../core/types.ts";
import { declined, makeFinding, num, targetEvaluation } from "../shared.ts";

/** Box-coordinate slack for rounded geometry, in CSS px. A tolerance, not a threshold. */
const EDGE_TOLERANCE_PX = 1;

/**
 * The blocks of a page's flow, in document order: those with a box that lie at least partly inside
 * the content box vertically.
 */
function flowBlocks(snapshot: Snapshot, page: PageRecord): BlockRecord[] {
  const top = page.contentBox.y;
  const bottom = page.contentBox.y + page.contentBox.height;
  return snapshot.blocks.filter((b) =>
    b.page === page.pageNumber &&
    (b.box.width !== 0 || b.box.height !== 0) &&
    b.box.y < bottom && b.box.y + b.box.height > top);
}

/**
 * Whether the page after `page` (the next one that is not a parity blank) opens with a block that
 * starts there. Every block before that fresh block in document order has to be a wrapper of it —
 * starting no higher, and spanning it horizontally — or the next page opens with continuing
 * content of its own, and the break fell inside that content.
 */
function nextPageOpensWithFreshBlock(snapshot: Snapshot, page: PageRecord): boolean {
  const next = snapshot.pages.find((p) => p.pageNumber > page.pageNumber && !p.blank);
  if (!next) return false;
  const blocks = flowBlocks(snapshot, next);
  const at = blocks.findIndex((b) => b.fragmentIndex === 0);
  if (at < 0) return false;
  const fresh = blocks[at]!;
  return blocks.slice(0, at).every((wrapper) =>
    wrapper.box.y >= fresh.box.y - EDGE_TOLERANCE_PX &&
    wrapper.box.x <= fresh.box.x + EDGE_TOLERANCE_PX &&
    wrapper.box.x + wrapper.box.width >= fresh.box.x + fresh.box.width - EDGE_TOLERANCE_PX);
}

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
 * or more. When what goes on to the next page is running text, such a page is full: the text
 * stopped because the next line did not fit. Net fill counts glyph boxes, not line boxes, so a
 * full page reads far below 1 — measured 0.34–0.36 at `line-height: 3` — and the rule reported
 * every middle page of a long paragraph set with generous leading.
 *
 * So a page is judged only when what it carries ENDS on it (`ends-on-page`), which is one of:
 *   - its last block in document order is that block's final fragment; or
 *   - the next page opens with a block that STARTS there: the break fell between blocks, so the
 *     page stopped because a fresh block did not fit (or was sent on), not because it was full.
 *     That is the case of a wrapper — `<section>`, `<article>` — whose own content (bare text,
 *     an image, an SVG) ends on the page while its next child is carried over; the wrapper then
 *     continues, and the first condition alone would not judge the page. "Opens with" means
 *     that every block before the fresh one on the next page, in document order, is a wrapper
 *     of it: it starts no higher than the fresh block and spans it horizontally. A continuation
 *     with content of its own above the fresh block (text running on, or a column beside it)
 *     means the break fell inside that content.
 * Neither condition needs a threshold; both follow from the break semantics. What is still not
 * judged: a wrapper whose own image or SVG did not fit and opens the next page (see the rule
 * page).
 *
 * Only blocks of the page's flow count for `continuation-only` and `ends-on-page`: a block with a
 * box (the `display: none` original of a running element has none) that lies at least partly
 * inside the content box vertically (a running element's clone in a top or bottom margin box,
 * wherever the collector records one, lies above or below it; so does the footnote area).
 * Horizontal position is not tested, so a full-bleed block stays in.
 *
 * It rests on one invariant of the snapshot, stated here because the rule reads it and nothing
 * else in the type says so: `snapshot.blocks` is in collection order — page by page, and within
 * a page in document (pre-)order of the paginated tree. The collector walks `querySelectorAll`
 * once per `.pagedjs_page` (document order by specification) and assembly maps without
 * reordering; `fragmentIndex` is itself counted in that order. A wrapper (`main`, `section`)
 * precedes its children, so the last block on a page is the innermost block the page ends in,
 * and on the next page a wrapper's continuation comes before the fresh child it holds. The
 * invariant is pinned from both sides: the live suite checks the order the real collector
 * produces, and the unit suite checks that this rule reads that order and nothing else.
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
      const onPage = flowBlocks(snapshot, page);
      const continuationOnly = onPage.length > 0 && onPage.every((b) => b.fragmentIndex > 0);
      const last = onPage.at(-1);
      const endsOnPage = last !== undefined &&
        (last.fragmentIndex === last.fragmentCount - 1 || nextPageOpensWithFreshBlock(snapshot, page));
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
            `Page ${page.pageNumber} carries only content continued from an earlier page, which ends ` +
            `there, and its net fill is ${(page.fill.net * 100).toFixed(1)} %; threshold ` +
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

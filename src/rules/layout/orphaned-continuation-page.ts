import { defineRule } from "../../core/rule.ts";
import { pageKey } from "../../core/fingerprint.ts";
import type { BlockRecord, Box, PageRecord, Snapshot, TextLine } from "../../core/types.ts";
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

/** Whether the centre of a line's box lies inside a block's box (within the tolerance). */
function centreInside(line: Box, block: Box): boolean {
  const cx = line.x + line.width / 2;
  const cy = line.y + line.height / 2;
  return cx >= block.x - EDGE_TOLERANCE_PX && cx <= block.x + block.width + EDGE_TOLERANCE_PX &&
    cy >= block.y - EDGE_TOLERANCE_PX && cy <= block.y + block.height + EDGE_TOLERANCE_PX;
}

/**
 * Whether the page after `page` opens with text running on: a text line of a continuing block that
 * starts within one of that block's line heights of the top of the next page's content. The top is
 * the higher of the first fill band and the first block that starts on that page. A line whose
 * centre lies inside a block that starts there AND follows the continuing block in document order
 * belongs to that block (a wrapper's lines include its children's), so it is not running text of
 * the continuation. Visibility plays no part: hidden text that ran on filled the page as much as
 * visible text. A parity blank page next carries no text, so the page before it — which a forced
 * break ended — is judged.
 */
function nextPageOpensWithRunningText(
  snapshot: Snapshot,
  page: PageRecord,
  linesByBlock: ReadonlyMap<string, readonly TextLine[]>,
): boolean {
  const next = snapshot.pages.find((p) => p.pageNumber === page.pageNumber + 1);
  if (!next) return false;
  const blocks = flowBlocks(snapshot, next);
  const fresh = blocks.filter((b) => b.fragmentIndex === 0);
  const firstBand = next.contentBox.y + next.fill.topGap * next.contentBox.height;
  const top = Math.min(firstBand, ...fresh.map((b) => b.box.y));
  return blocks.some((continuing, at) => {
    if (continuing.fragmentIndex === 0) return false;
    const ownedByLater = blocks.slice(at + 1).filter((b) => b.fragmentIndex === 0);
    return (linesByBlock.get(continuing.nodeKey) ?? []).some((line) =>
      !ownedByLater.some((b) => centreInside(line.box, b.box)) &&
      line.box.y < top + continuing.lineHeight);
  });
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
 * stopped because its next line did not fit. Net fill counts glyph boxes, not line boxes, so a
 * full page reads far below 1 — measured 0.34–0.36 at `line-height: 3` — and the rule reported
 * every middle page of a long paragraph set with generous leading.
 *
 * So a page is judged only when what it carries ENDS on it (`ends-on-page`): the next page does
 * not open with text running on from it. "Running on" is a text line of a block that continues
 * onto the next page, starting within one of that block's line heights of the top of the next
 * page's content, and not lying inside a block that starts there and follows it in document order
 * (a wrapper's lines include its children's). Everything else ends the page: a block that starts
 * on the next page and opens it (a wrapper — `<section>`, `<article>` — whose next child was
 * carried over), an image or SVG that did not fit, a forced break, the end of the document. The
 * decision needs no threshold, and it reads no box of the wrapper, so a border kept at the split
 * or a full-bleed child changes nothing. It also ignores which block closes the page: a nested
 * child that ends there while its wrapper's own text runs on leaves the page full.
 *
 * What it does not see: a block that starts on the next page and covers the running text (the
 * line's centre inside it) takes that text for its own, so the page before it is judged; the
 * rule page says so.
 *
 * Only blocks of the page's flow count, on this page and on the next: a block with a box (the
 * `display: none` original of a running element has none; an empty positioned marker has a 0 x 0
 * one) that lies at least partly inside the content box vertically (a running element's clone in
 * a top or bottom margin box normally lies above or below it; so does the footnote area).
 * Horizontal position is not tested, so a full-bleed block stays in — and so would a clone in a
 * side margin box: this rule relies on the collector keeping margin-box content out of the
 * snapshot, as the collector of this release does.
 *
 * It rests on one invariant of the snapshot, stated here because the rule reads it and nothing
 * else in the type says so: `snapshot.blocks` is in collection order — page by page, and within
 * a page in document (pre-)order of the paginated tree. The collector walks `querySelectorAll`
 * once per `.pagedjs_page` (document order by specification) and assembly maps without
 * reordering; `fragmentIndex` is itself counted in that order. A wrapper precedes its children,
 * so on the next page a continuation comes before any child of it that starts there, and only
 * such a later block can own the continuation's lines. The invariant is pinned from both sides:
 * the live suite checks the order the real collector produces, and the unit suite checks that
 * this rule reads that order.
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
    const linesByBlock = new Map<string, TextLine[]>();
    for (const line of snapshot.textLines) {
      const list = linesByBlock.get(line.blockKey);
      if (list) list.push(line);
      else linesByBlock.set(line.blockKey, [line]);
    }

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
      const endsOnPage = onPage.length > 0 && !nextPageOpensWithRunningText(snapshot, page, linesByBlock);
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

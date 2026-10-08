import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { SNAPSHOT_ROUNDING_PX } from "../../core/enums.ts";
import { declined, isNotRendered, layoutOutOfScope, makeFinding, renderedBox, sourceOf, targetEvaluation } from "../shared.ts";
import { blocksFor, unavailable } from "./shared.ts";
import { sourceTableMatches, measuredTableBodyFragments } from "../../source/table-index.ts";
const ID = "figure/caption-separated";
export const captionSeparated = defineRule({
  id: ID, severity: "warn", proofSource: null, calibrated: false, experimental: false,
  unit: "pages", defaultOptions: { maxPageDistance: 0 },
  optionBounds: { maxPageDistance: { integer: true, maximum: Number.MAX_SAFE_INTEGER } },
  summary: "A standard figure's measured image or source-matched table body and its caption exceed the page-distance allowance.",
  declines: ["env/figure-index-unavailable", "env/figure-body-unsupported", "env/multicolumn", "env/vertical-writing"],
  remediation: { advice: "Inspect the measured body boundary and caption on the named pages. For a short image or table with a short caption, try 'break-inside: avoid' on the figure or remove an unintended forced break on its caption. For a multi-page table, keep only the caption with the nearest body rows rather than keeping the entire table. These are untested suggestions: deliberate separation can be acceptable, and the rule does not prove the pagination cause or that a keep will fit.", tested: false },
}, (snapshot, ctx) => {
  const index = snapshot.figureIndex;
  if (!index?.complete) return unavailable(ID);
  const findings = []; const notMeasured = []; const evaluations = [];
  let candidates = 0; let measured = 0;
  for (const figure of index.figures) for (const captionSid of figure.captionSids) {
    candidates += 1;
    const captions = blocksFor(snapshot, captionSid).filter(block => !isNotRendered(snapshot, block));
    const caption = captions[0];
    const isTable = figure.body?.tag === "table";
    const table = isTable && snapshot.tableIndex?.complete
      ? snapshot.tableIndex.tables.find(table => table.sid === figure.body?.tableSid) : null;
    const bodies = (isTable && table ? measuredTableBodyFragments(table, figure.body!.identity)
      : [...figure.bodyFragments]).sort((a, b) => a.page - b.page);
    const body = isTable && figure.captionPosition === "after" ? bodies.at(-1) : bodies[0];
    const box = caption ? renderedBox(snapshot, caption) : null;
    const inside = bodies.length > 0 && bodies.every(body => {
      const page = snapshot.pages.find(p => p.pageNumber === body.page);
      return page && body.visible && body.box.width > 0 && body.box.height > 0 && body.identity === figure.body?.identity
        && body.box.x >= page.contentBox.x - SNAPSHOT_ROUNDING_PX && body.box.y >= page.contentBox.y - SNAPSHOT_ROUNDING_PX
        && body.box.x + body.box.width <= page.contentBox.x + page.contentBox.width + SNAPSHOT_ROUNDING_PX
        && body.box.y + body.box.height <= page.contentBox.y + page.contentBox.height + SNAPSHOT_ROUNDING_PX;
    });
    const tableUnsupported = isTable && (!table || !sourceTableMatches(table)
      || !["before", "after"].includes(figure.captionPosition ?? "")
      || new Set(bodies.map(body => body.page)).size !== bodies.length
      || table.fragments.some(fragment => fragment.visible && !bodies.some(body => body.page === fragment.page)));
    const unsupported = figure.captionSids.length !== 1 || !figure.body || (!isTable && bodies.length !== 1)
      || tableUnsupported || !body || !inside || captions.length !== 1 || !caption || !box;
    const flowReason = [caption, ...blocksFor(snapshot, figure.sid)].filter(block => block !== undefined)
      .map(block => layoutOutOfScope(block.effectiveStyle)).find(reason => reason !== null);
    const reason = table?.fragments.find(fragment => fragment.flowReason)?.flowReason || flowReason
      || (unsupported ? "env/figure-body-unsupported" as const : null);
    const target = { ruleId: ID, keyType: "block" as const, nodeKey: caption?.nodeKey ?? `caption:${captionSid}`, sid: captionSid, fragmentIndex: caption?.fragmentIndex ?? 0, boxScreen: box };
    if (reason) {
      notMeasured.push(declined({ scope: "block", ruleId: ID, reason, target: { keyType: "block", nodeKey: target.nodeKey, sid: captionSid } }));
      evaluations.push(targetEvaluation({ ...target, status: "not-measured", reason })); continue;
    }
    // The checks above establish both concrete fragments. No wrapper box is substituted.
    measured += 1;
    const distance = Math.abs(body!.page - caption!.page); const threshold = Number(ctx.options.maxPageDistance ?? 0); const violated = distance > threshold;
    evaluations.push(targetEvaluation({ ...target, status: "measured", violated, measurements: [
      { name: "body-page", value: body!.page, unit: "pages", operator: null, threshold: null },
      { name: "caption-page", value: caption!.page, unit: "pages", operator: null, threshold: null },
      { name: "page-distance", value: distance, unit: "pages", operator: ">", threshold },
    ] }));
    if (violated) findings.push(makeFinding({ ctx, ruleId: ID, severity: "warn", message: `Figure ${isTable ? `table body ${figure.captionPosition === "after" ? "ends" : "begins"}` : "image body is"} on page ${body!.page}; its caption is on page ${caption!.page}. ${isTable ? "Authored caption order and source-matched cell boxes establish the body boundary. " : ""}Review the separated caption; the cause and author intent are unknown.`,
      page: caption!.page, keyType: "block", key: blockKey(caption!), nodeKey: caption!.nodeKey, sid: captionSid,
      fragmentIndex: caption!.fragmentIndex, boxScreen: box, source: sourceOf(snapshot, captionSid), value: distance, threshold, unit: "pages" }));
  }
  return { findings, candidates, measured, notMeasured, evaluations };
});

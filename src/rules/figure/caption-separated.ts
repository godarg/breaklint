import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { SNAPSHOT_ROUNDING_PX } from "../../core/enums.ts";
import { declined, isNotRendered, layoutOutOfScope, makeFinding, renderedBox, sourceOf, targetEvaluation } from "../shared.ts";
import { blocksFor, unavailable } from "./shared.ts";
const ID = "figure/caption-separated";
export const captionSeparated = defineRule({
  id: ID, severity: "warn", proofSource: null, calibrated: false, experimental: false,
  unit: "pages", defaultOptions: { maxPageDistance: 0 },
  optionBounds: { maxPageDistance: { integer: true, maximum: Number.MAX_SAFE_INTEGER } },
  summary: "A standard figure's single measured image body and its caption have a page distance above the configured allowance.",
  declines: ["env/figure-index-unavailable", "env/figure-body-unsupported", "env/multicolumn", "env/vertical-writing"],
  remediation: { advice: "Inspect the figure and caption on the named pages. For a single image with a short caption, try 'break-inside: avoid' on the figure, remove an unintended forced break on its caption, or reduce the image size. A deliberate separated caption can be acceptable; the rule does not prove the pagination cause or that a keep will fit.", tested: false },
}, (snapshot, ctx) => {
  const index = snapshot.figureIndex;
  if (!index?.complete) return unavailable(ID);
  const findings = []; const notMeasured = []; const evaluations = [];
  let candidates = 0; let measured = 0;
  for (const figure of index.figures) for (const captionSid of figure.captionSids) {
    candidates += 1;
    const captions = blocksFor(snapshot, captionSid).filter(block => !isNotRendered(snapshot, block));
    const caption = captions[0]; const body = figure.bodyFragments[0];
    const box = caption ? renderedBox(snapshot, caption) : null;
    const page = body ? snapshot.pages.find(p => p.pageNumber === body.page) : null;
    const inside = body && page && body.box.x >= page.contentBox.x - SNAPSHOT_ROUNDING_PX
      && body.box.y >= page.contentBox.y - SNAPSHOT_ROUNDING_PX
      && body.box.x + body.box.width <= page.contentBox.x + page.contentBox.width + SNAPSHOT_ROUNDING_PX
      && body.box.y + body.box.height <= page.contentBox.y + page.contentBox.height + SNAPSHOT_ROUNDING_PX;
    const unsupported = figure.captionSids.length !== 1 || !figure.body || figure.bodyFragments.length !== 1
      || !body || body.identity !== figure.body.identity || !body.visible || body.box.width <= 0 || body.box.height <= 0
      || !inside || captions.length !== 1 || !caption || !box;
    const flowReason = [caption, ...blocksFor(snapshot, figure.sid)].filter(block => block !== undefined)
      .map(block => layoutOutOfScope(block.effectiveStyle)).find(reason => reason !== null);
    const reason = flowReason || (unsupported ? "env/figure-body-unsupported" as const : null);
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
    if (violated) findings.push(makeFinding({ ctx, ruleId: ID, severity: "warn", message: `Figure body is on page ${body!.page}; its caption is on page ${caption!.page}. Review the separated caption; the cause and author intent are unknown.`,
      page: caption!.page, keyType: "block", key: blockKey(caption!), nodeKey: caption!.nodeKey, sid: captionSid,
      fragmentIndex: caption!.fragmentIndex, boxScreen: box, source: sourceOf(snapshot, captionSid), value: distance, threshold, unit: "pages" }));
  }
  return { findings, candidates, measured, notMeasured, evaluations };
});

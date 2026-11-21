import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { SNAPSHOT_ROUNDING_PX } from "../../core/enums.ts";
import type { FigureBodyCandidate, FigureBodyFragment, Snapshot } from "../../core/types.ts";
import { declined, isNotRendered, layoutOutOfScope, makeFinding, renderedBox, sourceOf, targetEvaluation } from "../shared.ts";
import { blocksFor, unavailable } from "./shared.ts";
import { sourceTableMatches, measuredTableBodyFragments } from "../../source/table-index.ts";
const ID = "figure/caption-separated";

function resolveFigureBody(
  snapshot: Snapshot,
  figure: NonNullable<Snapshot["figureIndex"]>["figures"][number],
): {
  body: FigureBodyCandidate | null;
  table: NonNullable<Snapshot["tableIndex"]>["tables"][number] | null;
  fragments: FigureBodyFragment[];
} {
  if (figure.body !== null) {
    const isTable = figure.body.tag === "table";
    const table = isTable && snapshot.tableIndex?.complete
      ? snapshot.tableIndex.tables.find(item => item.sid === figure.body?.tableSid) ?? null
      : null;
    const fragments = (isTable && table
      ? measuredTableBodyFragments(table, figure.body.identity)
      : [...figure.bodyFragments]).sort((a, b) => a.page - b.page);
    return { body: figure.body, table, fragments };
  }
  const candidates = figure.bodyCandidates;
  if (!candidates || candidates.length < 2) {
    return { body: null, table: null, fragments: [] };
  }
  const imgSvgCandidates = candidates.filter(candidate => candidate.tag !== "table");
  const tableCandidates = candidates.filter(candidate => candidate.tag === "table");
  const authoredImgSvgCount = new Map<string, number>();
  for (const candidate of imgSvgCandidates) {
    authoredImgSvgCount.set(candidate.identity, (authoredImgSvgCount.get(candidate.identity) ?? 0) + 1);
  }
  const renderedImgSvg: FigureBodyFragment[] = [];
  const nonRenderedById = new Map<string, number>();
  for (const fragment of figure.bodyFragments) {
    if (!authoredImgSvgCount.has(fragment.identity)) return { body: null, table: null, fragments: [] };
    if (fragment.nonRendered === true) {
      if (fragment.visible) return { body: null, table: null, fragments: [] };
      nonRenderedById.set(fragment.identity, (nonRenderedById.get(fragment.identity) ?? 0) + 1);
      continue;
    }
    if (!fragment.visible) return { body: null, table: null, fragments: [] };
    renderedImgSvg.push(fragment);
  }
  const renderedTables: {
    candidate: FigureBodyCandidate;
    table: NonNullable<Snapshot["tableIndex"]>["tables"][number];
  }[] = [];
  if (tableCandidates.length > 0) {
    if (!snapshot.tableIndex?.complete) return { body: null, table: null, fragments: [] };
    for (const candidate of tableCandidates) {
      const table = snapshot.tableIndex.tables.find(item => item.sid === candidate.tableSid);
      if (!table || table.fragments.length === 0) return { body: null, table: null, fragments: [] };
      if (table.fragments.some(fragment => fragment.nonRendered === true && fragment.visible)) {
        return { body: null, table: null, fragments: [] };
      }
      const allNonRendered = table.fragments.every(fragment => fragment.nonRendered === true && !fragment.visible);
      if (!allNonRendered) {
        if (table.fragments.some(fragment => fragment.nonRendered === true)) {
          return { body: null, table: null, fragments: [] };
        }
        renderedTables.push({ candidate, table });
      }
    }
  }
  if (renderedImgSvg.length + renderedTables.length !== 1) {
    return { body: null, table: null, fragments: [] };
  }
  if (renderedImgSvg.length === 1) {
    const activeFragment = renderedImgSvg[0]!;
    for (const [identity, authoredCount] of authoredImgSvgCount) {
      const neededNonRendered = authoredCount - (identity === activeFragment.identity ? 1 : 0);
      if ((nonRenderedById.get(identity) ?? 0) !== neededNonRendered) {
        return { body: null, table: null, fragments: [] };
      }
    }
    const activeCandidate = imgSvgCandidates.find(candidate => candidate.identity === activeFragment.identity) ?? null;
    if (!activeCandidate) return { body: null, table: null, fragments: [] };
    return { body: activeCandidate, table: null, fragments: [activeFragment] };
  }
  for (const [identity, authoredCount] of authoredImgSvgCount) {
    if ((nonRenderedById.get(identity) ?? 0) !== authoredCount) {
      return { body: null, table: null, fragments: [] };
    }
  }
  const active = renderedTables[0]!;
  const fragments = measuredTableBodyFragments(active.table, active.candidate.identity).sort((a, b) => a.page - b.page);
  return { body: active.candidate, table: active.table, fragments };
}

export const captionSeparated = defineRule({
  id: ID, severity: "warn", proofSource: null, calibrated: false, experimental: false,
  unit: "pages", defaultOptions: { maxPageDistance: 0 },
  optionBounds: { maxPageDistance: { integer: true, maximum: Number.MAX_SAFE_INTEGER } },
  summary: "A standard figure's measured image or source-matched table body and its caption exceed the page-distance allowance.",
  declines: ["env/figure-index-unavailable", "env/figure-body-unsupported", "env/multicolumn", "env/vertical-writing"],
  remediation: { advice: "Inspect the measured body boundary and caption on the named pages. For a short image or table with a short caption, try 'break-inside: avoid' on the figure or remove an unintended forced break on its caption. For a multi-page table, keep only the caption with the nearest body rows rather than keeping the entire table. These are untested suggestions: deliberate separation can be acceptable, and the rule does not prove the pagination cause or that a keep will fit.", tested: false },
}, (snapshot, ctx) => {
  const index = snapshot.figureIndex;
  if (!index?.complete) return unavailable(ID, snapshot.figureIndexDecline);
  const findings = []; const notMeasured = []; const evaluations = [];
  let candidates = 0; let measured = 0;
  for (const figure of index.figures) for (const captionSid of figure.captionSids) {
    candidates += 1;
    const captions = blocksFor(snapshot, captionSid).filter(block => !isNotRendered(snapshot, block));
    const caption = captions[0];
    const resolved = resolveFigureBody(snapshot, figure);
    const activeBody = resolved.body;
    const isTable = activeBody?.tag === "table";
    const table = resolved.table;
    const bodies = resolved.fragments;
    const body = isTable && figure.captionPosition === "after" ? bodies.at(-1) : bodies[0];
    const box = caption ? renderedBox(snapshot, caption) : null;
    const inside = bodies.length > 0 && bodies.every(body => {
      const page = snapshot.pages.find(p => p.pageNumber === body.page);
      return page && body.visible && body.nonRendered !== true && body.box.width > 0 && body.box.height > 0 && body.identity === activeBody?.identity
        && body.box.x >= page.contentBox.x - SNAPSHOT_ROUNDING_PX && body.box.y >= page.contentBox.y - SNAPSHOT_ROUNDING_PX
        && body.box.x + body.box.width <= page.contentBox.x + page.contentBox.width + SNAPSHOT_ROUNDING_PX
        && body.box.y + body.box.height <= page.contentBox.y + page.contentBox.height + SNAPSHOT_ROUNDING_PX;
    });
    const tableUnsupported = isTable && (!table || !sourceTableMatches(table)
      || !["before", "after"].includes(figure.captionPosition ?? "")
      || table.fragments.some(fragment => fragment.nonRendered === true)
      || new Set(bodies.map(body => body.page)).size !== bodies.length
      || table.fragments.some(fragment => fragment.visible && !bodies.some(body => body.page === fragment.page)));
    const unsupported = figure.captionSids.length !== 1 || !activeBody || (!isTable && bodies.length !== 1)
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

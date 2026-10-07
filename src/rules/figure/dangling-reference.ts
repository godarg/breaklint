import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import { declined, isNotRendered, makeFinding, renderedBox, sourceOf, targetEvaluation } from "../shared.ts";
import { blocksFor, unavailable } from "./shared.ts";
const ID = "figure/dangling-reference";
export const danglingReference = defineRule({
  id: ID, severity: "warn", proofSource: null, calibrated: false, experimental: false,
  unit: "references", defaultOptions: { maxMissingTargets: 0 },
  optionBounds: { maxMissingTargets: { integer: true, maximum: Number.MAX_SAFE_INTEGER } },
  summary: "A source block contains a local figure or table link whose missing authored fragment targets exceed the configured allowance.",
  declines: ["env/figure-index-unavailable", "env/figure-reference-ambiguous"],
  remediation: { advice: "Check the missing fragment targets named in the finding. Correct the local href or add the intended unique authored ID or legacy a[name] anchor. IDs take precedence over named anchors. The location identifies the containing source block, not the exact inline link. This check does not validate printed numbers, external references, or the target's visibility.", tested: false },
}, (snapshot, ctx) => {
  const index = snapshot.figureIndex;
  if (!index?.complete) return unavailable(ID);
  const findings = []; const notMeasured = []; const evaluations = [];
  let candidates = 0; let measured = 0;
  for (const group of index.referenceBlocks) {
    const blocks = blocksFor(snapshot, group.sid); const block = blocks.find(b => !isNotRendered(snapshot, b));
    const target = { ruleId: ID, keyType: "block" as const, nodeKey: block?.nodeKey ?? `references:${group.sid}`, sid: group.sid, fragmentIndex: block?.fragmentIndex ?? 0, boxScreen: block ? renderedBox(snapshot, block) : null };
    if (blocks.length > 0 && !block) {
      evaluations.push(targetEvaluation({ ...target, status: "excluded", countsTowardCoverage: false, reason: "rule/target-not-visible" })); continue;
    }
    candidates += 1;
    const count = (id: string) => Object.hasOwn(index.ids, id) ? index.ids[id]!
      : index.namedAnchors && Object.hasOwn(index.namedAnchors, id) ? index.namedAnchors[id]! : 0;
    // Snapshot 6 knows IDs only. Absence there cannot prove a legacy named target is missing.
    const ambiguous = !block || group.references.some(ref => ref.targetId === null || count(ref.targetId) > 1
      || (count(ref.targetId) === 0 && index.namedAnchors === undefined));
    if (ambiguous) {
      const reason = "env/figure-reference-ambiguous" as const;
      notMeasured.push(declined({ scope: "block", ruleId: ID, reason, target: { keyType: "block", nodeKey: target.nodeKey, sid: group.sid } }));
      evaluations.push(targetEvaluation({ ...target, status: "not-measured", reason })); continue;
    }
    measured += 1;
    const missing = [...new Set(group.references.filter(ref => count(ref.targetId!) === 0).map(ref => ref.targetId!))].sort();
    const threshold = Number(ctx.options.maxMissingTargets ?? 0); const violated = missing.length > threshold;
    evaluations.push(targetEvaluation({ ...target, status: "measured", violated, measurements: [
      { name: "local-figure-links", value: group.references.length, unit: "references", operator: null, threshold: null },
      { name: "missing-unique-targets", value: missing.length, unit: "references", operator: ">", threshold },
    ] }));
    if (violated) findings.push(makeFinding({ ctx, ruleId: ID, severity: "warn", message: `Local figure/table link target${missing.length === 1 ? " is" : "s are"} absent from the authored ID and a[name] inventory: ${missing.map(id => JSON.stringify(id)).join(", ")}. Location and page identify the containing block; printed numbers and author intent are not checked.`,
      page: block!.page, keyType: "block", key: blockKey(block!), nodeKey: block!.nodeKey, sid: group.sid,
      fragmentIndex: block!.fragmentIndex, boxScreen: target.boxScreen, source: sourceOf(snapshot, group.sid), value: missing.length, threshold, unit: "references" }));
  }
  return { findings, candidates, measured, notMeasured, evaluations };
});

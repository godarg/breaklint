import type { Snapshot, BlockRecord } from "../../core/types.ts";
import { declined, targetEvaluation } from "../shared.ts";
export function unavailable(ruleId: string) {
  const reason = "env/figure-index-unavailable" as const;
  return { findings: [], candidates: 1, measured: 0,
    notMeasured: [declined({ scope: "document", ruleId, reason })],
    evaluations: [targetEvaluation({ ruleId, keyType: "generated", nodeKey: "figure-inventory", sid: null,
      status: "not-measured", reason, occurrenceKey: "unaddressable-rest:figure-inventory" })] };
}
export function blocksFor(snapshot: Snapshot, sid: string): BlockRecord[] {
  return snapshot.blocks.filter(block => block.sid === sid);
}

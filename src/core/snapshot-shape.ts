import { FLOW_HAZARDS } from "./enums.ts";
import type { Snapshot } from "./types.ts";

/**
 * The Snapshot 5 block fields every rule may rely on, checked in ONE place for both readers: the
 * live path (`validateSnapshotInvariants`, after measuring) and the engine (for any snapshot it is
 * handed, including a stored one). A stamp alone proves nothing about a hand-edited or truncated
 * file, and a rule that reads an absent list as empty misjudges instead of failing:
 * `layout/unbreakable-block-too-tall` would take a missing `atomicBoxes` as "no replaced content"
 * and a missing `flowHazards` as "one flow". Each issue names the record.
 */
export function snapshotShapeIssues(snapshot: Pick<Snapshot, "blocks">): string[] {
  const issues: string[] = [];
  if (!Array.isArray(snapshot.blocks)) return ["blocks absent"];
  for (const block of snapshot.blocks) {
    const key = block?.nodeKey ?? "?";
    // A block without its computed display, or with a margin-copy count that is not a count,
    // cannot be classified by the rules that ask whether it has a box of its own.
    if (typeof block.display !== "string" || block.display.length === 0) issues.push(`${key}: computed display is absent`);
    if (!Number.isSafeInteger(block.marginCopies) || block.marginCopies < 0) issues.push(`${key}: marginCopies is not a count`);
    else if (block.marginCopies > 0 && block.sid === null) issues.push(`${key}: margin copies without a source id`);
    if (!Array.isArray(block.atomicBoxes) || block.atomicBoxes.some((atom) =>
      !atom || typeof atom.tag !== "string" || !atom.box || ![atom.box.x, atom.box.y, atom.box.width, atom.box.height].every(Number.isFinite))) {
      issues.push(`${key}: atomicBoxes absent or not finite`);
    }
    const hazards = block.flowHazards as Partial<Record<"inside" | "self" | "around", unknown>> | undefined;
    for (const scope of ["inside", "self", "around"] as const) {
      const list = hazards?.[scope];
      if (!Array.isArray(list) || list.some((hazard) => !(FLOW_HAZARDS as readonly string[]).includes(hazard)) ||
        new Set(list).size !== list.length) {
        issues.push(`${key}: flowHazards.${scope} absent, unknown or repeated`);
      }
    }
  }
  return issues;
}

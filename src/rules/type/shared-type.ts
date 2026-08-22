import type { Snapshot, TextRun } from "../../core/types.ts";

/**
 * What the language rules never look at.
 *
 * The exclusion is part of the measurement, not a filter applied afterwards. That distinction
 * matters for the coverage account: a run excluded here was never a candidate, so it does not
 * silently deflate the coverage ratio of a rule that in fact looked at everything it should.
 */
const STRUCTURAL_EXCLUSIONS = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  "math",
  "mrow",
  "mi",
  "mn",
  "mo",
  "annotation",
  "semantics",
]);

export function isExcludedRun(run: TextRun, locale: string, extraTags: readonly string[]): boolean {
  if (run.excluded) return true;
  if (run.ancestorTags.some((t) => STRUCTURAL_EXCLUSIONS.has(t.toLowerCase()))) return true;
  // A nested foreign-language span inside a German paragraph is not German. The `lang`
  // exclusion works on the ancestor chain, which is the only place it can work: the run
  // itself carries the innermost declaration.
  const language = (run.lang || locale).toLowerCase();
  if (!language.startsWith(locale.slice(0, 2).toLowerCase())) return true;
  if (extraTags.length > 0 && run.ancestorTags.some((t) => extraTags.includes(t.toLowerCase()))) return true;
  return false;
}

export function runsOf(snapshot: Snapshot): TextRun[] {
  return snapshot.textRuns;
}

export function pageOfBlock(snapshot: Snapshot, blockKey: string): number {
  return snapshot.blocks.find((b) => b.nodeKey === blockKey)?.page ?? 1;
}

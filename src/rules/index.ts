/**
 * The registry. One place that knows every rule, so that "which rules exist" is a fact of the
 * code rather than something a reader has to assemble from a directory listing.
 *
 * Two invariants are enforced here rather than left to review, because both have gone wrong in
 * comparable projects and neither is visible in a diff:
 *
 *   - No duplicate ids. A second registration of the same id would silently shadow the first,
 *     and a finding would then be attributed to a rule that never ran.
 *   - Exactly two rules carry `error`. Not because two is a nice number, but because exactly
 *     two rules compare directly measured quantities against a structural boundary. If a third
 *     appears without a proof source, `defineRule` rejects it; if a third appears *with* one,
 *     this count fails and forces the change to be argued rather than merged.
 */

import type { Rule } from "../core/rule.ts";
import { RULE_NAMESPACES } from "../core/enums.ts";

import { widow } from "./layout/widow.ts";
import { orphan } from "./layout/orphan.ts";
import { unbreakableBlockTooTall } from "./layout/unbreakable-block-too-tall.ts";
import { headingAtPageBottom } from "./layout/heading-at-page-bottom.ts";
import { halfEmptyPage } from "./layout/half-empty-page.ts";
import { orphanedContinuationPage } from "./layout/orphaned-continuation-page.ts";
import { hyphenAcrossPage } from "./layout/hyphen-across-page.ts";
import { textOverflowsViewport } from "./svg/text-overflows-viewport.ts";
import { textClipped } from "./svg/text-clipped.ts";
import { textInkCollision } from "./svg/text-ink-collision.ts";
import { spacedHyphen } from "./type/spaced-hyphen.ts";
import { straightQuotes } from "./type/straight-quotes.ts";
import { shortLastLine } from "./type/short-last-line.ts";
import { excessiveWordSpacing } from "./type/excessive-word-spacing.ts";
import { localUri } from "./artifact/local-uri.ts";

export const ALL_RULES: readonly Rule[] = Object.freeze([
  widow,
  orphan,
  unbreakableBlockTooTall,
  headingAtPageBottom,
  halfEmptyPage,
  orphanedContinuationPage,
  hyphenAcrossPage,
  textOverflowsViewport,
  textClipped,
  textInkCollision,
  spacedHyphen,
  straightQuotes,
  shortLastLine,
  excessiveWordSpacing,
  localUri,
]);

const seen = new Set<string>();
for (const rule of ALL_RULES) {
  if (seen.has(rule.id)) {
    throw new Error(`Duplicate rule id ${rule.id}: the second registration would shadow the first.`);
  }
  seen.add(rule.id);
  const namespace = rule.id.split("/")[0] ?? "";
  if (!(RULE_NAMESPACES as readonly string[]).includes(namespace)) {
    throw new Error(
      `${rule.id}: namespace "${namespace}" is not one of ${RULE_NAMESPACES.join(", ")}. ` +
        `env/ is deliberately absent — those are diagnoses, not rules.`,
    );
  }
}

const errorRules = ALL_RULES.filter((r) => r.severity === "error");
if (errorRules.length !== 2) {
  throw new Error(
    `${errorRules.length} rules carry severity "error"; two do so by construction ` +
      `(${errorRules.map((r) => r.id).join(", ")}). Changing this number is a decision about ` +
      `the burden of proof, not a refactoring — argue it in docs/limitations.md first.`,
  );
}

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(ALL_RULES.map((r) => [r.id, r]));

/** The ids, in registration order. Reporters print rules in this order for stable diffs. */
export const RULE_IDS: readonly string[] = ALL_RULES.map((r) => r.id);

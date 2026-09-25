/**
 * What a rule is, and what it is not.
 *
 * A rule is a pure function from a snapshot to findings plus a coverage account. It knows
 * nothing about browsers, Paged.js, the file system or the reporters. That constraint is not
 * tidiness: it is what makes the whole rule set testable without an environment, and it is
 * what lets a mutation guard construct a rule with a shifted threshold without a test hook in
 * the production code.
 *
 * Every rule also has to *account for itself*. Returning findings is not enough — a rule that
 * silently skipped four fifths of a document and found nothing looks exactly like a rule that
 * looked at everything and found nothing. The coverage account is the difference, and §6 of
 * the contract makes it the reason exit code 4 exists.
 */

import type { EnvId, ProofSource, Severity } from "./enums.ts";
import type { Finding, NotMeasured, Snapshot, TargetEvaluation } from "./types.ts";

/**
 * These two receipt-bound ink definitions are deliberately outside the production registry.
 * They retain their historic receipt projection until their collector exists. Every registered
 * P1 rule must emit target evaluations; this is the narrow, explicit exception.
 */
const RESEARCH_ONLY_EVALUATION_EXCEPTIONS = new Set([
  "svg/text-clipped",
  "svg/text-ink-collision",
]);



/** Values a rule may be configured with. Numbers only; JSON config, no executable code. */
export type RuleOptions = Readonly<Record<string, number | string | boolean | readonly string[]>>;

export interface RuleContext {
  readonly documentPath: string;
  readonly options: RuleOptions;
  /** Builds the stable fingerprint. Injected so a rule cannot invent its own keying. */
  readonly fingerprint: (input: {
    ruleId: string;
    keyType: Finding["target"]["keyType"];
    key: string;
  }) => string;
}

export interface RuleResult {
  findings: Finding[];
  /** How many objects the rule *should* have judged. */
  candidates: number;
  /** How many it actually did. `measured + sum(notMeasured.count)` must equal `candidates`. */
  measured: number;
  notMeasured: NotMeasured[];
  /** Target-level decisions emitted by the rule at its real decision points. */
  evaluations?: TargetEvaluation[];
}

export interface RuleMeta {
  readonly id: string;
  readonly severity: Severity;
  /** `null` means no named proof source — and therefore never `error`. */
  readonly proofSource: ProofSource | null;
  /** False for every v1 rule. The corpus of >= 30 judged real documents does not exist. */
  readonly calibrated: false;
  /** Experimental findings never move an exit code, not even with `--fail-on warn`. */
  readonly experimental: boolean;
  readonly unit: string;
  readonly defaultOptions: RuleOptions;
  /** One line, English, third person about the document. Used in `--help` and the rule table. */
  readonly summary: string;
  /** Reasons this rule can decline to measure. Checked against the registry test. */
  readonly declines: readonly EnvId[];
  /**
   * Actionable guidance on what in the source produces this and what concretely to change.
   *
   * `tested` is a claim about EVIDENCE, not about confidence: it is true only where a
   * trigger/remedied document pair in this repository shows the finding appearing, the advice
   * being applied verbatim, the finding going away, and no new finding arriving. A rule author
   * cannot set it from conviction — the previous shape let the engine stamp `tested: true` on
   * every remediation it copied, which is how an untested string reaches an agent as a tested one.
   *
   * `interactions` declares where this advice and another rule's pull on the same CSS lever, and
   * which of the two owns it. It stays in the registry: `Finding.remediation` carries `advice` and
   * `tested` only, so declaring a precedence changes no report shape.
   */
  readonly remediation?: {
    readonly advice: string;
    readonly tested: boolean;
    readonly interactions?: readonly RemediationInteraction[];
  };
}

/**
 * Two advice texts that pull one lever in opposite directions, with the order settled.
 *
 * Measured before this existed: `layout/hyphen-across-page` advised turning hyphenation off and
 * `type/excessive-word-spacing` advised turning it on, and each text said the two "pull in
 * opposite directions" — an agent that obeyed both oscillated. Saying so is not a precedence.
 * An interaction is declared on BOTH rules, `defers` on one and `prevails` on the other, and
 * `interactionProblems` refuses any other shape.
 */
export interface RemediationInteraction {
  /** The other rule. */
  readonly ruleId: string;
  /** What both advices touch: one of `INTERACTION_LEVERS`. */
  readonly lever: InteractionLever;
  /**
   * `prevails`: this rule owns the block-level setting of `lever` in `scope`. `defers`: the other
   * rule owns it there, and this rule's advice changes the lever only locally.
   */
  readonly relation: InteractionRelation;
  readonly scope: InteractionScope;
}

export const INTERACTION_RELATIONS = ["defers", "prevails"] as const;
export type InteractionRelation = (typeof INTERACTION_RELATIONS)[number];

/** Where a precedence holds, with the phrase the rule pages render for it. */
export const INTERACTION_SCOPES = Object.freeze({ justified: "in justified blocks" } as const);
export type InteractionScope = keyof typeof INTERACTION_SCOPES;

/**
 * The levers a precedence can be declared on. A lever is not always a CSS property: a soft hyphen
 * is markup, and it is the lever `type/excessive-word-spacing` proposes and the one that re-creates
 * a `layout/hyphen-across-page` finding. Each lever names the token both advice texts must contain
 * (a precedence about a lever an advice never mentions is not about that advice), the phrase the
 * rule pages render, and what the owning rule owns.
 */
export const INTERACTION_LEVERS = Object.freeze({
  "hyphens": { adviceToken: "hyphens", subject: "`hyphens`", owned: "the block-level setting" },
  "soft-hyphen": { adviceToken: "&shy;", subject: "Soft hyphens (`&shy;`)", owned: "where they are inserted" },
} as const);
export type InteractionLever = keyof typeof INTERACTION_LEVERS;

const OPPOSITE_RELATION: Readonly<Record<InteractionRelation, InteractionRelation>> = {
  defers: "prevails",
  prevails: "defers",
};

/** Shape errors one rule's declaration has on its own; the registry-wide pairing is below. */
function ownInteractionProblems(meta: Pick<RuleMeta, "id" | "remediation">): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const interaction of meta.remediation?.interactions ?? []) {
    const label = `${meta.id} → ${interaction.ruleId} on ${interaction.lever} (${interaction.scope})`;
    if (interaction.ruleId === meta.id) problems.push(`${label}: a rule cannot take precedence over itself`);
    if (!(INTERACTION_RELATIONS as readonly string[]).includes(interaction.relation)) {
      problems.push(`${label}: relation "${interaction.relation}" is not one of ${INTERACTION_RELATIONS.join(", ")}`);
    }
    if (!Object.hasOwn(INTERACTION_SCOPES, interaction.scope)) {
      problems.push(`${label}: scope "${interaction.scope}" is not one of ${Object.keys(INTERACTION_SCOPES).join(", ")}`);
    }
    if (!Object.hasOwn(INTERACTION_LEVERS, interaction.lever)) {
      problems.push(`${label}: lever "${interaction.lever}" is not one of ${Object.keys(INTERACTION_LEVERS).join(", ")}`);
    } else if (!meta.remediation?.advice.includes(INTERACTION_LEVERS[interaction.lever].adviceToken)) {
      problems.push(`${label}: the advice never mentions ${INTERACTION_LEVERS[interaction.lever].adviceToken}`);
    }
    const key = `${interaction.ruleId}\u0000${interaction.lever}\u0000${interaction.scope}`;
    if (seen.has(key)) problems.push(`${label}: declared twice`);
    seen.add(key);
    // The advice is what a consumer reads. A precedence the advice does not mention is one an
    // agent never learns about, so the partner must be named in the text itself.
    if (!meta.remediation?.advice.includes(`'${interaction.ruleId}'`)) {
      problems.push(`${label}: the advice does not name '${interaction.ruleId}'`);
    }
  }
  return problems;
}

/**
 * Every precedence problem across a rule set: an unknown partner, a pair declared on one side
 * only, a pair whose two sides do not oppose each other, and an advice that does not name its
 * partner. Empty means every interaction is declared on both rules, `defers` against `prevails`,
 * for the same lever and scope.
 */
export function interactionProblems(rules: readonly Pick<RuleMeta, "id" | "remediation">[]): string[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const problems: string[] = [];
  for (const rule of rules) {
    problems.push(...ownInteractionProblems(rule));
    for (const interaction of rule.remediation?.interactions ?? []) {
      const label = `${rule.id} ${interaction.relation} ${interaction.relation === "defers" ? "to" : "over"} ` +
        `${interaction.ruleId} on ${interaction.lever} (${interaction.scope})`;
      const partner = byId.get(interaction.ruleId);
      if (!partner) {
        problems.push(`${label}: ${interaction.ruleId} is not a registered rule`);
        continue;
      }
      const opposite = OPPOSITE_RELATION[interaction.relation];
      const mirror = (partner.remediation?.interactions ?? []).filter(
        (other) => other.ruleId === rule.id && other.lever === interaction.lever && other.scope === interaction.scope,
      );
      if (mirror.length === 0) {
        problems.push(`${label}: ${partner.id} declares no ${opposite} in return`);
      } else if (mirror.some((other) => other.relation !== opposite)) {
        problems.push(
          `${label}: ${partner.id} declares ${mirror.map((other) => other.relation).join(", ")} in return, not ${opposite}`,
        );
      }
    }
  }
  return problems;
}

export interface Rule extends RuleMeta {
  run(snapshot: Snapshot, ctx: RuleContext): RuleResult;
}

/**
 * Builds a rule and, in doing so, enforces the two constraints that cannot be left to
 * discipline: the coverage invariant, and the ban on `error` without a proof source.
 *
 * The invariant is checked *here*, on every run, rather than in a test. A test proves it for
 * the cases the test thought of; this proves it for every case that ever runs. A rule that
 * violates it throws, and a throwing rule becomes `checker-crashed` and exit 3 — which is
 * correct, because a rule that cannot account for itself has not measured anything.
 */
export function defineRule(meta: RuleMeta, run: Rule["run"]): Rule {
  if (meta.severity === "error" && meta.proofSource === null) {
    throw new Error(
      `${meta.id}: severity "error" requires a named proof source. An uncalibrated threshold ` +
        `is at most a warning — see docs/limitations.md.`,
    );
  }
  if (meta.severity !== "error" && meta.proofSource !== null) {
    throw new Error(
      `${meta.id}: carries proof source ${meta.proofSource} but is not an error. Either the ` +
        `proof holds and the rule is an error, or it does not and the claim goes.`,
    );
  }
  // One rule's declaration can be checked here; whether its partner answers it needs the whole
  // registry, and tests/unit/registry.test.ts runs `interactionProblems` over ALL_RULES for that.
  const interactionErrors = ownInteractionProblems(meta);
  if (interactionErrors.length > 0) {
    throw new Error(`${meta.id}: invalid remediation.interactions — ${interactionErrors.join("; ")}`);
  }
  return {
    ...meta,
    run(snapshot, ctx) {
      const result = run(snapshot, ctx);
      const accounted = result.measured + result.notMeasured.reduce((sum, n) => sum + n.count, 0);
      if (accounted !== result.candidates) {
        throw new Error(
          `${meta.id}: coverage does not add up — ${result.measured} measured plus ` +
            `${accounted - result.measured} declined is ${accounted}, but ${result.candidates} ` +
            `candidates were counted. A rule that cannot account for what it skipped cannot ` +
            `claim what it found.`,
        );
      }
      for (const n of result.notMeasured) {
        if (n.count < 1) throw new Error(`${meta.id}: notMeasured entry with count ${n.count}`);
        if (!meta.declines.includes(n.reason)) {
          throw new Error(
            `${meta.id}: declined with "${n.reason}", which is not in its declared reasons ` +
              `[${meta.declines.join(", ")}]. An undeclared reason is a reason nobody reviewed.`,
          );
        }
      }
      for (const f of result.findings) {
        if (f.severity !== meta.severity) {
          throw new Error(`${meta.id}: emitted severity ${f.severity}, declared ${meta.severity}`);
        }
        if (f.experimental !== meta.experimental) {
          throw new Error(`${meta.id}: emitted experimental=${f.experimental}, declared ${meta.experimental}`);
        }
      }
      if (result.evaluations === undefined) {
        if (RESEARCH_ONLY_EVALUATION_EXCEPTIONS.has(meta.id)) return result;
        // Every other rule is a released or downstream consumer contract. Missing decisions
        // mean the rule cannot prove what it judged, so make its engine path checker-crashed.
        throw new Error(`${meta.id}: rule returned no target evaluations`);
      }
      const evaluations = result.evaluations;
      const addressedEvaluations = new Set<string>();
      for (const row of evaluations) {
        if (row.ruleId !== meta.id) {
          throw new Error(`${meta.id}: evaluation belongs to ${row.ruleId}`);
        }
        if ((row.status === "not-measured" || row.status === "not-applicable") && row.reason === null) {
          throw new Error(`${meta.id}: ${row.status} evaluation has no decline reason`);
        }
        if (row.targetCount !== undefined && (!Number.isSafeInteger(row.targetCount) || row.targetCount < 1)) {
          throw new Error(`${meta.id}: evaluation targetCount must be a positive safe integer`);
        }
        if (row.targetCount !== undefined && row.targetCount > 1) {
          const unknownAggregate = row.targetRef.sid === null &&
            row.occurrenceKey?.startsWith("unaddressable-rest:") === true &&
            row.reason !== null && row.predicate.violated === null &&
            row.status !== "measured";
          if (!unknownAggregate) {
            throw new Error(`${meta.id}: targetCount > 1 is only allowed for an unknown aggregate decline`);
          }
        }
        // `nodeKey` is the actual collector target. A repeated text run/URI can share it only
        // when the rule supplies its observed occurrence discriminator; rows may never crowd out
        // another concrete target merely by preserving the same counts.
        if (row.targetRef.nodeKey) {
          const address = [
            row.targetRef.keyType,
            row.targetRef.sid ?? row.targetRef.nodeKey,
            row.targetRef.fragmentIndex,
            row.occurrenceKey ?? "",
          ].join("\u0000");
          if (addressedEvaluations.has(address)) {
            throw new Error(`${meta.id}: duplicate target evaluation ${address}`);
          }
          addressedEvaluations.add(address);
        }
      }
      const targetCount = (row: TargetEvaluation) => row.targetCount ?? 1;
      const evaluationCount = evaluations
        .filter((row) => row.status !== "excluded" && row.countsTowardCoverage !== false)
        .reduce((sum, row) => sum + targetCount(row), 0);
      if (evaluationCount !== result.candidates) {
        throw new Error(`${meta.id}: ${evaluationCount} target evaluations for ${result.candidates} candidates`);
      }
      const measuredEvaluations = evaluations
        .filter((row) => row.status === "measured" && row.countsTowardCoverage !== false)
        .reduce((sum, row) => sum + targetCount(row), 0);
      if (measuredEvaluations !== result.measured) {
        throw new Error(`${meta.id}: ${measuredEvaluations} measured evaluations for ${result.measured} measured candidates`);
      }
      const countByReason = (rows: readonly { reason: string | null }[]) => {
        const counts = new Map<string, number>();
        for (const row of rows) {
          if (row.reason === null) continue;
          counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
        }
        return counts;
      };
      const expectedDeclines = countByReason(
        result.notMeasured.flatMap((row) => Array.from({ length: row.count }, () => ({ reason: row.reason }))),
      );
      const actualDeclines = countByReason(
        evaluations.flatMap((row) =>
          (row.status === "not-measured" || row.status === "not-applicable") && row.countsTowardCoverage !== false
            ? Array.from({ length: targetCount(row) }, () => ({ reason: row.reason }))
            : [],
        ),
      );
      if (
        expectedDeclines.size !== actualDeclines.size ||
        [...expectedDeclines].some(([reason, count]) => actualDeclines.get(reason) !== count)
      ) {
        throw new Error(`${meta.id}: target decline evaluations do not reconcile to declared reasons/counts`);
      }
      return result;
    },
  };
}

/** Aggregates `notMeasured` rows so a long document produces counts, not tens of thousands of rows. */
export function aggregateNotMeasured(rows: NotMeasured[]): NotMeasured[] {
  const byKey = new Map<string, NotMeasured>();
  for (const row of rows) {
    const key = `${row.scope}\u0000${row.ruleId ?? ""}\u0000${row.reason}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += row.count;
      // Once aggregated the row no longer points at one object, and saying which one it was
      // would be a guess. The contract requires `target: null` past count 1.
      existing.target = null;
    } else {
      byKey.set(key, { ...row });
    }
  }
  return [...byKey.values()];
}

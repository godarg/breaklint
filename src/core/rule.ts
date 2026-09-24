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



/**
 * What a rule's measured quantity is a property of.
 *
 * The snapshot is per fragment: a block the paginator split is several records, one per page. A
 * rule that decides per record is right for a quantity that belongs to a piece — the lines a
 * fragment strands at a page boundary — and silently wrong for one that belongs to the whole
 * element. That is how `layout/unbreakable-block-too-tall` came back clean on a block five and a
 * half pages tall (0.6.0), and nothing in the type of a rule said which kind it was.
 *
 *   - `element`: a property of the whole source element, however the paginator split it (its
 *     height). The answer must not depend on the split; tests/unit/fragment-contract.test.ts and
 *     the `first-fragment-only` mutant hold every such rule to that.
 *   - `fragment`: a property of one fragment as the paginator placed it on one page — its lines at
 *     a boundary, its position on the page, the lines it carries.
 *   - `page`, `text-run`, `svg-target`, `resource`: a page, a run of source text, one SVG text
 *     target, one URI reference.
 *
 * Internal. It is not emitted in any report or schema: it describes how a rule is tested, not
 * what a finding means.
 */
export const QUANTITY_SCOPES = ["element", "fragment", "page", "text-run", "svg-target", "resource"] as const;
export type QuantityScope = (typeof QUANTITY_SCOPES)[number];

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
  /**
   * What the measured quantity belongs to (see QUANTITY_SCOPES). Required, so a rule that does
   * not say whether a split changes its answer does not compile.
   */
  readonly quantityScope: QuantityScope;
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
   */
  readonly remediation?: { readonly advice: string; readonly tested: boolean };
}

export interface Rule extends RuleMeta {
  run(snapshot: Snapshot, ctx: RuleContext): RuleResult;
}

/**
 * Builds a rule and, in doing so, enforces the constraints that cannot be left to discipline: the
 * coverage invariant, the ban on `error` without a proof source, and a declared quantity scope.
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
  // The type already requires it; this is for the caller the type cannot see (a spread, a cast,
  // a rule assembled at run time). An unknown scope would escape the fragment contract silently.
  if (!(QUANTITY_SCOPES as readonly string[]).includes(meta.quantityScope)) {
    throw new Error(
      `${meta.id}: quantityScope ${JSON.stringify(meta.quantityScope)} is not one of ` +
        `${QUANTITY_SCOPES.join(", ")}. A rule has to say what its quantity belongs to, or nothing ` +
        `can check whether a split changes its answer.`,
    );
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

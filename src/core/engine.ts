/**
 * The engine: rules over a snapshot, coverage, verdict.
 *
 * Two decisions live here and both are the reason this tool has a fourth exit code.
 *
 * A rule that could not look at a document is not the same as a rule that looked and found
 * nothing, and before coverage accounting the two were indistinguishable from outside. Measured
 * on a multi-column document with the widow rule active: 6 pages analysed, 1 rule run,
 * 5 candidates, 0 measured, 0 findings — and exit 0. The single-column control produced 5
 * measured, coverage 1.0, and also exit 0. Both runs looked identical to a build script.
 *
 * The other decision is that `failOn` does not touch coverage. `--fail-on never` says "report,
 * do not gate on findings". It does not say "hide that nothing was measured". A tool that
 * stays quiet about its own blindness in reporting mode is the green blind run again, one
 * level up.
 */

import { COVERAGE_FLOOR_BY_SEVERITY, EXIT_CODE_BY_VERDICT, IS, VERDICT_PRECEDENCE } from "./enums.ts";
import type { FailOn, RunVerdict, Severity } from "./enums.ts";

/** Whether this event alone makes the run exit 3. See `NON_FATAL_INFRA_EVENT_KINDS`. */
const isFatalInfra = (event: InfraEvent): boolean => !IS.nonFatalInfraEventKind.has(event.kind);
import { fingerprint } from "./fingerprint.ts";
import type { Rule, RuleOptions } from "./rule.ts";
import { aggregateNotMeasured } from "./rule.ts";
import type {
  DocumentReport,
  Finding,
  InfraEvent,
  NotMeasured,
  RuleCoverage,
  Snapshot,
} from "./types.ts";

export interface DocumentInput {
  path: string;
  snapshot: Snapshot | null;
  /** Infrastructure events collected before or during measurement. Fail-closed: never dropped. */
  infrastructure: InfraEvent[];
}

export interface EngineConfig {
  failOn: FailOn;
  activeRules: readonly Rule[];
  optionsByRule: Readonly<Record<string, RuleOptions>>;
  loweredFloors: Readonly<Record<string, number>>;
}

export interface DocumentOutcome {
  report: DocumentReport;
  /** Rules that produced at least one measured candidate. Feeds `measuredRules`. */
  measuredRuleIds: string[];
}

export function runDocument(input: DocumentInput, config: EngineConfig): DocumentOutcome {
  const findings: Finding[] = [];
  const coverage: Record<string, RuleCoverage> = {};
  const documentNotMeasured: NotMeasured[] = [];
  const infrastructure: InfraEvent[] = [...input.infrastructure];
  const measuredRuleIds: string[] = [];

  // No snapshot means nothing was measured. Which verdict that earns depends on *why*, and the
  // caller has already recorded the reason as an infrastructure event — an empty document is
  // exit 4, an aborted pagination is exit 3, and the two must not be collapsed.
  if (!input.snapshot) {
    return {
      report: {
        path: input.path,
        inputIdentity: null,
        verdict: infrastructure.some((e) => isFatalInfra(e)) ? "infrastructure" : "insufficient-coverage",
        exitReason: infrastructure[0]?.kind ?? "empty-input",
        pages: 0,
        coverage: {},
        findings: [],
        notMeasured: [],
        infrastructure,
        evidence: [],
      },
      measuredRuleIds: [],
    };
  }

  const snapshot = input.snapshot;

  for (const rule of config.activeRules) {
    let result;
    try {
      result = rule.run(snapshot, {
        documentPath: input.path,
        options: config.optionsByRule[rule.id] ?? rule.defaultOptions,
        fingerprint,
      });
    } catch (error) {
      // A crashed checker may have swallowed findings, so the document cannot be called clean.
      // This is exit 3, not "0 findings" — the difference is the whole point.
      infrastructure.push({
        kind: "checker-crashed",
        detail: `${rule.id}: ${error instanceof Error ? error.message : String(error)}`,
        measured: { ruleId: rule.id },
      });
      continue;
    }

    const notMeasured = aggregateNotMeasured(result.notMeasured);
    const notMeasuredCount = notMeasured.reduce((sum, n) => sum + n.count, 0);
    const floor = config.loweredFloors[rule.id] ?? COVERAGE_FLOOR_BY_SEVERITY[rule.severity];
    const ratio = result.candidates === 0 ? null : result.measured / result.candidates;

    coverage[rule.id] = {
      candidates: result.candidates,
      measured: result.measured,
      notMeasured,
      notMeasuredCount,
      coverage: ratio,
      floor,
      // A rule with no candidates has nothing to be short of. Treating `null` as a failure
      // would flag every document that simply contains no SVG.
      ok: ratio === null ? true : ratio >= floor,
    };
    documentNotMeasured.push(...notMeasured);
    findings.push(...result.findings);
    if (result.measured > 0) measuredRuleIds.push(rule.id);
  }

  const verdict = documentVerdict({
    infrastructure,
    coverage,
    measuredRuleCount: measuredRuleIds.length,
    findings,
    failOn: config.failOn,
  });

  return {
    report: {
      path: input.path,
      inputIdentity: snapshot.meta.inputIdentity,
      verdict,
      exitReason: exitReasonFor(verdict, infrastructure, coverage, measuredRuleIds.length),
      pages: snapshot.pages.length,
      coverage,
      findings,
      notMeasured: aggregateNotMeasured(documentNotMeasured),
      infrastructure,
      evidence: [],
    },
    measuredRuleIds,
  };
}

function documentVerdict(input: {
  infrastructure: InfraEvent[];
  coverage: Record<string, RuleCoverage>;
  measuredRuleCount: number;
  findings: Finding[];
  failOn: FailOn;
}): RunVerdict {
  // Not every infrastructure event means exit 3. `NON_FATAL_INFRA_EVENT_KINDS` names the three
  // that do not, each for a reason the contract states; everything else does.
  // is a coverage question, not a broken renderer.
  if (input.infrastructure.some((e) => isFatalInfra(e))) return "infrastructure";
  if (input.measuredRuleCount === 0) return "insufficient-coverage";
  if (Object.values(input.coverage).some((c) => !c.ok)) return "insufficient-coverage";
  return gateTriggeredBy(input.findings, input.failOn) ? "findings" : "clean";
}

function exitReasonFor(
  verdict: RunVerdict,
  infrastructure: InfraEvent[],
  coverage: Record<string, RuleCoverage>,
  measuredRuleCount: number,
): string | null {
  if (verdict === "infrastructure") {
    return infrastructure.find((e) => isFatalInfra(e))?.kind ?? null;
  }
  if (verdict === "insufficient-coverage") {
    if (infrastructure.some((e) => e.kind === "empty-input")) return "empty-input";
    if (measuredRuleCount === 0) return "no rule measured a single candidate";
    const short = Object.entries(coverage).find(([, c]) => !c.ok);
    return short ? `${short[0]} below its coverage floor` : null;
  }
  return null;
}

/**
 * What the finding gate says. Returns the severity that tripped it, or null.
 *
 * Experimental findings never count. `layout/half-empty-page` sits 0.086 below the measured
 * ceiling of a full text page; breaking a build on that is a defect in the tool, not in the
 * document. `--fail-on warn` does not change this — it makes the *other* twelve heuristics
 * gate, deliberately and on request.
 */
export function gateTriggeredBy(findings: readonly Finding[], failOn: FailOn): "error" | "warn" | null {
  if (failOn === "never") return null;
  const counts = tally(findings);
  if (counts.error > 0) return "error";
  if (failOn === "warn" && counts.warn > 0) return "warn";
  return null;
}

/** What the gate *would* have said. Reported next to the verdict when something else decided. */
export function gateCandidate(findings: readonly Finding[]): "error" | "warn" | null {
  const counts = tally(findings);
  if (counts.error > 0) return "error";
  if (counts.warn > 0) return "warn";
  return null;
}

function tally(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    if (f.experimental) continue;
    counts[f.severity] += 1;
  }
  return counts;
}

/** The run verdict is the strongest document verdict. Order comes from one place, not from ifs. */
export function aggregateVerdict(documentVerdicts: readonly RunVerdict[], inputsFound: number): RunVerdict {
  // Nothing to check is not a usage error — a glob that matched nothing is a legitimate call
  // that judged nothing. It is exit 4 for the same reason a blind run is.
  if (inputsFound === 0) return "insufficient-coverage";
  for (const candidate of VERDICT_PRECEDENCE) {
    if (documentVerdicts.includes(candidate)) return candidate;
  }
  return "clean";
}

export function exitCodeFor(verdict: RunVerdict): 0 | 1 | 2 | 3 | 4 {
  return EXIT_CODE_BY_VERDICT[verdict];
}

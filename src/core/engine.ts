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
 *
 * A third decision was added in 0.2.3 and it is the boundary of the first: coverage answers for
 * the DOCUMENT, and two kinds of decline are not answers about the document. One names a
 * capability this build does not have (`TOOL_CAPABILITY_ENV_IDS`) — charging it to coverage made
 * every document with an inline SVG exit 4, which says "your document could not be judged" and
 * means "this tool cannot do that at all". The other names a target the question does not apply to
 * (`NON_APPLICABLE_ENV_IDS`). Both leave the coverage base and both stay in `notMeasured`, which
 * is where a reader looks for what was not judged and why.
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
  DocumentRenderArtifact,
  DocumentEvidenceCoverage,
  Evidence,
  Finding,
  InfraEvent,
  InputIdentity,
  NotMeasured,
  ResourceRecord,
  RuleCoverage,
  Snapshot,
  TargetEvaluation,
  StableTargetIdentity,
  TargetInventory,
  DocumentRevision,
} from "./types.ts";

export interface DocumentInput {
  fontIdentity?: DocumentReport["fontIdentity"];
  sourceIdentity?: { bySid: Record<string, StableTargetIdentity>; inventory: TargetInventory };
  revision?: DocumentRevision;
  comparisonScope?: DocumentReport["comparisonScope"];
  path: string;
  renderArtifact?: DocumentRenderArtifact;
  evidenceRequirement?: { required: boolean; expectedPages: number };
  snapshot: Snapshot | null;
  /** Infrastructure events collected before or during measurement. Fail-closed: never dropped. */
  infrastructure: InfraEvent[];
  /** PDF-raster evidence produced from the same paginated page before the rules run. */
  evidence?: Evidence[];
  /** Source ids whose overlay marks were refound and bound in the delivered PDF. */
  boundSids?: readonly string[];
  /** Document-level measurement declines emitted by acquisition/evidence apparatus. */
  notMeasured?: readonly NotMeasured[];
  /** Acquisition identity survives withdrawal of an invalid measured snapshot. */
  acquisition?: { inputIdentity: InputIdentity; resources: readonly ResourceRecord[] };
}

export interface EngineConfig {
  failOn: FailOn;
  activeRules: readonly Rule[];
  optionsByRule: Readonly<Record<string, RuleOptions>>;
  coverageFloors: Readonly<Record<string, number>>;
}

export interface DocumentOutcome {
  report: DocumentReport;
  /** Rules that produced at least one measured candidate. Feeds `measuredRules`. */
  measuredRuleIds: string[];
}

export function runDocument(input: DocumentInput, config: EngineConfig): DocumentOutcome {
  const evidenceCoverage = evidenceCoverageFor(input);
  const findings: Finding[] = [];
  const evaluations: TargetEvaluation[] = [];
  const coverage: Record<string, RuleCoverage> = {};
  const documentNotMeasured: NotMeasured[] = [...(input.notMeasured ?? [])];
  const infrastructure: InfraEvent[] = [...input.infrastructure];
  const measuredRuleIds: string[] = [];

  // No snapshot means nothing was measured. Which verdict that earns depends on *why*, and the
  // caller has already recorded the reason as an infrastructure event — an empty document is
  // exit 4, an aborted pagination is exit 3, and the two must not be collapsed.
  if (!input.snapshot) {
    return {
      report: {
        path: input.path,
        ...(input.renderArtifact ? { renderArtifact: input.renderArtifact } : {}),
        ...(evidenceCoverage ? { evidenceCoverage } : {}),
        inputIdentity: input.acquisition?.inputIdentity ?? null,
        ...(input.acquisition ? { resources: [...input.acquisition.resources] } : {}),
        sourceBinding: {
          input: { identityStatus: "unknown", rawBytesSha256: null, byteLength: null, encoding: null, complete: false },
          provenance: {
            binding: "unavailable", copyIntegrity: "unavailable", sourceRole: "unknown",
            producerId: null, receiptHash: null,
            diagnostics: ["snapshot was unavailable because document setup failed"],
          },
          files: [],
        },
        verdict: infrastructure.some((e) => isFatalInfra(e)) ? "infrastructure" : "insufficient-coverage",
        // The reason has to be the event that DECIDED the verdict, not whichever arrived first.
        // Taking `infrastructure[0]` let a run exit 3 while naming a kind this file explicitly
        // classifies as non-fatal: `[mark-raster-diff, checker-crashed]` reported the raster diff
        // as the reason for an exit it cannot cause. `exitReasonFor` below already searched for
        // the first fatal event; the two paths disagreed and only one of them was covered.
        exitReason: (infrastructure.find((e) => isFatalInfra(e)) ?? infrastructure[0])?.kind ?? "empty-input",
        pages: 0,
        coverage: {},
        findings: [],
        notMeasured: aggregateNotMeasured(documentNotMeasured),
        infrastructure,
        evidence: input.evidence ?? [],
        evaluations: [],
      },
      measuredRuleIds: [],
    };
  }

  const snapshot = input.snapshot;
  if (input.sourceIdentity && (!snapshot.source.complete || snapshot.svg.some(svg => svg.textTargetsCapped))) {
    input.sourceIdentity = { bySid: {}, inventory: { complete: false, omittedCount: snapshot.svg.reduce((n, svg) => n + (svg.textTargetsCapped ? Math.max(1, svg.textTargetCount - svg.texts.length) : 0), 0), reason: "identity/target-enumeration-incomplete" } };
  }

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
    const floor = config.coverageFloors[rule.id] ?? COVERAGE_FLOOR_BY_SEVERITY[rule.severity];
    // Two kinds of decline leave the coverage base: one because THIS BUILD cannot take the
    // measurement (`TOOL_CAPABILITY_ENV_IDS`), one because the question does not arise for that
    // target at all (`NON_APPLICABLE_ENV_IDS`). Neither is hidden — both stay in `notMeasured`
    // below with rule, reason and count. What changes is only that coverage stops answering a
    // question about the document with a fact about the tool, or with a question nobody asked.
    //
    // The subtraction is derived here, once, rather than left to each rule to remember, and it
    // happens AFTER `defineRule` has checked that measured plus declined equals candidates. The
    // rule's own books stay straight; only the ratio changes.
    const outsideCoverage = notMeasured
      .filter((n) => IS.toolCapabilityEnvId.has(n.reason) || IS.nonApplicableEnvId.has(n.reason))
      .reduce((sum, n) => sum + n.count, 0);
    const candidates = Math.max(0, result.candidates - outsideCoverage);
    const ratio = candidates === 0 ? null : result.measured / candidates;

    coverage[rule.id] = {
      candidates,
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
    evaluations.push(...(result.evaluations ?? []));
    if (result.measured > 0) measuredRuleIds.push(rule.id);
  }

  const verdict = documentVerdict({
    infrastructure,
    coverage,
    measuredRuleCount: measuredRuleIds.length,
    findings,
    failOn: config.failOn,
    ...(evidenceCoverage ? { evidenceCoverage } : {}),
  });

  // Evidence is produced before rule evaluation because it marks every source block. Rules remain
  // pure and invent no file path; this is the one projection point from page/SID binding onto the
  // findings they produced. A page finding binds to its page. A block finding additionally needs
  // its exact SID in the conformance set, so one good mark cannot lend evidence to another block.
  const boundSids = new Set(input.boundSids ?? []);
  for (const evaluation of evaluations) {
    const sid = evaluation.targetRef.sid;
    evaluation.stableIdentity = sid ? input.sourceIdentity?.bySid[sid] ?? { status: "unavailable", value: null, candidates: [] } : { status: "unavailable", value: null, candidates: [] };
    const block = snapshot.blocks.find(b => b.sid === sid && b.fragmentIndex === evaluation.targetRef.fragmentIndex);
    const svg = snapshot.svg.find(s => s.texts.some(t => t.sourceAddressKey === sid));
    const page = block?.page ?? svg?.page;
    evaluation.evidenceBound = sid !== null && boundSids.has(sid) && page !== undefined &&
      (input.evidence ?? []).some(e => e.page === page && e.bindsFinding);
  }
  for (const finding of findings) {
    const pageBox = snapshot.pages.find(p => p.pageNumber === finding.page)?.pageBox;
    const screenBox = finding.target.boxScreen;
    if (pageBox && screenBox && pageBox.width > 0 && pageBox.height > 0) finding.target.renderBox = {
      x: screenBox.x - pageBox.x, y: screenBox.y - pageBox.y, width: screenBox.width, height: screenBox.height,
      pageWidth: pageBox.width, pageHeight: pageBox.height, coordinateSystem: "css-page-top-left",
    };
    finding.stableIdentity = finding.target.sid ? input.sourceIdentity?.bySid[finding.target.sid] ?? { status: "unavailable", value: null, candidates: [] } : { status: "unavailable", value: null, candidates: [] };
    finding.recheck = { status: "required", reason: "repair-requires-compatible-positive-measurement", identityContract: "logical-source-value-v1" };
    const pageEvidence = input.evidence?.find((e) => e.page === finding.page) ?? null;
    if (pageEvidence) {
      const targetBound =
        finding.target.keyType === "page" ||
        (finding.target.sid !== null && boundSids.has(finding.target.sid));
      finding.evidence = {
        ref: pageEvidence.path,
        bindsFinding: pageEvidence.bindsFinding && targetBound,
      };
    }
    const provenance = snapshot.source.provenance;
    const sourceAddress = finding.target.sid;
    const original = sourceAddress ? snapshot.source.originalMap?.[sourceAddress] ?? null : null;
    const ambiguous = sourceAddress ? snapshot.source.originalAmbiguity?.[sourceAddress] ?? [] : [];
    const declaredRole = provenance?.sourceRole ?? "unknown";
    const inventory = original
      ? snapshot.source.files?.find((entry) => entry.file === original.file) ?? null
      : null;
    // An exact range without an inventory-bound original file is a locator, not a verified
    // original. Do not turn producer metadata into an uncheckable positive assertion.
    // Producer mappings to dependencies/assets are provenance, not an authoring edit location.
    // Only an inventory-bound authoring leaf can make a finding source-resolved or actionable.
    const originalAuthoringLeaf = inventory?.role === "authoring";
    const verified = provenance?.binding === "producer-bound" &&
      provenance.copyIntegrity === "verified" && originalAuthoringLeaf;
    const declared = provenance?.binding === "declared" && originalAuthoringLeaf;
    const status = original && verified
      ? "verified"
      : original && declared
      ? "declared"
      : ambiguous.length > 0
      ? "ambiguous"
      : "unavailable";
    const resolved = status === "verified" || status === "declared";
    finding.originalSource = {
      status,
      // A source role describes a resolved original range only. An omitted original leaf must
      // stay unknown even when another leaf in the same producer record is exact.
      role: status === "verified" ? "exact-original-range" : resolved ? declaredRole : "unknown",
      location: resolved ? original : null,
      integrity: resolved && inventory
        ? { sha256: inventory.sha256, byteLength: inventory.byteLength, role: inventory.role }
        : null,
      candidates: resolved ? [original!] : ambiguous,
    };
    finding.actionability = status === "verified" && finding.evidence.bindsFinding
      ? "actionable"
      : original || ambiguous.length > 0 || finding.source ? "recheck-required" : "unknown-source";
  }

  return {
    report: {
      path: input.path,
      ...(input.fontIdentity ? { fontIdentity: input.fontIdentity } : {}),
      ...(input.revision ? { revision: input.revision } : {}),
      ...(input.comparisonScope ? { comparisonScope: input.comparisonScope } : {}),
      ...(input.sourceIdentity ? { targetInventory: input.sourceIdentity.inventory } : {}),
      ...(input.renderArtifact ? { renderArtifact: input.renderArtifact } : {}),
      ...(evidenceCoverage ? { evidenceCoverage } : {}),
      inputIdentity: snapshot.meta.inputIdentity,
      sourceBinding: {
        input: snapshot.source.input ?? {
          identityStatus: "unknown", rawBytesSha256: null, byteLength: null, encoding: null, complete: false,
        },
        provenance: snapshot.source.provenance ?? {
          binding: "unavailable", copyIntegrity: "unavailable", sourceRole: "unknown",
          producerId: null, receiptHash: null,
          diagnostics: ["snapshot did not carry source provenance"],
        },
        files: snapshot.source.files ?? [],
      },
      verdict,
      exitReason: exitReasonFor(verdict, infrastructure, coverage, measuredRuleIds.length, evidenceCoverage),
      pages: snapshot.pages.length,
      coverage,
      findings,
      notMeasured: aggregateNotMeasured(documentNotMeasured),
      infrastructure,
      evidence: input.evidence ?? [],
      evaluations,
    },
    measuredRuleIds,
  };
}

function evidenceCoverageFor(input: DocumentInput): DocumentEvidenceCoverage | undefined {
  const requirement = input.evidenceRequirement;
  if (!requirement) return undefined;
  const expectedPages = requirement.expectedPages;
  const pages = input.evidence ?? [];
  const present = new Set<number>();
  const bound = new Set<number>();
  for (let page = 1; page <= expectedPages; page++) {
    const matches = pages.filter(item => item.page === page);
    if (matches.length === 1) {
      present.add(page);
      if (matches[0]!.bindsFinding) bound.add(page);
    }
  }
  const complete = expectedPages > 0 && bound.size === expectedPages;
  return {
    required: requirement.required, expectedPages, writtenPages: present.size, boundPages: bound.size,
    status: !requirement.required ? "not-requested" : complete ? "complete" : bound.size > 0 ? "partial" : "unavailable",
    reason: requirement.required && !complete ? "evidence/required-page-binding-incomplete" : null,
  };
}

function documentVerdict(input: {
  infrastructure: InfraEvent[];
  coverage: Record<string, RuleCoverage>;
  measuredRuleCount: number;
  findings: Finding[];
  failOn: FailOn;
  evidenceCoverage?: DocumentEvidenceCoverage;
}): RunVerdict {
  // Not every infrastructure event means exit 3. `NON_FATAL_INFRA_EVENT_KINDS` names the narrow
  // that do not, each for a reason the contract states; everything else does.
  if (input.infrastructure.some((e) => isFatalInfra(e))) return "infrastructure";
  if (input.evidenceCoverage?.required && input.evidenceCoverage.status !== "complete") return "insufficient-coverage";
  if (input.measuredRuleCount === 0) return "insufficient-coverage";
  if (Object.values(input.coverage).some((c) => !c.ok)) return "insufficient-coverage";
  return gateTriggeredBy(input.findings, input.failOn) ? "findings" : "clean";
}

function exitReasonFor(
  verdict: RunVerdict,
  infrastructure: InfraEvent[],
  coverage: Record<string, RuleCoverage>,
  measuredRuleCount: number,
  evidenceCoverage?: DocumentEvidenceCoverage,
): string | null {
  if (verdict === "infrastructure") {
    return infrastructure.find((e) => isFatalInfra(e))?.kind ?? null;
  }
  if (verdict === "insufficient-coverage") {
    if (evidenceCoverage?.reason) return evidenceCoverage.reason;
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

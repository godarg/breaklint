/** Repair comparison consumes positive target decisions, never absence of findings. */
import { createHash } from "node:crypto";
import type { Report, DocumentReport, DocumentRevision, StableTargetIdentity, Finding, TargetEvaluation } from "../core/types.ts";
import { verifyGitAncestry } from "../source/revision.ts";
import { inlineFontDigest } from "../source/font-identity.ts";

export type ComparisonStatus = "new" | "persisting" | "resolved" | "unmatchable" | "not-sufficiently-measured";
export type ComparisonReason = "identity-unavailable" | "identity-ambiguous" | "target-deleted-or-replaced" | "scope-incompatible-or-unknown" | "revision-unverified" | "rule-disabled-or-incompatible" | "configuration-incompatible" | "environment-incompatible-or-unknown" | "resource-identity-incomplete-or-incompatible" | "inventory-incomplete" | "infrastructure-or-coverage-incomplete" | "target-not-positively-measured" | "target-parts-reduced" | "positive-target-measurement" | "finding-observed";
export interface ComparisonResult { status: ComparisonStatus; beforeRunFindingId: string | null; afterRunFindingIds: string[]; reasons: ComparisonReason[]; }
export interface ReportComparison { schemaVersion: 1; identityContract: "logical-source-value-v1"; beforeRunId: string; afterRunId: string; results: ComparisonResult[]; }
export interface CompareReportsOptions { revision?: { repositoryRoot: string }; }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const resourceWitness = (document: DocumentReport, sha256: string): boolean =>
  document.sourceBinding.files.some(file => file.sha256 === sha256 && (file.role === "asset" || file.role === "dependency"));
function unique(identity: StableTargetIdentity | undefined): boolean {
  return identity?.status === "unique" && isHash(identity.value) && identity.identityContract === "logical-source-value-v1" && identity.canonicalization === "canonical-node-v1" && isHash(identity.authorAnchorSha256) && isHash(identity.semanticSha256) && identity.candidates.length === 1 && identity.candidates[0] === identity.value;
}
function sameTarget(finding: Finding, other: Finding | TargetEvaluation): boolean {
  const identity = other.stableIdentity;
  const target = "targetRef" in other ? other.targetRef : other.target;
  return unique(finding.stableIdentity) && unique(identity) && finding.stableIdentity.value === identity!.value && finding.target.keyType === target.keyType && finding.ruleId === other.ruleId;
}
function revisionBound(doc: DocumentReport): doc is DocumentReport & { revision: DocumentRevision } {
  const revision = doc.revision; const binding = doc.sourceBinding;
  if (!revision || revision.status !== "verified" || revision.adapter !== "host-local-git-v1" || !binding || binding.provenance.binding !== "producer-bound" || binding.provenance.copyIntegrity !== "verified" || !binding.input.complete || binding.input.identityStatus !== "verified") return false;
  const files = [...binding.files].sort((a, b) => a.file.localeCompare(b.file, "en"));
  return [revision.repositoryId, revision.projectId, revision.workingTreeSha256, revision.capturedSourcesSha256, revision.codeSha256, revision.optionsSha256].every(isHash) &&
    revision.capturedSourcesSha256 === digest(JSON.stringify(files)) && revision.codeSha256 === binding.provenance.codeSha256 && revision.optionsSha256 === binding.provenance.optionsSha256;
}
async function lineage(before: DocumentReport, after: DocumentReport, options: CompareReportsOptions): Promise<boolean> {
  if (!revisionBound(before) || !revisionBound(after)) return false;
  const a = before.revision; const b = after.revision;
  if (a.repositoryId !== b.repositoryId || a.projectId !== b.projectId) return false;
  if (a.head === b.head) return a.tree === b.tree && /^[a-f0-9]{40,64}$/u.test(a.head) && /^[a-f0-9]{40,64}$/u.test(a.tree);
  return !!options.revision && verifyGitAncestry(options.revision.repositoryRoot, a, b);
}
function resourceCompatible(before: DocumentReport, after: DocumentReport): boolean {
  const a = before.inputIdentity; const b = after.inputIdentity;
  if (!a || !b || !isHash(a.html) || !isHash(b.html) || !isHash(a.resourcesHash) || !isHash(b.resourcesHash)) return false;
  const normalized = (d: DocumentReport) => d.inputIdentity!.resources.filter(r => {
    const digest = inlineFontDigest(r.resolvedUri);
    return !(digest && d.fontIdentity?.status === "verified" && d.fontIdentity.fonts.some(f => f.sha256 === digest && f.resource === `inline-font:${digest}`));
  }).map(r => ({ uri: r.resolvedUri, sha256: r.sha256, outcome: r.outcome, bytes: r.bytes })).sort((x, y) => x.uri.localeCompare(y.uri, "en"));
  const old = normalized(before); const next = normalized(after);
  if ([...old, ...next].some(r => r.outcome !== "loaded" || !isHash(r.sha256) || r.bytes === null)) return false;
  if (old.length !== next.length || old.some((r, i) => r.uri !== next[i]!.uri)) return false;
  // A captured CSS/template repair may change a required resource. Its new digest must be
  // inventory-bound in both verified revisions; fonts still require identical byte identity.
  return old.every((r, i) => {
    const nextResource = next[i]!;
    return r.sha256 === nextResource.sha256 || (isHash(r.sha256) && isHash(nextResource.sha256) &&
      !/\.(?:woff2?|ttf|otf)(?:[?#]|$)/iu.test(r.uri) && resourceWitness(before, r.sha256) && resourceWitness(after, nextResource.sha256));
  });
}
function environmentCompatible(before: Report, after: Report, a: DocumentReport, b: DocumentReport): boolean {
  const fields = ["browserVersion", "platform", "pagedjsVersion", "locale"] as const;
  if (fields.some(field => !before.environment[field] || before.environment[field] !== after.environment[field])) return false;
  if (JSON.stringify(before.environment) !== JSON.stringify(after.environment)) return false;
  const x = a.fontIdentity; const y = b.fontIdentity;
  if (!x || !y || x.status !== "verified" || y.status !== "verified" || !x.complete || !y.complete || x.method !== "captured-css-fonts-and-cdp-custom-glyphs-v1" || y.method !== x.method || x.fonts.length === 0 || !x.actualFamilies?.length || !y.actualFamilies?.length || x.fonts.some(f => !isHash(f.sha256)) || JSON.stringify(x.fonts) !== JSON.stringify(y.fonts) || JSON.stringify(x.actualFamilies) !== JSON.stringify(y.actualFamilies)) return false;
  for (const [document, identity] of [[a, x], [b, y]] as const) if (identity.fonts.some(font => {
    const fontSha256 = font.sha256;
    return !isHash(fontSha256) || !resourceWitness(document, fontSha256) || !(font.resource === `inline-font:${fontSha256}` || document.inputIdentity?.resources.some(resource => resource.resolvedUri === font.resource && resource.sha256 === fontSha256 && resource.outcome === "loaded"));
  })) return false;
  return !!a.inputIdentity && !!b.inputIdentity &&
    JSON.stringify([...a.inputIdentity.fontFamilies].sort()) === JSON.stringify([...b.inputIdentity.fontFamilies].sort()) &&
    JSON.stringify([...a.inputIdentity.systemFontIds].sort()) === JSON.stringify([...b.inputIdentity.systemFontIds].sort());
}
function complete(doc: DocumentReport): boolean {
  return doc.targetInventory?.complete === true && doc.targetInventory.omittedCount === 0;
}
function scopeTuple(document: DocumentReport): readonly [string, string, "document-print"] | null {
  const scope = document.comparisonScope;
  if (!scope || !isHash(scope.projectId) || !isHash(scope.documentId) || scope.scenario !== "document-print") return null;
  return [scope.projectId, scope.documentId, scope.scenario];
}
function compatibleScope(a: DocumentReport, b: DocumentReport): boolean {
  const x = scopeTuple(a); const y = scopeTuple(b);
  return x !== null && y !== null && x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
}
function admissible(evaluation: TargetEvaluation): boolean {
  if (evaluation.status !== "not-applicable") return false;
  const measured = (name: string, value: boolean) => evaluation.measurements.some(m => m.name === name && m.value === value && m.operator === "=");
  return (evaluation.ruleId === "layout/unbreakable-block-too-tall" && evaluation.reason === "rule/break-inside-not-avoid" && measured("break-inside-avoid", false) && measured("target-visible", true)) ||
    (evaluation.ruleId === "svg/text-overflows-viewport" && evaluation.reason === "env/svg-overflow-visible" && measured("svg-overflow-visible", true) && measured("svg-text-rendered", true));
}
export async function compareReports(before: Report, after: Report, options: CompareReportsOptions = {}): Promise<ReportComparison> {
  if (Object.keys(options).some(k => k !== "revision") || (options.revision && (Object.keys(options.revision).some(k => k !== "repositoryRoot") || typeof options.revision.repositoryRoot !== "string"))) throw new TypeError("invalid comparison options");
  if ([before, after].some(report => report?.schemaVersion !== 4 || report?.profileKind !== "document" || !Array.isArray(report.documents))) throw new TypeError("compareReports requires document Report schema 4");
  const scopeKeys = (report: Report) => report.documents.map((doc) => {
    const scope = scopeTuple(doc);
    return scope === null ? null : JSON.stringify(scope);
  }).sort((a, b) => (a ?? "").localeCompare(b ?? "", "en"));
  const beforeScopes = scopeKeys(before), afterScopes = scopeKeys(after);
  const fullScope = beforeScopes.every((scope): scope is string => scope !== null) && afterScopes.every((scope): scope is string => scope !== null) &&
    new Set(beforeScopes).size === beforeScopes.length && JSON.stringify(beforeScopes) === JSON.stringify(afterScopes);
  const positiveInfrastructure = (doc: DocumentReport) => doc.infrastructure.some(e => e.kind === "geometry-cross-check-passed") && doc.infrastructure.every(e => e.kind === "geometry-cross-check-passed") && !!doc.evidenceCoverage && (!doc.evidenceCoverage.required || doc.evidenceCoverage.status === "complete");
  const results: ComparisonResult[] = []; const matched = new Set<string>();
  for (const doc of before.documents) {
    const candidates = after.documents.filter(d => compatibleScope(doc, d));
    const next = candidates.length === 1 ? candidates[0]! : undefined;
    const validLineage = next ? await lineage(doc, next, options) : false;
    for (const finding of doc.findings) {
      const entry: ComparisonResult = { status: "unmatchable", beforeRunFindingId: finding.runFindingId, afterRunFindingIds: [], reasons: [] };
      results.push(entry);
      if (!unique(finding.stableIdentity)) { entry.reasons.push(finding.stableIdentity.status === "ambiguous" ? "identity-ambiguous" : "identity-unavailable"); continue; }
      if (!next) { entry.status = "not-sufficiently-measured"; entry.reasons.push("scope-incompatible-or-unknown"); continue; }
      const observed = next.findings.filter(f => sameTarget(finding, f));
      for (const f of observed) matched.add(f.runFindingId);
      if (doc.findings.filter(f => sameTarget(finding, f)).length !== 1 || observed.length > 1) { entry.afterRunFindingIds = observed.map(f => f.runFindingId); entry.reasons.push("identity-ambiguous"); continue; }
      if (!fullScope) { entry.status = "not-sufficiently-measured"; entry.afterRunFindingIds = observed.map(f => f.runFindingId); entry.reasons.push("scope-incompatible-or-unknown"); continue; }
      if (observed.length > 0) {
        entry.afterRunFindingIds = observed.map(f => f.runFindingId);
        if (validLineage && isHash(before.config.fingerprint) && before.config.fingerprint === after.config.fingerprint && before.tool.version === after.tool.version && before.config.activeRules.includes(finding.ruleId) && after.config.activeRules.includes(finding.ruleId) && environmentCompatible(before, after, doc, next) && resourceCompatible(doc, next) && complete(doc) && complete(next)) {
          entry.status = "persisting"; entry.reasons = ["finding-observed"];
          for (const f of observed) matched.add(f.runFindingId);
        } else {
          entry.status = "not-sufficiently-measured"; entry.reasons = ["finding-observed"];
          if (!validLineage) entry.reasons.push("revision-unverified");
          if (!isHash(before.config.fingerprint) || before.config.fingerprint !== after.config.fingerprint) entry.reasons.push("configuration-incompatible");
          if (before.tool.version !== after.tool.version || !before.config.activeRules.includes(finding.ruleId) || !after.config.activeRules.includes(finding.ruleId)) entry.reasons.push("rule-disabled-or-incompatible");
          if (!environmentCompatible(before, after, doc, next)) entry.reasons.push("environment-incompatible-or-unknown");
          if (!resourceCompatible(doc, next)) entry.reasons.push("resource-identity-incomplete-or-incompatible");
          if (!complete(doc) || !complete(next)) entry.reasons.push("inventory-incomplete");
        }
        continue;
      }
      const evaluations = next.evaluations.filter(e => sameTarget(finding, e));
      if (evaluations.length === 0) {
        if (!after.config.activeRules.includes(finding.ruleId)) { entry.status = "not-sufficiently-measured"; entry.reasons.push("rule-disabled-or-incompatible"); }
        else if (!complete(next)) { entry.status = "not-sufficiently-measured"; entry.reasons.push("inventory-incomplete"); }
        else if (!positiveInfrastructure(next) || !next.coverage[finding.ruleId]?.ok) { entry.status = "not-sufficiently-measured"; entry.reasons.push("infrastructure-or-coverage-incomplete"); }
        else entry.reasons.push("target-deleted-or-replaced");
        continue;
      }
      entry.status = "not-sufficiently-measured";
      if (!complete(doc) || !complete(next)) entry.reasons.push("inventory-incomplete");
      if (!validLineage) entry.reasons.push("revision-unverified");
      if (!after.config.activeRules.includes(finding.ruleId) || !before.config.activeRules.includes(finding.ruleId) || evaluations.some(e => e.semanticsVersion !== "rule-decision-v1") || before.tool.version !== after.tool.version) entry.reasons.push("rule-disabled-or-incompatible");
      if (!isHash(before.config.fingerprint) || before.config.fingerprint !== after.config.fingerprint || doc.revision?.optionsSha256 !== next.revision?.optionsSha256) entry.reasons.push("configuration-incompatible");
      if (!environmentCompatible(before, after, doc, next)) entry.reasons.push("environment-incompatible-or-unknown");
      if (!resourceCompatible(doc, next)) entry.reasons.push("resource-identity-incomplete-or-incompatible");
      // Both observations must be positively measured: a finding recorded under a failed or
      // incomplete baseline cannot be declared repaired by a clean later run.
      if (!positiveInfrastructure(doc) || !positiveInfrastructure(next) || !next.coverage[finding.ruleId]?.ok || next.notMeasured.some(n => n.ruleId === finding.ruleId && !(n.reason === "env/svg-overflow-visible" && evaluations.every(admissible))) || (next.evidenceCoverage?.required && next.evidenceCoverage.status !== "complete")) entry.reasons.push("infrastructure-or-coverage-incomplete");
      const prior = doc.evaluations.filter(e => sameTarget(finding, e));
      if (prior.length === 0 || evaluations.length < prior.length || evaluations.some(e => (e.targetCount ?? 1) !== 1)) entry.reasons.push("target-parts-reduced");
      if (evaluations.some(e => !(admissible(e) || (e.status === "measured" && e.predicate.violated === false && e.measurements.length > 0)) || (finding.evidence.bindsFinding && e.evidenceBound !== true))) entry.reasons.push("target-not-positively-measured");
      if (entry.reasons.length === 0) { entry.status = "resolved"; entry.reasons = ["positive-target-measurement"]; }
    }
  }
  for (const doc of after.documents) {
    const candidates = before.documents.filter(d => compatibleScope(d, doc));
    const prior = candidates.length === 1 ? candidates[0] : undefined;
    const incompatibilities: ComparisonReason[] = [];
    if (!fullScope || !prior) incompatibilities.push("scope-incompatible-or-unknown");
    else {
      if (!await lineage(prior, doc, options)) incompatibilities.push("revision-unverified");
      if (!isHash(before.config.fingerprint) || before.config.fingerprint !== after.config.fingerprint) incompatibilities.push("configuration-incompatible");
      if (before.tool.version !== after.tool.version || JSON.stringify([...before.config.activeRules].sort()) !== JSON.stringify([...after.config.activeRules].sort())) incompatibilities.push("rule-disabled-or-incompatible");
      if (!environmentCompatible(before, after, prior, doc)) incompatibilities.push("environment-incompatible-or-unknown");
      if (!resourceCompatible(prior, doc)) incompatibilities.push("resource-identity-incomplete-or-incompatible");
      if (!complete(prior) || !complete(doc)) incompatibilities.push("inventory-incomplete");
      if (!positiveInfrastructure(prior) || !positiveInfrastructure(doc)) incompatibilities.push("infrastructure-or-coverage-incomplete");
    }
    const compatible = incompatibilities.length === 0;
    for (const finding of doc.findings) if (!matched.has(finding.runFindingId)) {
      const identityUnique = unique(finding.stableIdentity) && doc.findings.filter(f => sameTarget(finding, f)).length === 1;
      results.push({ status: !identityUnique ? "unmatchable" : compatible ? "new" : "not-sufficiently-measured", beforeRunFindingId: null, afterRunFindingIds: [finding.runFindingId], reasons: !identityUnique ? [finding.stableIdentity.status === "unavailable" ? "identity-unavailable" : "identity-ambiguous"] : compatible ? ["finding-observed"] : incompatibilities });
    }
  }
  return { schemaVersion: 1, identityContract: "logical-source-value-v1", beforeRunId: before.runId, afterRunId: after.runId, results };
}

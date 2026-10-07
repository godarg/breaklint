import type { Finding, NotMeasured, Report } from "../core/types.ts";

export interface DeclineReason {
  document: string;
  ruleId: string | null;
  scope: NotMeasured["scope"];
  reason: NotMeasured["reason"];
  count: number;
}

export interface FindingGroup {
  ruleId: string;
  findingIds: string[];
  /** Index in the canonical report, for links to existing HTML finding articles. */
  firstIndex: number;
  pages: number[];
  priority: number;
}

export interface NextCheck {
  kind: "measurement" | "coverage" | "findings";
  title: string;
  detail: string;
  findingIndex: number | null;
}

export interface ReportDecisions {
  declines: DeclineReason[];
  groups: FindingGroup[];
  nextChecks: NextCheck[];
}

// Code-point order avoids depending on the host's collation locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priority(finding: Finding): number {
  if (finding.experimental) return 3;
  return { error: 0, warn: 1, info: 2 }[finding.severity];
}

/**
 * Presentation only: existing counts and findings select a reading order. A shared rule id
 * is not a shared cause, and a next check is not a diagnosis or a tested repair.
 * Nothing in this projection is added to the canonical JSON report.
 */
export function projectDecisions(report: Report): ReportDecisions {
  const declinesByKey = new Map<string, DeclineReason>();
  for (const document of report.documents) {
    for (const entry of document.notMeasured) {
      const key = JSON.stringify([document.path, entry.ruleId, entry.scope, entry.reason]);
      const existing = declinesByKey.get(key);
      if (existing) existing.count += entry.count;
      else declinesByKey.set(key, {
        document: document.path, ruleId: entry.ruleId, scope: entry.scope,
        reason: entry.reason, count: entry.count,
      });
    }
  }
  const declines = [...declinesByKey.values()].sort((a, b) =>
    compareText(a.document, b.document) || compareText(a.ruleId ?? "", b.ruleId ?? "") ||
    compareText(a.scope, b.scope) || compareText(a.reason, b.reason));

  const groupsByRule = new Map<string, FindingGroup>();
  for (const [index, finding] of report.findings.entries()) {
    const existing = groupsByRule.get(finding.ruleId);
    if (existing) {
      existing.findingIds.push(finding.runFindingId);
      existing.pages.push(finding.page);
      existing.priority = Math.min(existing.priority, priority(finding));
    } else {
      groupsByRule.set(finding.ruleId, {
        ruleId: finding.ruleId, findingIds: [finding.runFindingId], firstIndex: index,
        pages: [finding.page], priority: priority(finding),
      });
    }
  }
  const groups = [...groupsByRule.values()].sort((a, b) => compareText(a.ruleId, b.ruleId));
  for (const group of groups) {
    group.findingIds.sort(compareText);
    group.pages = [...new Set(group.pages)].sort((a, b) => a - b);
  }

  const nextChecks: NextCheck[] = [];
  const partial = report.runVerdict === "infrastructure" || report.runVerdict === "insufficient-coverage";
  if (partial) {
    nextChecks.push({
      kind: "measurement", title: "Restore measurement before interpreting partial findings",
      detail: `Run verdict: ${report.runVerdict}; exit ${report.exitCode}. Inspect the measurement apparatus and coverage details.`,
      findingIndex: null,
    });
  }
  const shortfalls = report.documents.flatMap((document) => Object.entries(document.coverage)
    .filter(([, coverage]) => !coverage.ok)
    .map(([ruleId, coverage]) => ({ document: document.path, ruleId, coverage })))
    .sort((a, b) => compareText(a.document, b.document) || compareText(a.ruleId, b.ruleId));
  for (const shortfall of shortfalls) {
    nextChecks.push({
      kind: "coverage", title: `Inspect coverage for ${shortfall.ruleId}`,
      detail: `${shortfall.document}: ${shortfall.coverage.measured}/${shortfall.coverage.candidates} candidates measured; ` +
        `${shortfall.coverage.notMeasuredCount} not measured; floor ${shortfall.coverage.floor}.`,
      findingIndex: null,
    });
  }
  for (const group of [...groups].sort((a, b) => a.priority - b.priority || compareText(a.ruleId, b.ruleId))) {
    nextChecks.push({
      kind: "findings", title: `Inspect findings for ${group.ruleId}`,
      detail: `${group.findingIds.length} finding${group.findingIds.length === 1 ? "" : "s"}. ` +
        "Read each message, source and evidence before choosing a repair.",
      findingIndex: group.firstIndex,
    });
  }
  return { declines, groups, nextChecks: nextChecks.slice(0, 3) };
}

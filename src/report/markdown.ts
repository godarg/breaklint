import type { Report } from "../core/types.ts";
import { LABELS, mandatoryFacts } from "./mandatory.ts";
import { emptyStateSentence, infraLines } from "./infra.ts";
import { COVERAGE_COUNT_NOTICE, coverageAccounting, coverageAccountingText, projectDecisions } from "./decisions.ts";
import { VALIDATION_RULES_BY_ID } from "../rules/index.ts";

function text(value: string): string {
  return value.replace(/[\u0000-\u0020]+/gu, " ").replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/[\\`\[\]*_!]/gu, (character) => `&#${character.charCodeAt(0)};`)
    .replace(/\|/gu, "\\|");
}

export function renderMarkdown(report: Report): string {
  const f = mandatoryFacts(report);
  const out: string[] = [];
  out.push(`# breaklint — ${f.runVerdict}`, "");
  out.push("| | |", "|---|---|");
  out.push(`| ${LABELS.inputsFound} | ${f.inputsFound} |`);
  out.push(`| ${LABELS.pagesAnalysed} | ${f.pagesAnalysed} |`);
  out.push(`| ${LABELS.rulesRun} | ${f.rulesRun} |`);
  out.push(`| ${LABELS.measuredRules} | ${f.measuredRules} |`);
  out.push(`| ${LABELS.notMeasuredTotal} | ${f.notMeasuredTotal} |`);
  out.push(`| ${LABELS.runVerdict} | ${f.runVerdict} |`);
  out.push(`| ${LABELS.mode} | ${f.mode} |`);
  out.push(`| ${LABELS.failOn} | ${f.failOn} |`);
  out.push(`| ${LABELS.gateTriggeredBy} | ${f.gateTriggeredBy} |`, "");
  out.push(`Coverage counts: ${coverageAccountingText(coverageAccounting(report.documents.flatMap(doc => Object.values(doc.coverage))))}.`,
    "", COVERAGE_COUNT_NOTICE, "");

  const decisions = projectDecisions(report);
  if (decisions.nextChecks.length > 0) {
    out.push("## Next checks", "", "Navigation only; these are not tested fixes.", "");
    for (const [index, check] of decisions.nextChecks.entries()) out.push(`${index + 1}. ${text(check.title)}. ${text(check.detail)}`);
    out.push("");
  }
  if (decisions.groups.length > 1 || decisions.groups.some((group) => group.findingIds.length > 1)) {
    out.push("## Findings by rule", "", "Every individual finding remains below.", "", "| rule | findings |", "|---|---:|");
    for (const group of decisions.groups) out.push(`| ${text(group.ruleId)} | ${group.findingIds.length} |`);
    out.push("");
  }
  if (decisions.declines.length > 0) {
    out.push("## Declined candidates", "", "Counted reasons remain visible even when coverage meets its floor.", "",
      "| document | rule | scope | reason | count |", "|---|---|---|---|---:|");
    for (const decline of decisions.declines) out.push(`| ${text(decline.document)} | ${text(decline.ruleId ?? "no rule")} | ${decline.scope} | ${decline.reason} | ${decline.count} |`);
    out.push("");
  }

  // The apparatus before the findings: a run that could not measure has to say so here, not
  // only in the verdict cell above. This reporter printed the clean-run sentence on an exit-3
  // run until an audit measured it.
  const infra = infraLines(report);
  if (infra.length > 0) {
    out.push("## Measurement apparatus", "");
    out.push("| level | kind | document | detail | measured |", "|---|---|---|---|---|");
    for (const line of infra) {
      out.push(
        `| ${line.level} | \`${line.kind}\` | ${line.document} | ${line.detail.replace(/\|/gu, "\\|")} | ` +
          `${line.measured.join("; ").replace(/\|/gu, "\\|") || "—"} |`,
      );
    }
    out.push("");
  }

  if (report.findings.length === 0) {
    out.push(emptyStateSentence(report), "");
  } else {
    out.push("| severity | rule | page | measured | threshold | source |", "|---|---|---|---|---|---|");
    for (const finding of report.findings) {
      const m = finding.measurement;
      out.push(
        `| ${finding.severity}${finding.experimental ? " (experimental)" : ""} | \`${finding.ruleId}\` | ` +
          `${finding.page} | ${m.value} ${m.unit} | ${m.threshold} ${m.unit} | ` +
          `${finding.source ? `${finding.source.file}:${finding.source.line}` : "unknown"} |`,
      );
    }
    out.push("");
    for (const finding of report.findings) {
      const remediation = VALIDATION_RULES_BY_ID.get(finding.ruleId)?.remediation;
      out.push(`### ${text(finding.runFindingId)} — ${text(finding.ruleId)}, page ${finding.page}`, "",
        `Message: ${text(finding.message)}`, "");
      if (remediation) out.push(`Remediation: ${text(remediation.advice)}`, "",
        `Remediation tested: ${remediation.tested ? "yes" : "no (untested)"}`, "");
    }
  }

  // Coverage is printed even when it is complete. A reader who only sees it when it is short
  // cannot tell "complete" from "not reported".
  out.push("## Coverage", "");
  out.push("The coverage base contains applicable evaluations. Outside-base declines remain in the counted reasons above.", "");
  out.push("| rule | applicable base | measured | applicable not measured | floor | ok |", "|---|---|---|---|---|---|");
  for (const doc of report.documents) {
    for (const [ruleId, c] of Object.entries(doc.coverage)) {
      out.push(
        `| \`${ruleId}\` | ${c.candidates} | ${c.measured} | ${coverageAccounting([c]).applicableUnmeasured} | ` +
          `${c.floor * 100}% | ${c.ok ? "yes" : "**no**"} |`,
      );
    }
  }
  return out.join("\n") + "\n";
}

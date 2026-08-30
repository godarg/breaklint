import type { Report } from "../core/types.ts";
import { LABELS, mandatoryFacts } from "./mandatory.ts";
import { emptyStateSentence, infraLines } from "./infra.ts";

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
  }

  // Coverage is printed even when it is complete. A reader who only sees it when it is short
  // cannot tell "complete" from "not reported".
  out.push("## Coverage", "");
  out.push("| rule | candidates | measured | not measured | floor | ok |", "|---|---|---|---|---|---|");
  for (const doc of report.documents) {
    for (const [ruleId, c] of Object.entries(doc.coverage)) {
      out.push(
        `| \`${ruleId}\` | ${c.candidates} | ${c.measured} | ${c.notMeasuredCount} | ` +
          `${c.floor} | ${c.ok ? "yes" : "**no**"} |`,
      );
    }
  }
  return out.join("\n") + "\n";
}

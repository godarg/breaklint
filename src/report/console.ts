import type { Finding, Report } from "../core/types.ts";
import { summaryLine } from "./mandatory.ts";
import { emptyStateSentence, infraLines } from "./infra.ts";
import { VALIDATION_RULES_BY_ID } from "../rules/index.ts";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;

/**
 * Defensible ordering of findings:
 * 1. Document path (alphabetical)
 * 2. Page number (reading order)
 * 3. Severity (error > warn > info)
 * 4. Rule ID (alphabetical)
 * 5. Screen box Y position (top-to-bottom on page)
 */
function compareFindings(a: Finding, b: Finding): number {
  if (a.document !== b.document) return a.document.localeCompare(b.document);
  if (a.page !== b.page) return a.page - b.page;
  const rank: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const rDiff = (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
  if (rDiff !== 0) return rDiff;
  if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
  const ay = a.target.boxScreen?.y ?? 0;
  const by = b.target.boxScreen?.y ?? 0;
  return ay - by;
}

/**
 * The terminal format.
 *
 * A finding reports a measurement about a document. It does not address the author and it does
 * not talk about them. Fixed slot order, and an unknown slot is printed as `unknown` rather
 * than left out — a missing slot looks like an inapplicable one, and the tool has to be able to
 * say what it does not know.
 *
 * The severity is a word, never only a colour. In a pipe without a TTY the escapes are dropped,
 * and someone reading a CI log still has to be able to sort by severity. Only the eight basic
 * colours are used; a 256-colour hex survives no terminal theme.
 */
export function renderConsole(report: Report, opts: { colour?: boolean } = {}): string {
  const colour = opts.colour ?? false;
  const paint = (code: string, text: string) => (colour ? `${ESC}${code}m${text}${RESET}` : text);
  const out: string[] = [];

  // 1. Collect and defensively sort all findings
  const allFindings: Finding[] = [];
  for (const doc of report.documents) {
    for (const finding of doc.findings) allFindings.push(finding);
  }
  allFindings.sort(compareFindings);

  // 2. Top 5-line summary banner
  if (report.runVerdict === "clean") {
    out.push(`${paint("32", "PASS")} clean run · exit ${report.exitCode}`);
  } else if (report.runVerdict === "findings") {
    out.push(`${paint("31", "FAIL")} findings block this run · exit ${report.exitCode}`);
  } else if (report.runVerdict === "insufficient-coverage") {
    out.push(`${paint("33", "INCOMPLETE")} coverage did not meet contract · exit ${report.exitCode}`);
  } else if (report.runVerdict === "infrastructure") {
    out.push(`${paint("31", "ERROR")} checker failed · exit ${report.exitCode}`);
  } else {
    out.push(`${paint("31", "FAIL")} command could not start · exit ${report.exitCode}`);
  }

  const pCount = report.pagesAnalysed;
  const dCount = report.inputsFound;
  out.push(
    `checked ${pCount} page${pCount === 1 ? "" : "s"} in ${dCount} document${dCount === 1 ? "" : "s"} · ` +
      `error ${report.summary.error} · warn ${report.summary.warn} · info ${report.summary.info}`,
  );
  out.push(
    `gate: fail-on ${report.config.effective.failOn} · triggered by: ${report.summary.gateTriggeredBy ?? "none"}`,
  );

  if (report.runVerdict === "clean") {
    out.push("all requested checks ran and passed");
  } else if (report.runVerdict === "findings") {
    const first = allFindings[0];
    if (first) {
      out.push(`first issue: ${first.severity} ${first.ruleId} on page ${first.page} (${first.document})`);
    } else {
      out.push("findings triggered the gate (see below)");
    }
  } else if (report.runVerdict === "insufficient-coverage") {
    out.push("coverage failure: inspect coverage shortfalls below before treating results as clean");
  } else if (report.runVerdict === "infrastructure") {
    const firstInfra = infraLines(report)[0];
    out.push(`checker stopped: ${firstInfra?.kind ?? "checker failure"} (see diagnostic below)`);
  } else {
    out.push("action: check command arguments and configuration");
  }
  out.push("");

  // 3. Render findings
  for (const finding of allFindings) {
    out.push(renderFinding(finding, paint));
  }

  /*
   * The apparatus speaking about itself, and it has to come BEFORE the empty state.
   *
   * Measured on this build before these lines existed: a run that exited 3 because the PDF did
   * not reproduce the page the rules measured printed `checked 0 pages in 1 document, no
   * findings` and nothing else. The reason travelled in an infrastructure event that no reporter
   * projected, so the one word explaining the exit — `dom-pdf-divergence` — reached the JSON and
   * never a human. The comment below has warned against exactly this since the file was written:
   * the empty state was guarded and the ERROR state was not.
   *
   * The banner above now names the verdict and the first infrastructure kind, so the reason does
   * reach a human on line 1 and line 4. That does not retire this comment: the banner is a second
   * projection, and the ordering it depends on is the one recorded here.
   */
  for (const line of infraLines(report)) {
    const label = line.level === "error" ? "checker" : line.level === "warning" ? "diagnostic" : "evidence";
    const colourCode = line.level === "error" ? "31" : line.level === "warning" ? "33" : "36";
    out.push(
      `${paint(colourCode, label)} ${line.kind}  ${line.document}\n` +
        `  detail     ${line.detail}` +
        // One `key=value` per line. The first version printed `JSON.stringify(measured)` raw and
        // a divergence over fifty pages produced a single 7 488-character line.
        line.measured.map((m) => `\n  measured   ${m}`).join(""),
    );
  }

  // 5. Coverage shortfall block on exit 4
  if (report.runVerdict === "insufficient-coverage") {
    out.push(paint("33", "coverage shortfall (exit 4):"));
    out.push("  A rule without enough measurement cannot establish absence of a defect.");
    let shortfallFound = false;
    for (const doc of report.documents) {
      for (const [ruleId, cov] of Object.entries(doc.coverage)) {
        if (!cov.ok) {
          shortfallFound = true;
          const reasons = [
            ...new Set(
              doc.notMeasured
                .filter((n) => n.ruleId === ruleId)
                .map((n) => n.reason),
            ),
          ];
          const reasonStr = reasons.length > 0 ? reasons.join(", ") : "no reason declared";
          const ratioPct = cov.coverage === null ? "not applicable" : `${(cov.coverage * 100).toFixed(0)}%`;
          const floorPct = `${(cov.floor * 100).toFixed(0)}%`;
          out.push(`  rule       ${ruleId} in ${doc.path}`);
          out.push(`  measured   ${cov.measured} of ${cov.candidates} candidates (${ratioPct}); required floor ${floorPct}`);
          out.push(`  reason     ${reasonStr}`);
          out.push(`  options    - Inspect the document for unsupported constructs or environment limits`);
          out.push(`             - If this document intentionally uses unsupported elements, disable the check with:`);
          out.push(`               --disable ${ruleId}`);
          out.push("");
        }
      }
    }
    if (!shortfallFound) {
      out.push("  detail     The run declared insufficient coverage without a per-rule shortfall. Inspect the canonical JSON report.");
      out.push("");
    }
  }

  // The empty state has to say what was checked. A tool that prints nothing when it passed
  // and nothing when it did nothing reports its own idleness as success — and that is a
  // silent failure wearing the costume of a clean run. `emptyStateSentence` also refuses the
  // clean-run wording for an infrastructure verdict, identically in all six reporters.
  if (report.findings.length === 0) {
    out.push(emptyStateSentence(report));
  }

  out.push("");
  out.push(summaryLine(report));
  out.push(
    `breaklint ${report.tool.version} · ${report.environment.browserVersion || "no browser"} · ` +
      `paged.js ${report.environment.pagedjsVersion || "not resolved"}`,
  );
  const s = report.summary;
  out.push(
    `error ${s.error} · warn ${s.warn} · info ${s.info} · experimental ${s.experimental} (never gates)`,
  );
  return out.join("\n") + "\n";
}

function renderFinding(f: Finding, paint: (code: string, text: string) => string): string {
  const code = f.severity === "error" ? "31" : f.severity === "warn" ? "33" : "36";
  const m = f.measurement;
  const ruleMeta = VALIDATION_RULES_BY_ID.get(f.ruleId);
  const lines = [
    `${paint(code, f.severity.padEnd(5))} ${f.ruleId}  page ${f.page}`,
    `  measured   ${m.value} ${m.unit}; threshold ${m.threshold} ${m.unit}` +
      `${m.calibrated ? "" : " (uncalibrated)"}`,
    `  detail     ${f.message}`,
  ];

  if (ruleMeta?.remediation) {
    lines.push(`  remedy     ${ruleMeta.remediation.advice}`);
    if (!ruleMeta.remediation.tested) lines.push("             untested: no trigger/remedied pair in this package shows this advice removing this finding");
  }

  if (f.ruleId === "layout/half-empty-page") {
    lines.push(`  note       heuristic warning: fires on most documents because line leading and block margins are not in net fill`);
  }

  lines.push(`  source     ${f.source ? `${f.source.file}:${f.source.line}` : "unknown (node produced by the paginator)"}`);
  lines.push(
    `  render     ${f.evidence.ref ?? "unknown (no evidence produced)"}` +
      `${f.evidence.ref && !f.evidence.bindsFinding ? " — evidence shows the PDF, not this finding" : ""}`,
  );

  if (f.ambiguity) {
    lines.push(
      `  ambiguity  ${f.ambiguity.groupSize} findings share this fingerprint and cannot be told apart`,
    );
  }
  return lines.join("\n");
}

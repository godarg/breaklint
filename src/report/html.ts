import type { Report } from "../core/types.ts";
import { LABELS } from "./mandatory.ts";
import { buildHtmlReportModel } from "./html-model.ts";
import { REPORT_HTML_STYLES } from "./html-styles.ts";

const esc = (value: unknown): string =>
  String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

function renderInfrastructure(model: ReturnType<typeof buildHtmlReportModel>): string {
  if (model.status.key !== "infrastructure") return "";
  const events = model.infrastructure.length === 0
    ? `<p>The run declared an infrastructure failure without a diagnostic event. Treat the result as untrusted.</p>`
    : `<ol class="checker-list">
${model.infrastructure.map((line) => `<li class="checker-event">
  <h3><code>${esc(line.kind)}</code></h3>
  <p><strong>Document:</strong> <span class="mono">${esc(line.document)}</span></p>
  <p>${esc(line.detail)}</p>
  <p><strong>Measured context:</strong> ${line.measured.length === 0 ? "Not available" : esc(line.measured.join("; "))}</p>
</li>`).join("\n")}
</ol>`;
  return `<section aria-labelledby="checker-heading">
<h2 id="checker-heading">Checker failure</h2>
<div class="state-alert">
  <p><strong>This is not a clean run.</strong> Fix the checker failure and run the same command again.</p>
</div>
${events}
</section>`;
}

function renderCoverageAlert(model: ReturnType<typeof buildHtmlReportModel>): string {
  if (model.status.key !== "insufficient-coverage") return "";
  const shortfalls = model.coverage.flatMap((document) =>
    document.rows.filter((row) => !row.ok).map((row) => ({ document: document.path, ...row })),
  );
  return `<section aria-labelledby="coverage-alert-heading">
<h2 id="coverage-alert-heading">Coverage did not meet the contract</h2>
<div class="state-alert">
  <p><strong>This is not a clean run.</strong> A rule without enough measurement cannot establish absence of a defect.</p>
  ${shortfalls.length === 0
    ? `<p>The run declared insufficient coverage without a per-rule shortfall. Inspect the canonical JSON report.</p>`
    : `<ul>${shortfalls.map((row) => `<li><code>${esc(row.ruleId)}</code> in <span class="mono">${esc(row.document)}</span>: ${row.measured} of ${row.candidates} measured; required floor ${esc(row.floor)}.</li>`).join("")}</ul>`}
</div>
</section>`;
}

function renderFindingEvidence(finding: ReturnType<typeof buildHtmlReportModel>["findings"][number]): string {
  if (finding.evidence.state === "none") {
    return `<p class="evidence-state"><strong>Evidence:</strong> ${esc(finding.evidence.label)}</p>`;
  }
  const reference = finding.evidence.ref ?? "Unavailable";
  const renderedReference = finding.evidence.href
    ? `<a href="${esc(finding.evidence.href)}">${esc(reference)}</a>`
    : `<span class="mono">${esc(reference)}</span> <span>(not navigable)</span>`;
  return `<p class="evidence-state"><strong>Evidence:</strong> ${esc(finding.evidence.label)} · ${renderedReference}</p>`;
}

function renderFindings(model: ReturnType<typeof buildHtmlReportModel>): string {
  const list = model.findings.length === 0
    ? `<div class="empty-state">
  <h3>${model.status.key === "clean" ? "Nothing reached the gate" : "No trustworthy finding list"}</h3>
  <p>${esc(model.findingsLead)}</p>
</div>`
    : `<ol class="finding-list">
${model.findings.map((finding) => `<li>
<article class="finding ${esc(finding.severity)}" id="${esc(finding.id)}" aria-labelledby="${esc(finding.id)}-title">
  <div class="finding-kicker">
    <span class="severity ${esc(finding.severity)}">${esc(finding.severityLabel)}</span>
    ${finding.experimental ? `<span class="experimental">Experimental</span>` : ""}
  </div>
  <h3 id="${esc(finding.id)}-title"><code>${esc(finding.ruleId)}</code> · page ${finding.page}</h3>
  <p class="finding-message">${esc(finding.message)}</p>
  <dl class="finding-facts">
    <div><dt>Document</dt><dd class="mono">${esc(finding.document)}</dd></div>
    <div><dt>Source</dt><dd class="mono">${finding.source ? esc(finding.source) : "Unknown — no source location was measured"}</dd></div>
    <div><dt>Measured</dt><dd class="mono">${esc(finding.measured)}</dd></div>
    <div><dt>Threshold</dt><dd class="mono">${esc(finding.threshold)}</dd></div>
    <div><dt>Calibration</dt><dd>${esc(finding.calibration)}</dd></div>
    <div><dt>Proof source</dt><dd>${finding.proofSource ? esc(finding.proofSource) : "None declared"}</dd></div>
  </dl>
  ${renderFindingEvidence(finding)}
  ${finding.ambiguity ? `<p class="evidence-state"><strong>Ambiguity:</strong> ${esc(finding.ambiguity)}</p>` : ""}
</article>
</li>`).join("\n")}
</ol>`;

  return `<section class="findings-section${model.findings.length === 0 ? " findings-empty" : ""}" aria-labelledby="findings-heading">
<div class="section-heading">
  <h2 id="findings-heading">Findings</h2>
  <p class="section-lead">${esc(model.findingsLead)}</p>
</div>
${list}
</section>`;
}

function renderCoverage(model: ReturnType<typeof buildHtmlReportModel>): string {
  const documents = model.coverage.length === 0
    ? `<div class="empty-state"><h3>Coverage unavailable</h3><p>No document coverage was produced by this run.</p></div>`
    : `<ol class="coverage-documents">
${model.coverage.map((document) => `<li>
<article class="coverage-document" aria-labelledby="${esc(document.id)}-heading">
  <h3 id="${esc(document.id)}-heading" class="mono">${esc(document.path)}</h3>
  <p class="document-verdict">Document verdict: ${esc(document.verdict)}</p>
  ${document.rows.length === 0
    ? `<p>No rule coverage rows were produced for this document.</p>`
    : `<div class="coverage-list" aria-label="Rule coverage for ${esc(document.path)}">
${document.rows.map((row) => `<dl class="coverage-record${row.ok ? "" : " short"}" id="${esc(row.id)}">
  <div><dt>Rule</dt><dd><code>${esc(row.ruleId)}</code></dd></div>
  <div><dt>Candidates</dt><dd class="mono">${row.candidates}</dd></div>
  <div><dt>Measured</dt><dd class="mono">${row.measured}</dd></div>
  <div><dt>Not measured</dt><dd class="mono">${row.notMeasured}</dd></div>
  <div><dt>Coverage / floor</dt><dd class="mono">${esc(row.ratio)} / ${esc(row.floor)}</dd></div>
  <div><dt>Result</dt><dd class="coverage-result${row.ok ? "" : " short"}">${row.ok ? "Coverage met" : "Below floor"}</dd></div>
</dl>`).join("\n")}
</div>`}
</article>
</li>`).join("\n")}
</ol>`;
  return `<section aria-labelledby="coverage-heading">
<div class="section-heading">
  <h2 id="coverage-heading">Coverage details</h2>
  <p class="section-lead">Coverage is reported for every rule and document, including zero-candidate rules.</p>
</div>
${documents}
</section>`;
}

/**
 * A self-contained, script-free projection of the canonical JSON report. The report is designed
 * around evidence reading: status and gate first, vertical finding grammar second, per-document
 * coverage last. No HTML state is allowed to turn an incomplete run into clean-run language.
 */
export function renderHtml(report: Report): string {
  const model = buildHtmlReportModel(report);
  const f = model.facts;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
<title>breaklint report · ${esc(model.status.title)}</title>
<style>${REPORT_HTML_STYLES}</style>
</head>
<body>
<main id="report">
<header class="report-header state-${esc(model.status.key)}" aria-labelledby="report-title">
  <div class="tool-line"><strong>${esc(report.tool.name)}</strong><span>v${esc(report.tool.version)} · report schema ${report.schemaVersion}</span></div>
  <span class="state-marker">${esc(model.status.marker)} · EXIT ${report.exitCode}</span>
  <h1 id="report-title">${esc(model.status.title)}</h1>
  <p class="status-sentence">${esc(model.status.sentence)}</p>
  <p class="gate-effect"><span>Gate effect</span><strong>${esc(model.status.gate)}</strong></p>
</header>

<section aria-labelledby="summary-heading">
<h2 id="summary-heading">Run summary</h2>
<dl class="summary-grid">
  <div><dt>Coverage trust</dt><dd>${esc(model.coverageTrust.label)}<small>${esc(model.coverageTrust.detail)}</small></dd></div>
  <div><dt>Errors</dt><dd>${model.severity.error}</dd></div>
  <div><dt>Warnings</dt><dd>${model.severity.warn}</dd></div>
  <div><dt>Information</dt><dd>${model.severity.info}</dd></div>
</dl>
<dl class="run-facts">
  <div><dt>${esc(LABELS.runVerdict)}</dt><dd>${esc(f.runVerdict)}</dd></div>
  <div><dt>${esc(LABELS.gateTriggeredBy)}</dt><dd>${esc(f.gateTriggeredBy)}</dd></div>
  <div><dt>${esc(LABELS.failOn)}</dt><dd>${esc(f.failOn)}</dd></div>
  <div><dt>${esc(LABELS.mode)}</dt><dd>${esc(f.mode)}</dd></div>
  <div><dt>${esc(LABELS.inputsFound)}</dt><dd>${f.inputsFound}</dd></div>
  <div><dt>${esc(LABELS.pagesAnalysed)}</dt><dd>${f.pagesAnalysed}</dd></div>
  <div><dt>${esc(LABELS.rulesRun)}</dt><dd>${f.rulesRun}</dd></div>
  <div><dt>${esc(LABELS.measuredRules)}</dt><dd>${f.measuredRules}</dd></div>
  <div><dt>${esc(LABELS.notMeasuredTotal)}</dt><dd>${f.notMeasuredTotal}</dd></div>
  <div><dt>Finding gate candidate</dt><dd>${esc(report.summary.gateCandidate ?? "none")}</dd></div>
  <div><dt>Source</dt><dd>${esc(report.source)}</dd></div>
  <div><dt>Configuration</dt><dd class="mono">${esc(report.config.fingerprint)}</dd></div>
</dl>
</section>

${renderInfrastructure(model)}
${renderCoverageAlert(model)}
${renderFindings(model)}
${renderCoverage(model)}

<footer class="report-footer">
  <p>Generated by ${esc(report.tool.name)} ${esc(report.tool.version)}. JSON remains the canonical report.</p>
</footer>
</main>
</body>
</html>
`;
}

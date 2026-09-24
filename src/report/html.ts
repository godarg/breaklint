import type { Report } from "../core/types.ts";
import { LABELS } from "./mandatory.ts";
import { buildHtmlReportModel } from "./html-model.ts";
import { REPORT_HTML_STYLES } from "./html-styles.ts";

/**
 * A CSS string literal for text the report does not control (the run id is caller-supplied through
 * the API). HTML escaping is no protection inside <style>: `";}body{display:none}/*` or
 * `</style>` would end the string or the element. Only `[A-Za-z0-9 ._:/-]` is emitted literally;
 * every other code point becomes a six-digit hex escape followed by the one space CSS consumes as
 * its terminator, so no quote, brace, semicolon, backslash, `<` or line break survives. The value
 * is truncated to `maxCodePoints` first.
 */
export function cssString(value: string, maxCodePoints = 64): string {
  const codePoints = [...value];
  const shown = codePoints.length > maxCodePoints ? [...codePoints.slice(0, maxCodePoints - 1), "…"] : codePoints;
  const body = shown.map((character) => /^[A-Za-z0-9 ._:/-]$/u.test(character)
    ? character
    : `\\${character.codePointAt(0)!.toString(16).toUpperCase().padStart(6, "0")} `).join("");
  return `"${body}"`;
}

/**
 * Page furniture for print, generated per report: "Page N of M" on every page, and from page 2 a
 * running head with the verdict and the report's run id, in the 12 mm @page margin (so the content
 * box and its 703 px layout contract are untouched). Page 1 carries the full header instead.
 */
function renderPageMargins(report: Report, title: string): string {
  const head = cssString(`breaklint · ${title} · exit ${report.exitCode}`, 80);
  const run = cssString(`run ${report.runId}`, 52);
  return `
  @page {
    @top-left { content: ${head}; font: 8pt/1.2 var(--bl-font-mono); color: var(--bl-color-fg-muted); vertical-align: middle; }
    @top-right { content: ${run}; font: 8pt/1.2 var(--bl-font-mono); color: var(--bl-color-fg-muted); vertical-align: middle; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt/1.2 var(--bl-font-mono); color: var(--bl-color-fg-muted); vertical-align: middle; }
  }
  @page :first {
    @top-left { content: none; }
    @top-right { content: none; }
  }
`;
}

const esc = (value: unknown): string =>
  String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

/**
 * A rule id as code that may break only after its namespace slash (`layout/` + name) on a narrow
 * screen, never inside the name at a hyphen; print keeps it on one line. `<wbr>` adds no character,
 * so the copied text is the id unchanged.
 */
function ruleIdCode(ruleId: string): string {
  const slash = ruleId.indexOf("/");
  if (slash < 0) return `<code class="rule-id"><span>${esc(ruleId)}</span></code>`;
  return `<code class="rule-id"><span>${esc(ruleId.slice(0, slash + 1))}</span><wbr><span>${esc(ruleId.slice(slash + 1))}</span></code>`;
}

/**
 * A command the reader may run, as one `<code class="cli-flag">`. It never breaks inside the flag or
 * the rule name; on a narrow screen the only permitted break is after the rule's namespace slash,
 * and print keeps the whole command on one line.
 */
function renderOption(option: ReturnType<typeof buildHtmlReportModel>["coverage"][number]["rows"][number]["options"][number]): string {
  if (option.command === null) return esc(option.before);
  const slash = option.command.lastIndexOf("/");
  const command = slash < 0
    ? `<code class="cli-flag"><span>${esc(option.command)}</span></code>`
    : `<code class="cli-flag"><span>${esc(option.command.slice(0, slash + 1))}</span><wbr><span>${esc(option.command.slice(slash + 1))}</span></code>`;
  return `${esc(option.before)}${command}${esc(option.after)}`;
}

function renderInfrastructure(model: ReturnType<typeof buildHtmlReportModel>): string {
  if (model.infrastructure.length === 0 && model.status.key !== "infrastructure") return "";
  const fatal = model.status.key === "infrastructure";
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
  return `<section class="apparatus-section" aria-labelledby="apparatus-heading">
<h2 id="apparatus-heading">${fatal ? "Checker failure" : "Measurement apparatus"}</h2>
${fatal
    ? `<div class="state-alert">
  <p><strong>This is not a clean run.</strong> Fix the checker failure and run the same command again.</p>
</div>`
    : `<p>These non-fatal diagnostics and second-opinion checks did not change the run verdict or exit code.</p>`}
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
    : `<ul class="coverage-shortfall-list">${shortfalls.map((row) => `<li class="coverage-shortfall-item">
      <p><strong>Rule:</strong> ${ruleIdCode(row.ruleId)} in <span class="mono">${esc(row.document)}</span></p>
      <p><strong>Measurement:</strong> ${row.measured} of ${row.candidates} candidates measured (${esc(row.ratio)}); required floor ${esc(row.floor)}</p>
      <p><strong>Reason verbatim:</strong> <code>${esc(row.reasons.join(", ") || "none declared")}</code></p>
      <p><strong>Options:</strong></p>
      <ul>
        ${row.options.map((option) => `<li>${renderOption(option)}</li>`).join("\n        ")}
      </ul>
    </li>`).join("\n")}</ul>`}
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
  <p>${model.status.key === "clean" ? "No finding was recorded, so nothing is listed here." : "The run ended before a trustworthy finding list existed."}</p>
</div>`
    : `<ol class="finding-list">
${model.findings.map((finding) => `<li>
<article class="finding ${esc(finding.severity)}" id="${esc(finding.id)}" aria-labelledby="${esc(finding.id)}-title">
  <div class="finding-head">
  <div class="finding-kicker">
    <span class="severity ${esc(finding.severity)}">${esc(finding.severityLabel)}</span>
    ${finding.experimental ? `<span class="experimental">Experimental</span>` : ""}
  </div>
  <h3 id="${esc(finding.id)}-title">${ruleIdCode(finding.ruleId)} · page ${finding.page}</h3>
  <p class="finding-message">${esc(finding.message)}</p>
  </div>
  <dl class="finding-facts">
    <div><dt>Document</dt><dd class="mono">${esc(finding.document)}</dd></div>
    <div><dt>Source</dt><dd class="mono">${finding.source ? esc(finding.source) : "Unknown — no source location was measured"}</dd></div>
    <div><dt>Measured</dt><dd class="mono">${esc(finding.measured)}</dd></div>
    <div><dt>Threshold</dt><dd class="mono">${esc(finding.threshold)}</dd></div>
    <div><dt>Calibration</dt><dd>${esc(finding.calibration)}</dd></div>
    <div><dt>Proof source</dt><dd>${finding.proofSource ? esc(finding.proofSource) : "None declared"}</dd></div>
  </dl>
  <div class="finding-tail">
  ${finding.remediation ? `<div class="finding-remediation"><p><strong>Remediation</strong>${finding.remediationTested === false ? ` <span class="untested-marker">untested</span>` : ""} ${esc(finding.remediation)}</p></div>` : ""}
  ${finding.frequencyNote ? `<div class="finding-frequency-note"><p><strong>Note:</strong> ${esc(finding.frequencyNote)}</p></div>` : ""}
  ${renderFindingEvidence(finding)}
  ${finding.ambiguity ? `<p class="evidence-state"><strong>Ambiguity:</strong> ${esc(finding.ambiguity)}</p>` : ""}
  </div>
</article>
</li>`).join("\n")}
</ol>`;

  const { untested, withAdvice } = model.remediationSummary;
  // Stated once, at body size and colour, where the reader meets the findings; each finding then
  // carries only a compact marker.
  const caveat = untested === 0
    ? ""
    : `\n  <p class="remediation-caveat"><strong>Remediation advice in this report is untested.</strong> No trigger/remedied pair in this package shows it removing its finding; this applies to ${untested} of ${withAdvice} finding${withAdvice === 1 ? "" : "s"} with advice, each marked <span class="untested-marker">untested</span> in its remediation box.</p>`;
  return `<section class="findings-section${model.findings.length === 0 ? " findings-empty" : ""}" aria-labelledby="findings-heading">
<div class="section-heading">
  <h2 id="findings-heading">Findings</h2>
  <p class="section-lead">${esc(model.findingsLead)}</p>${caveat}
</div>
${list}
</section>`;
}

type HtmlCoverageRow = ReturnType<typeof buildHtmlReportModel>["coverage"][number]["rows"][number];

const COVERAGE_COLUMNS = `<tr>
    <th scope="col" class="rule">Rule</th>
    <th scope="col" class="num">Candi&shy;dates</th>
    <th scope="col" class="num">Measured</th>
    <th scope="col" class="num">Not measured</th>
    <th scope="col" class="num">Coverage</th>
    <th scope="col" class="num">Floor</th>
    <th scope="col" class="result">Result</th>
  </tr>`;

function renderCoverageRow(row: HtmlCoverageRow): string {
  const ratio = row.ratio === "Not applicable"
    ? `<abbr title="Not applicable: no candidates">n/a</abbr>`
    : esc(row.ratio);
  return `<tr id="${esc(row.id)}"${row.ok ? "" : ` class="short"`}>
    <th scope="row" class="rule">${ruleIdCode(row.ruleId)}</th>
    <td class="num">${row.candidates}</td>
    <td class="num">${row.measured}</td>
    <td class="num">${row.notMeasured}</td>
    <td class="num">${ratio}</td>
    <td class="num">${esc(row.floor)}</td>
    <td class="result"><span class="coverage-result${row.ok ? "" : " short"}">${row.ok ? "Coverage met" : "Below floor"}</span></td>
  </tr>`;
}

/**
 * One aligned table per document: rule id as the row header, the counts, coverage and floor as
 * right-aligned numeric columns, the result as text. It replaced one six-label card per rule
 * (13 rules, 78 repeated labels, five printed pages).
 *
 * The last two rows are a second `tbody` that may not break, so a printed table never continues
 * onto a page with a single row. Rows are single-line and small, so which remainder reaches the
 * terminal page depends on content far above the section; the bracket makes that phase harmless at
 * no flow-height cost. `break-before: avoid` on the last row would say the same thing directly, and
 * Blink does not honour avoid-between-siblings here (see `.apparatus-section` in html-styles.ts).
 */
function renderCoverageTable(document: ReturnType<typeof buildHtmlReportModel>["coverage"][number]): string {
  const rows = document.rows.map(renderCoverageRow);
  const body = rows.length < 3
    ? `<tbody>\n  ${rows.join("\n  ")}\n</tbody>`
    : `<tbody>\n  ${rows.slice(0, -2).join("\n  ")}\n</tbody>\n<tbody class="coverage-tail">\n  ${rows.slice(-2).join("\n  ")}\n</tbody>`;
  return `<table class="coverage-table" id="${esc(document.id)}">
<caption><span class="coverage-path mono">${esc(document.path)}</span> <span class="document-verdict">Document verdict: ${esc(document.verdict)}</span></caption>
<thead>
  ${COVERAGE_COLUMNS}
</thead>
${body}
</table>`;
}

function renderCoverage(model: ReturnType<typeof buildHtmlReportModel>): string {
  const documents = model.coverage.length === 0
    ? `<div class="empty-state"><h3>Coverage unavailable</h3><p>No document coverage was produced by this run.</p></div>`
    : `<div class="coverage-documents">
${model.coverage.map((document) => document.rows.length === 0
    ? `<div class="empty-state" id="${esc(document.id)}"><h3 class="mono">${esc(document.path)}</h3><p>Document verdict: ${esc(document.verdict)}. No rule coverage rows were produced for this document.</p></div>`
    : renderCoverageTable(document)).join("\n")}
</div>`;
  return `<section class="coverage-section" aria-labelledby="coverage-heading">
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
/**
 * In-page contents, in document order, for exactly the sections this report renders. On a phone
 * the findings start about three screens down and coverage about twelve; the contents navigation
 * reaches both from the first screen.
 */
function renderContents(model: ReturnType<typeof buildHtmlReportModel>): string {
  const entries: [string, string][] = [["summary-heading", "Run summary"]];
  if (model.infrastructure.length > 0 || model.status.key === "infrastructure") {
    entries.push(["apparatus-heading", model.status.key === "infrastructure" ? "Checker failure" : "Measurement apparatus"]);
  }
  if (model.status.key === "insufficient-coverage") entries.push(["coverage-alert-heading", "Coverage did not meet the contract"]);
  entries.push(["findings-heading", `Findings (${model.findings.length})`]);
  entries.push(["coverage-heading", "Coverage details"]);
  return `<nav class="report-contents" aria-label="Report contents">
  <ol>
    ${entries.map(([target, label]) => `<li><a href="#${target}">${esc(label)}</a></li>`).join("\n    ")}
  </ol>
</nav>`;
}

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
<style>${renderPageMargins(report, model.status.title)}</style>
</head>
<body>
<a class="skip-link" href="#report">Skip to the report</a>
<div class="report-shell">
<header class="report-header state-${esc(model.status.key)}" aria-labelledby="report-title">
  <div class="tool-line"><strong>${esc(report.tool.name)}</strong><span>v${esc(report.tool.version)} · report schema ${report.schemaVersion} · run <span class="run-id">${esc(report.runId)}</span></span></div>
  <span class="state-marker">${esc(model.status.marker)} · EXIT ${report.exitCode}</span>
  <h1 id="report-title">${esc(model.status.title)}</h1>
  <p class="status-sentence">${esc(model.status.sentence)}</p>
  <p class="gate-effect"><span>Gate effect</span><strong>${esc(model.status.gate)}</strong></p>
</header>
${renderContents(model)}
<main id="report">
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
</main>
<footer class="report-footer">
  <p><strong>End of report.</strong> Generated by ${esc(report.tool.name)} ${esc(report.tool.version)} · run <span class="run-id">${esc(report.runId)}</span>. JSON remains the canonical report.</p>
</footer>
</div>
</body>
</html>
`;
}

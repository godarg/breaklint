import type { Report } from "../core/types.ts";
import { LABELS, mandatoryFacts } from "./mandatory.ts";
import { emptyStateSentence, infraLines } from "./infra.ts";

const esc = (s: string) =>
  String(s).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

/**
 * The HTML report.
 *
 * Self-contained: the stylesheet is inline, there is no font import, no script and no external
 * request. A report about a document's layout that itself pulls a resource off the network is
 * making a claim it has not measured — and in an offline CI it would simply arrive unstyled.
 *
 * The typography here is not decoration. This file is one of the inputs to the project's own
 * check: the generated report has to pass breaklint's own error rules. A widow in the report of
 * a widow checker is a public self-refutation that a stranger finds in seconds.
 */
export function renderHtml(report: Report): string {
  const f = mandatoryFacts(report);
  const rows = report.findings
    .map(
      (x) => `<tr class="sev-${esc(x.severity)}">
      <td>${esc(x.severity)}${x.experimental ? ' <span class="tag">experimental</span>' : ""}</td>
      <td><code>${esc(x.ruleId)}</code></td>
      <td class="num">${x.page}</td>
      <td class="num">${esc(String(x.measurement.value))} ${esc(x.measurement.unit)}</td>
      <td class="num">${esc(String(x.measurement.threshold))} ${esc(x.measurement.unit)}</td>
      <td>${x.source ? esc(`${x.source.file}:${x.source.line}`) : "<em>unknown</em>"}</td>
    </tr>
    <tr class="detail"><td colspan="6">${esc(x.message)}</td></tr>`,
    )
    .join("\n");

  // The checker's own failures, before the findings. This reporter printed the clean-run
  // sentence on an exit-3 run until an audit measured it — the console fix had been applied to
  // the console only.
  const infra = infraLines(report);
  const infraSection =
    infra.length === 0
      ? ""
      : `<h2>Checker</h2>\n<div class="scroll"><table>\n` +
        `<thead><tr><th>kind</th><th>document</th><th>detail</th><th>measured</th></tr></thead>\n<tbody>\n` +
        infra
          .map(
            (l) =>
              `<tr><td>${esc(l.kind)}</td><td>${esc(l.document)}</td><td>${esc(l.detail)}</td>` +
              `<td>${esc(l.measured.join("; ")) || "&mdash;"}</td></tr>`,
          )
          .join("\n") +
        `\n</tbody></table></div>`;

  const coverageRows = report.documents
    .flatMap((doc) =>
      Object.entries(doc.coverage).map(
        ([ruleId, c]) => `<tr${c.ok ? "" : ' class="short"'}>
      <td><code>${esc(ruleId)}</code></td>
      <td class="num">${c.candidates}</td><td class="num">${c.measured}</td>
      <td class="num">${c.notMeasuredCount}</td><td class="num">${c.floor}</td>
      <td>${c.ok ? "yes" : "<strong>no</strong>"}</td>
    </tr>`,
      ),
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>breaklint report — ${esc(f.runVerdict)}</title>
<style>
  :root { color-scheme: light dark; --fg: #14171a; --bg: #fff; --muted: #5b6570;
          --line: #d8dde3; --err: #a3121a; --warn: #7a5200; --info: #0b5a75; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6e9ec; --bg: #14171a; --muted: #9aa4ae; --line: #2b3138;
            --err: #ff8a8a; --warn: #e8c07a; --info: #7fd3ef; }
  }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 62rem;
         font: 400 16px/1.55 ui-serif, Georgia, "Times New Roman", serif;
         color: var(--fg); background: var(--bg); }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 .25rem; letter-spacing: -0.01em; }
  h2 { font-size: 1.125rem; margin: 2.5rem 0 .75rem; }
  .lede { color: var(--muted); margin: 0 0 2rem; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 1rem; font-size: .9375rem; }
  th, td { text-align: left; padding: .5rem .625rem; border-bottom: 1px solid var(--line);
           vertical-align: top; }
  th { font-weight: 600; font-size: .8125rem; letter-spacing: .02em; color: var(--muted);
       text-transform: uppercase; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  code { font: 400 .875em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  tr.sev-error td:first-child { color: var(--err); font-weight: 600; }
  tr.sev-warn  td:first-child { color: var(--warn); font-weight: 600; }
  tr.sev-info  td:first-child { color: var(--info); font-weight: 600; }
  tr.detail td { border-bottom: 2px solid var(--line); color: var(--muted);
                 font-size: .875rem; padding-top: 0; }
  tr.short td { background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .tag { font-size: .6875rem; text-transform: uppercase; letter-spacing: .04em;
         color: var(--muted); border: 1px solid var(--line); border-radius: 3px;
         padding: 0 .25rem; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
           gap: .75rem 1.5rem; margin: 0 0 2rem; padding: 1rem 0; border-block: 1px solid var(--line); }
  .facts div { font-size: .875rem; }
  .facts dt { color: var(--muted); font-size: .75rem; text-transform: uppercase;
              letter-spacing: .03em; }
  .facts dd { margin: 0; font-variant-numeric: tabular-nums; }
  .empty { padding: 1.25rem 0; }
  /* Wide content scrolls inside its own box; the page itself never scrolls sideways. */
  .scroll { overflow-x: auto; }
</style>
</head>
<body>
<h1>breaklint — ${esc(f.runVerdict)}</h1>
<p class="lede">${esc(report.tool.name)} ${esc(report.tool.version)} · mode ${esc(f.mode)} · source ${esc(report.source)}</p>

<dl class="facts">
  <div><dt>${esc(LABELS.runVerdict)}</dt><dd>${esc(f.runVerdict)}</dd></div>
  <div><dt>${esc(LABELS.inputsFound)}</dt><dd>${f.inputsFound}</dd></div>
  <div><dt>${esc(LABELS.pagesAnalysed)}</dt><dd>${f.pagesAnalysed}</dd></div>
  <div><dt>${esc(LABELS.rulesRun)}</dt><dd>${f.rulesRun}</dd></div>
  <div><dt>${esc(LABELS.measuredRules)}</dt><dd>${f.measuredRules}</dd></div>
  <div><dt>${esc(LABELS.notMeasuredTotal)}</dt><dd>${f.notMeasuredTotal}</dd></div>
  <div><dt>${esc(LABELS.failOn)}</dt><dd>${esc(f.failOn)}</dd></div>
  <div><dt>${esc(LABELS.gateTriggeredBy)}</dt><dd>${esc(f.gateTriggeredBy)}</dd></div>
</dl>

${infraSection}
<h2>Findings</h2>
${
  report.findings.length === 0
    ? `<p class="empty">${esc(emptyStateSentence(report))}</p>`
    : `<div class="scroll"><table>
<thead><tr><th>severity</th><th>rule</th><th>page</th><th>measured</th><th>threshold</th><th>source</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>`
}

<h2>Coverage</h2>
<div class="scroll"><table>
<thead><tr><th>rule</th><th>candidates</th><th>measured</th><th>not measured</th><th>floor</th><th>ok</th></tr></thead>
<tbody>
${coverageRows}
</tbody></table></div>
</body>
</html>
`;
}

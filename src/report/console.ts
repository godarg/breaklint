import type { Finding, Report } from "../core/types.ts";
import { summaryLine } from "./mandatory.ts";
import { emptyStateSentence, infraLines } from "./infra.ts";

const ESC = "[";
const RESET = `${ESC}0m`;

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

  for (const doc of report.documents) {
    for (const finding of doc.findings) out.push(renderFinding(finding, paint));
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

  if (report.findings.length === 0) {
    // The empty state has to say what was checked. A tool that prints nothing when it passed
    // and nothing when it did nothing reports its own idleness as success — and that is a
    // silent failure wearing the costume of a clean run. `emptyStateSentence` also refuses the
    // clean-run wording for an infrastructure verdict, identically in all six reporters.
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
  const lines = [
    `${paint(code, f.severity.padEnd(5))} ${f.ruleId}  page ${f.page}`,
    `  measured   ${m.value} ${m.unit}; threshold ${m.threshold} ${m.unit}` +
      `${m.calibrated ? "" : " (uncalibrated)"}`,
    `  detail     ${f.message}`,
    `  source     ${f.source ? `${f.source.file}:${f.source.line}` : "unknown (node produced by the paginator)"}`,
    `  render     ${f.evidence.ref ?? "unknown (no evidence produced)"}` +
      `${f.evidence.ref && !f.evidence.bindsFinding ? " — evidence shows the PDF, not this finding" : ""}`,
  ];
  if (f.ambiguity) {
    lines.push(
      `  ambiguity  ${f.ambiguity.groupSize} findings share this fingerprint and cannot be told apart`,
    );
  }
  return lines.join("\n");
}

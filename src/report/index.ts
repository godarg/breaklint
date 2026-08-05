import type { OutputFormat } from "../core/enums.ts";
import type { Report } from "../core/types.ts";
import { renderJson } from "./json.ts";
import { renderConsole } from "./console.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderJunit } from "./junit.ts";
import { renderSarif } from "./sarif.ts";
import { renderHtml } from "./html.ts";
import { redactReport } from "./redact.ts";

/**
 * One reporter module. `--demo` and the live path both come through here, nothing else.
 *
 * The redaction sits HERE rather than in each reporter, because it is the one place all six share
 * and a per-reporter guard is a guard five people can forget. It was added after a repair leaked
 * an absolute path: projecting infrastructure events to the console was right, but the projection
 * printed `InfraEvent.measured` raw and the resolved browser path lives in that field. A report is
 * something a user pastes into an issue.
 *
 * It runs on the REPORT and not on the rendered text, and the order is the whole property. Applied
 * to text, the search had to know every spelling each reporter produces — JSON escaping, XML
 * escaping, markdown's pipe escape, the newline flattening in `infra.ts`, and any cut a length cap
 * had already made through the middle of a path. Two rounds were spent adding spellings one at a
 * time. Applied to the report, there is nothing between `homedir()` and the match, so a seventh
 * reporter or a new escape cannot reopen it. See `redact.ts` for the measurement.
 */
export function render(report: Report, format: OutputFormat, opts: { colour?: boolean } = {}): string {
  return renderRaw(redactReport(report), format, opts);
}

function renderRaw(report: Report, format: OutputFormat, opts: { colour?: boolean }): string {
  switch (format) {
    case "json":
      return renderJson(report);
    case "console":
      return renderConsole(report, opts);
    case "markdown":
      return renderMarkdown(report);
    case "junit":
      return renderJunit(report);
    case "sarif":
      return renderSarif(report);
    case "html":
      return renderHtml(report);
  }
}

export { renderJson, renderConsole, renderMarkdown, renderJunit, renderSarif, renderHtml };

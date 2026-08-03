import type { OutputFormat } from "../core/enums.ts";
import type { Report } from "../core/types.ts";
import { renderJson } from "./json.ts";
import { renderConsole } from "./console.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderJunit } from "./junit.ts";
import { renderSarif } from "./sarif.ts";
import { renderHtml } from "./html.ts";

/** One reporter module. `--demo` and the live path both come through here, nothing else. */
export function render(report: Report, format: OutputFormat, opts: { colour?: boolean } = {}): string {
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

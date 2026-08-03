import type { Report } from "../core/types.ts";

/** The canonical format. Everything else is a projection of this, never a parallel source. */
export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}

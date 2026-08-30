/**
 * The apparatus speaking about itself, in a form every reporter can project.
 *
 * This module exists because the same defect was found twice in two rounds. First: a run that
 * exited 3 printed `checked 0 pages in 1 document, no findings` on the console and named its
 * cause nowhere. That was repaired — in ONE of six reporters. An audit then measured the rest:
 *
 *   markdown  "Checked 0 pages in 1 documents. No findings."     the wording of a clean run
 *   html      <p class="empty">…No findings.</p>                  the same, verbatim
 *   junit     <testsuites tests="0" failures="0">                 a CI system reads this GREEN
 *   sarif     executionSuccessful:false, but no kind and no reason
 *
 * The repair had generalised over the reporter it was written in rather than over the property it
 * was about. So the projection lives here, once, and every reporter calls it.
 *
 * A second finding shapes the formatting: the console projection printed `measured` as one raw
 * `JSON.stringify` line, and a `render-unstable` over fifty divergent pages produced a single
 * 7 488-character line. `measured` grows with the document, so a book-length divergence yields a
 * five-figure line that no terminal and no reader can use.
 *
 * WHERE THE CAPS APPLY, stated because it was once claimed too widely. Five of the six formats
 * project through this module and are capped. `json` does not: `renderJson` serialises the report
 * itself, so it carries `detail` and `measured` at full length. That is deliberate — the JSON is
 * the canonical format and every other one is a lossy projection of it, and a truncated canonical
 * record would be a record that lost the thing a reader went to it for. The claim "capped in all
 * six reporters" was made once and is withdrawn; the property is five of six, by design, and the
 * test pins both halves.
 */

import type { DocumentReport, InfraEvent, Report } from "../core/types.ts";
import { IS } from "../core/enums.ts";

export type InfraLineLevel = "error" | "warning" | "note";

/** One event, flattened for projection. `document` is the path the event belongs to. */
export interface InfraLine {
  document: string;
  kind: string;
  detail: string;
  /** Fatality is the engine contract, not something each reporter may infer from mere presence. */
  fatal: boolean;
  /** Projection level: fatal=error, successful oracle evidence=note, other non-fatal diagnostics=warning. */
  level: InfraLineLevel;
  /** `measured`, rendered as short `key=value` pairs. Long collections are summarised, not dumped. */
  measured: string[];
}

/** Beyond this many entries a collection is summarised. A reader cannot use fifty rows inline. */
export const MAX_COLLECTION_ENTRIES = 3;
/**
 * Beyond this many characters a single value inside `measured` is truncated.
 *
 * This constant was unreachable for one round. `renderValue` called `oneLine` first, which caps at
 * `MAX_DETAIL_CHARS`, so nothing could still exceed 160 by the time the comparison ran — the
 * constant could be raised to 10 000 with the whole suite green, and the truncation it names never
 * fired. The flattening and the capping are separate operations now, and each cap is applied once
 * at its own limit.
 */
export const MAX_VALUE_CHARS = 160;
/**
 * Beyond this many characters `detail` is truncated.
 *
 * The first version of this module capped `measured` and left `detail` alone — and the same page
 * list travels in BOTH. `evidence.ts` builds its divergence detail with `pages.join(", ")`, so
 * fifty divergent pages produce a ~490-character sentence and five hundred produce ~2 900. The
 * cap on collections took the worst line from 7 488 to 505 characters and the test that was
 * supposed to prove it used an 18-character stub, so it measured 185 and passed a 400-character
 * threshold that the real payload violates.
 */
export const MAX_DETAIL_CHARS = 220;

/**
 * Make a string safe to place on one line of any of the six formats.
 *
 * Newlines: markdown escapes `|` but has no escape for a line break, so one `\n` in `detail`
 * turns one table row into three and destroys the table. `detail` is built from arbitrary
 * `Error.message` values in `engine.ts`, so this is reachable without anything exotic.
 *
 * C0 control characters: XML 1.0 forbids most of them outright, and the junit escape helper
 * covers only `& < > "`. Measured: a U+0007 in `detail` made `xmllint --noout` reject the report
 * as not well-formed. They are replaced rather than escaped, because no reader wants them.
 */
function flatten(text: string): string {
  // eslint-disable-next-line no-control-regex -- the point is to remove exactly these
  const flattened = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ").replace(/[\r\n]+/gu, " ");
  return flattened;
}

/**
 * Cut to `limit`, and say how long the original was.
 *
 * The length disclosure is the point of the cut rather than decoration: a bare ellipsis tells a
 * reader that something was removed and not whether it was ten characters or ten thousand. The
 * previous version applied two caps in sequence and the second one sliced the first one's
 * disclosure back off, so a long value ended in an ellipsis with no size attached.
 *
 * The cut never falls inside a surrogate pair. Measured before this: 219 ASCII characters followed
 * by U+1F600 left one lone surrogate, which Node writes out as U+FFFD — mojibake in the last
 * character of any truncated value that happens to end on an astral character.
 */
function cap(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const end = /[\uD800-\uDBFF]/u.test(text[limit - 1] ?? "") ? limit - 1 : limit;
  return `${text.slice(0, end)}… (${text.length} chars)`;
}

function oneLine(text: string): string {
  return cap(flatten(text), MAX_DETAIL_CHARS);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) {
    // The COUNT is the fact a reader needs from a long collection; the first few entries are
    // orientation. Printing all of them is how the 7 488-character line happened.
    if (value.length > MAX_COLLECTION_ENTRIES) {
      const head = value.slice(0, MAX_COLLECTION_ENTRIES).map((v) => renderValue(v)).join(", ");
      return `[${value.length} entries: ${head}, …]`;
    }
    return `[${value.map((v) => renderValue(v)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_COLLECTION_ENTRIES) return `{${entries.length} fields}`;
    return `{${entries.map(([k, v]) => `${k}=${renderValue(v)}`).join(" ")}}`;
  }
  // Flatten first, then cut once at THIS limit. Calling `oneLine` here applied the longer
  // `detail` cap before the shorter value cap could be reached, which made `MAX_VALUE_CHARS`
  // unreachable and threw away the length disclosure the first cut had added.
  return cap(flatten(String(value)), MAX_VALUE_CHARS);
}

export function infraLines(report: Report): InfraLine[] {
  const lines: InfraLine[] = [];
  for (const doc of report.documents as DocumentReport[]) {
    for (const event of doc.infrastructure as InfraEvent[]) {
      const fatal = !IS.nonFatalInfraEventKind.has(event.kind);
      lines.push({
        document: doc.path,
        kind: event.kind,
        detail: oneLine(event.detail),
        fatal,
        level: fatal ? "error" : event.kind === "geometry-cross-check-passed" ? "note" : "warning",
        measured: event.measured
          ? Object.entries(event.measured).map(([key, value]) => `${key}=${renderValue(value)}`)
          : [],
      });
    }
  }
  return lines;
}

/**
 * The empty-state sentence, or the refusal to use it.
 *
 * "No findings" is only true when the tool looked. Where the verdict is `infrastructure` it did
 * not, and saying so in the words of a clean run is the same failure the empty state was built to
 * prevent — one level up. Returned as a sentence so all six reporters phrase it identically.
 */
export function emptyStateSentence(report: Report): string {
  if (report.runVerdict === "infrastructure") {
    return (
      `Checked nothing: the run stopped before it could measure ${report.inputsFound} ` +
      `document${report.inputsFound === 1 ? "" : "s"}. This is not a clean result.`
    );
  }
  return (
    `Checked ${report.pagesAnalysed} page${report.pagesAnalysed === 1 ? "" : "s"} in ` +
    `${report.inputsFound} document${report.inputsFound === 1 ? "" : "s"}. No findings.`
  );
}

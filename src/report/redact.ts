/**
 * Absolute paths must not reach a report.
 *
 * A report is something a user pastes into an issue. An absolute path in it carries the account
 * name of whoever ran the tool, and this project treats `/Users/…` as a hard blocklist item
 * rather than a matter of taste.
 *
 * This file exists because a repair introduced the leak it now prevents. Projecting infrastructure
 * events to the console was right — the reason for an exit 3 had been reaching the JSON and never
 * a human — but the projection printed `InfraEvent.measured` raw, and `render-run.ts` puts the
 * resolved browser path in there. The realistic trigger is not exotic: a puppeteer-cached Chrome
 * lives under the user's home directory, and `$BREAKLINT_CHROME` is a documented option. Before
 * the projection existed the field never reached a reader, so the leak arrived WITH the fix.
 *
 * The redaction is deliberately not clever. It does not try to recognise "sensitive" paths; it
 * replaces the home directory of the running user and the two platform-generic user roots with a
 * marker, and it does so on the STRING the reporter is about to emit, which is the last point
 * where every reporter shares a code path.
 */

import { homedir } from "node:os";

/** What replaces the redacted prefix. Visible on purpose: a silent elision reads as a full path. */
export const REDACTION = "~";

/**
 * The roots to redact, longest first so that a nested match cannot be shadowed by a shorter one.
 *
 * `homedir()` is the accurate answer for the running user; the two literals cover the case where
 * a path was produced somewhere other than this machine — a recorded fixture, a report generated
 * in CI and read locally — which is exactly when nobody thinks to look.
 */
function roots(): string[] {
  const home = homedir();
  const list = [home, "/Users", "/home"].filter((r) => r.length > 1);
  return [...new Set(list)].sort((a, b) => b.length - a.length);
}

/**
 * Replace absolute user paths in a string.
 *
 * `/Users/name/x` and `/home/name/x` become `~/x`: the account name goes with the prefix, because
 * the segment after the root IS the account name and leaving it would defeat the point.
 */
export function redactPaths(text: string): string {
  let out = text;
  const home = homedir();
  if (home.length > 1) out = out.split(home).join(REDACTION);
  for (const root of ["/Users", "/home"]) {
    // Drop the account segment with the root: /Users/someone/rest -> ~/rest
    out = out.replace(new RegExp(`${root}/[^/\\s"'\`,;:)\\]}]+`, "gu"), REDACTION);
  }
  return out;
}

/** True when a string still contains an absolute user path. Used by the gate, not by reporters. */
export function hasAbsoluteUserPath(text: string): boolean {
  return /(?:\/Users\/|\/home\/)[^/\s"'`,;:)\]}]+/u.test(text) || (homedir().length > 1 && text.includes(homedir()));
}

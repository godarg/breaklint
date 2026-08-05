/**
 * The only two places this program writes to a terminal.
 *
 * WHY THIS FILE EXISTS. The path redaction was fixed twice and was still open a third time. The
 * first version searched rendered text, and every reporter transformed the path into a spelling it
 * did not contain. The second moved the redaction onto the report object, before any reporter, and
 * that claim held under twenty hostile home shapes — but it held for `render()`, and `render()` is
 * not the only thing that writes to a terminal. An audit measured three messages that reach the
 * user with the home directory intact, none of them going through a reporter at all:
 *
 *     breaklint: no renderer available.
 *       looked in: $BREAKLINT_CHROME (/Users/<account>/.cache/puppeteer/chrome-…/chrome)
 *
 *     breaklint: /Users/<account>/…/node_modules/pagedjs/package.json not readable.
 *     breaklint: puppeteer-core resolved at /Users/<account>/…/node_modules/puppeteer-core
 *
 * The first of those is `redact.ts`'s own stated motivating example — a puppeteer-cached Chrome
 * under the home directory — arriving by a route the redaction did not sit on. A fourth, the
 * top-level `error.stack`, carries the home in every frame of an `npx` install.
 *
 * THE POINT IS NOT THAT THESE THREE ARE NOW FIXED. Three separate repairs to this one class have
 * each closed the instance in front of them, and the third was still not the last. So the closure
 * is no longer a judgement: `tests/unit/output-routes.test.ts` scans `src/` and fails if a write
 * to stdout or stderr exists anywhere outside this file. A fourth route cannot be added without
 * the suite saying so, which is a property nobody has to remember.
 */

import { redactPaths } from "../report/redact.ts";

/** Everything the tool prints to stdout. */
export function out(text: string): void {
  process.stdout.write(redactPaths(text));
}

/** Everything the tool prints to stderr. */
export function err(text: string): void {
  process.stderr.write(redactPaths(text));
}

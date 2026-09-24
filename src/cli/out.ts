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
 *
 * A WRITE IS NOT DELIVERED WHEN `write()` RETURNS. On a pipe the operating system takes what fits
 * into the pipe buffer and Node queues the rest, so the process has to stay alive until the queue
 * has drained. The entry point used to call `process.exit()` straight after handing the report
 * over, which threw the queue away: measured, a reader behind `| cat` received the first 65 536
 * bytes of a 340 000-byte report in every format while the exit code still said 1, so the loss
 * was silent. Every write therefore records a promise that settles in its write callback, and
 * `flushOutput()` is what the entry point waits for before it exits.
 *
 * A reader that closes early (`| head`) makes the next write fail with EPIPE. The failure also
 * arrives as an `'error'` event on the stream, and an unheard `'error'` event is an uncaught
 * exception: Node then exits 1, which reads as "findings" for a run whose report nobody received.
 * The listeners below hear it and keep the first stdout failure, and the entry point turns it into
 * exit 3. A listener is not a write, so this file is still the only place that writes.
 */

import { redactPaths } from "../report/redact.ts";

/** Writes handed to a stream whose callback has not run yet. */
const pending = new Set<Promise<void>>();
/** The first failed write to stdout, which is where the report travels. */
let stdoutFailure: NodeJS.ErrnoException | null = null;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    stdoutFailure ??= error;
  });
  // A failing stderr has nowhere left to report itself. It is heard only so that it cannot crash
  // the process and replace the exit code the run actually earned.
  process.stderr.on("error", () => {});
}

function write(stream: NodeJS.WriteStream, text: string, onFailure: (error: NodeJS.ErrnoException) => void): void {
  listen();
  const settled = new Promise<void>((resolve) => {
    try {
      stream.write(text, (error) => {
        if (error) onFailure(error as NodeJS.ErrnoException);
        resolve();
      });
    } catch (error) {
      onFailure(error as NodeJS.ErrnoException);
      resolve();
    }
  });
  pending.add(settled);
  void settled.then(() => pending.delete(settled));
}

/** Everything the tool prints to stdout. */
export function out(text: string): void {
  write(process.stdout, redactPaths(text), (error) => {
    stdoutFailure ??= error;
  });
}

/** Everything the tool prints to stderr. */
export function err(text: string): void {
  write(process.stderr, redactPaths(text), () => {});
}

/**
 * Settles once every write so far has been accepted by the operating system or has failed, and
 * returns the first stdout failure, if there was one. The entry point calls this before it exits.
 */
export async function flushOutput(): Promise<NodeJS.ErrnoException | null> {
  while (pending.size > 0) await Promise.all([...pending]);
  return stdoutFailure;
}

/**
 * The home directory of the running user must not reach a report.
 *
 * A report is something a user pastes into an issue, and the account name is in the path. This
 * file exists because a repair introduced the leak it now prevents: projecting infrastructure
 * events to the console was right — the reason for an exit 3 had been reaching the JSON and never
 * a human — but the projection printed `InfraEvent.measured` raw, and `render-run.ts` puts the
 * resolved browser path in there. A puppeteer-cached Chrome lives under the home directory.
 *
 * WHAT THIS DOES NOT DO, and why the first version was wrong to try.
 *
 * The first version also rewrote any `/Users/<x>` or `/home/<x>` prefix, consuming the root AND
 * one following segment. That corrupts legitimate output, and it was measured doing so:
 *
 *     /home/img/logo.png                   ->  ~/logo.png          the `img` segment vanishes
 *     https://example.com/home/index.html  ->  https://example.com~ the whole path is destroyed
 *
 * The second case is not hypothetical. `artifact/local-uri` — the one rule whose entire purpose is
 * to report a reference the document makes — interpolates the raw URI into its message. The
 * redaction was therefore deleting the very thing the finding exists to name, in all six formats.
 *
 * So the scope is now exactly one thing: the home directory of THIS process, matched literally and
 * only at a path boundary. A path belonging to some other machine — a recorded fixture, a report
 * generated in CI and read locally — is NOT redacted, because every heuristic that would catch it
 * has to guess which segment is an account name, and guessing wrong corrupts a path that a reader
 * needs. That limit is stated here rather than papered over with a rule that looks broader and
 * silently damages output.
 *
 * `homedir()` is correct on Windows too, so a Windows run redacts its own home. A Windows path
 * from a DIFFERENT machine is not redacted, for the same reason as above.
 */

import { homedir } from "node:os";

/** What replaces the home directory. Visible on purpose: a silent elision reads as a full path. */
export const REDACTION = "~";

/**
 * The home directory, or null when there is nothing safe to match on.
 *
 * A one-character or empty home would match everywhere, so it is refused rather than applied.
 */
function home(): string | null {
  const dir = homedir();
  return typeof dir === "string" && dir.length > 1 ? dir : null;
}

/**
 * True where `text[index]` begins a home-directory occurrence that ends on a path boundary.
 *
 * Without the boundary check `/Users/anna` also matches inside `/Users/annabel/x`, which produced
 * `~bel/x` — a corrupted path carrying a residue of a second account name.
 */
function endsOnBoundary(text: string, index: number, length: number): boolean {
  const after = text[index + length];
  return after === undefined || after === "/" || after === "\\" || !/[A-Za-z0-9._-]/u.test(after);
}

/** Replace occurrences of this process's home directory with `~`. */
export function redactPaths(text: string): string {
  const dir = home();
  if (dir === null) return text;
  let out = "";
  let from = 0;
  for (;;) {
    const at = text.indexOf(dir, from);
    if (at === -1) {
      out += text.slice(from);
      return out;
    }
    if (endsOnBoundary(text, at, dir.length)) {
      out += text.slice(from, at) + REDACTION;
    } else {
      out += text.slice(from, at + dir.length);
    }
    from = at + dir.length;
  }
}

/**
 * True when a string still contains this process's home directory.
 *
 * Deliberately the SAME question `redactPaths` answers, so the gate cannot certify clean what the
 * redaction does not remove. An earlier pair disagreed: the check looked for `/Users/` while the
 * redaction had a different scope, so a Windows path was reported clean and printed in full.
 */
export function hasAbsoluteUserPath(text: string): boolean {
  const dir = home();
  if (dir === null) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(dir, from);
    if (at === -1) return false;
    if (endsOnBoundary(text, at, dir.length)) return true;
    from = at + dir.length;
  }
}

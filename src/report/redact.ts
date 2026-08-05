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
 * So the scope is exactly one thing: the home directory of THIS process, matched literally and
 * only at a path boundary. A path belonging to some other machine — a recorded fixture, a report
 * generated in CI and read locally — is NOT redacted, because every heuristic that would catch it
 * has to guess which segment is an account name, and guessing wrong corrupts a path that a reader
 * needs. That limit is stated here rather than papered over with a rule that looks broader and
 * silently damages output.
 *
 * TWO SPELLINGS, not one, and the reason is measured.
 *
 * The redaction runs at `render()`, on the text a reporter has already produced — which for `json`
 * and `sarif` means a string that went through `JSON.stringify`. A home directory containing a
 * character the serialiser escapes therefore does not occur in that text in the spelling
 * `homedir()` returns: with `HOME=/tmp/x\name`, the report carries `/tmp/x\\name` and a search for
 * the raw form finds nothing. Measured before this was fixed: `json` and `sarif` carried the
 * account name in full while every check said clean.
 *
 * Both spellings are therefore matched, and both are derived from `homedir()` by construction —
 * this is the same directory written two ways, not a guess about what a path might look like.
 *
 * A claim this file previously made and no longer makes: that `homedir()` "is correct on Windows
 * too, so a Windows run redacts its own home". A Windows home is `C:\Users\name`, every separator
 * of which the serialiser escapes, so two of the six formats leaked it. `README.md` states that
 * Windows is not supported; the sentence is withdrawn rather than narrowed.
 */

import { homedir } from "node:os";

/** What replaces the home directory. Visible on purpose: a silent elision reads as a full path. */
export const REDACTION = "~";

/**
 * Every spelling of this process's home directory that can occur in rendered output.
 *
 * A one-character or empty home would match everywhere, so it is refused rather than applied.
 */
function needles(): string[] {
  const dir = homedir();
  if (typeof dir !== "string" || dir.length <= 1) return [];
  // What `JSON.stringify` writes for this exact string, minus its quotes. Derived, never guessed.
  const serialised = JSON.stringify(dir).slice(1, -1);
  return serialised === dir ? [dir] : [dir, serialised];
}

/**
 * True where `text[index]` begins an occurrence that ends on a path boundary.
 *
 * Without the boundary check `/Users/anna` also matches inside `/Users/annabel/x`, which produced
 * `~bel/x` — a corrupted path carrying a residue of a second account name.
 */
function endsOnBoundary(text: string, index: number, length: number): boolean {
  const after = text[index + length];
  return after === undefined || after === "/" || after === "\\" || !/[A-Za-z0-9._-]/u.test(after);
}

/** The first index at or after `from` where `needle` occurs ON a boundary, or -1. */
function nextBoundedHit(text: string, needle: string, from: number): number {
  let at = from;
  for (;;) {
    at = text.indexOf(needle, at);
    if (at === -1) return -1;
    if (endsOnBoundary(text, at, needle.length)) return at;
    at += needle.length;
  }
}

/** Replace occurrences of this process's home directory, in either spelling, with `~`. */
export function redactPaths(text: string): string {
  const all = needles();
  if (all.length === 0) return text;
  let out = "";
  let from = 0;
  for (;;) {
    let bestAt = -1;
    let bestLen = 0;
    for (const needle of all) {
      const at = nextBoundedHit(text, needle, from);
      if (at === -1) continue;
      // Earliest wins; at equal position the longer spelling wins, so an escaped form is never
      // half-consumed by the raw form it contains.
      if (bestAt === -1 || at < bestAt || (at === bestAt && needle.length > bestLen)) {
        bestAt = at;
        bestLen = needle.length;
      }
    }
    if (bestAt === -1) {
      out += text.slice(from);
      return out;
    }
    out += text.slice(from, bestAt) + REDACTION;
    from = bestAt + bestLen;
  }
}

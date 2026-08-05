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
 * WHERE THE REDACTION RUNS, and why it moved. This is the part that was wrong twice.
 *
 * It first ran on the RENDERED TEXT, at the one choke point all six reporters share. That looked
 * like the careful choice — one place instead of six — and it is unsound, because by the time a
 * reporter has produced text, the reporter has TRANSFORMED the path. Each transformation yields a
 * spelling the search does not contain:
 *
 *     json, sarif      JSON.stringify        `/tmp/x\name`  ->  `/tmp/x\\name`
 *     html, junit      XML escaping          `/tmp/x&name`  ->  `/tmp/x&amp;name`
 *     markdown         pipe escaping         `/tmp/x|name`  ->  `/tmp/x\|name`
 *     all six          flatten() in infra    a newline      ->  a space
 *
 * The first of those was found and repaired by adding the serialised spelling as a second needle.
 * That repair was measured and it was still the wrong move: it generalised over the SERIALISER it
 * had just been shown, not over the property. An audit then produced the other three classes in a
 * single probe, and the account name appeared in full in five of six formats.
 *
 * A cap made it worse in a fourth way. `infraLines` truncates `detail` before `render()` was
 * reached, so a cut landing inside the home left a PREFIX of the account name — `/Users/annabell`
 * — which no search for the whole path can find.
 *
 * So the redaction runs on the REPORT, before any reporter sees it. There is no transformation
 * between `homedir()` and the match, because the match happens first. Adding a seventh reporter,
 * a new escape or another cap cannot reopen this: they all operate on text that no longer contains
 * the path. That is a property of the ORDER, not of the needle list, which is why the needle list
 * is back down to the one spelling `homedir()` actually returns.
 *
 * A claim this file previously made and no longer makes: that `homedir()` "is correct on Windows
 * too, so a Windows run redacts its own home". `README.md` states that Windows is not supported,
 * and the sentence was measured false besides. It is withdrawn rather than narrowed.
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
  return [dir];
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

/** Replace occurrences of this process's home directory with `~`. */
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

/**
 * The same redaction, applied to the report itself rather than to rendered text.
 *
 * Every string anywhere in the structure, including object KEYS — a `measured` map can be keyed by
 * a path as easily as valued by one. Numbers, booleans and nulls pass through untouched, so no
 * counter and no threshold can be altered by this.
 *
 * The report is copied rather than edited: the caller may render the same report in several
 * formats, and a function that quietly rewrote its argument would make the second render depend on
 * whether the first had happened.
 */
export function redactReport<T>(value: T): T {
  if (typeof value === "string") return redactPaths(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactReport(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[redactPaths(key)] = redactReport(v);
    }
    return out as unknown as T;
  }
  return value;
}

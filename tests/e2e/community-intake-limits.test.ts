/**
 * The two blind spots docs/community-testing.md names for the intake's secret tripwire, pinned.
 *
 * The page tells a submitter that the detector ignores a candidate shorter than 12 characters and
 * any candidate containing a character outside `A-Z a-z 0-9 + / _ = . : % -`. Nothing tested
 * either statement, so a detector change could have made the page wrong in either direction
 * unnoticed. Each limit is pinned on both sides of its boundary: the flagged neighbour proves the
 * form itself is recognised, so a pass is the limit and not a form the detector never reads. A
 * deliberate fix to either gap must change this file and the page together.
 *
 * The values are built at run time from a repeated letter, so no credential-shaped literal enters
 * the repository history the secret scanner reads.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { detectSensitiveInput } from "../../tools/community-intake.ts";

const value = (length: number, insert = ""): string => {
  const half = Math.floor((length - insert.length) / 2);
  return `${"x".repeat(half)}${insert}${"x".repeat(length - insert.length - half)}`;
};

test("a candidate of 11 characters is not flagged; the same form at 12 is", () => {
  for (const form of [(v: string) => `password: ${v}`, (v: string) => `api_key="${v}"`, (v: string) => `https://example.invalid/?access_token=${v}`]) {
    assert.deepEqual(detectSensitiveInput(form(value(11))), [], `an 11-character secret was flagged: ${form("…")}`);
    assert.notDeepEqual(detectSensitiveInput(form(value(12))), [], `a 12-character secret was not flagged: ${form("…")}`);
  }
});

test("a candidate with punctuation outside the documented character set is not flagged, at any length", () => {
  for (const mark of ["&", "!", "~", "#", "{", "}"]) {
    for (const length of [24, 64]) {
      const payload = `client_secret: "${value(length, mark)}"`;
      assert.deepEqual(detectSensitiveInput(payload), [], `a secret containing "${mark}" was flagged at length ${length}`);
    }
  }
  // Every character of the documented set still reads as part of a candidate.
  assert.deepEqual(detectSensitiveInput(`client_secret: "${value(24, "+/_=.:%-")}"`), ["secret-assignment"]);
});

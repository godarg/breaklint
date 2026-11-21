/**
 * The HTML report names a partner of an ambiguous finding only when one exists in the same document.
 *
 * An ambiguous finding used to read "2 findings share this unresolved fingerprint (partner in
 * JSON)." whenever no partner was found among the rendered cards — although the HTML renders every
 * finding, so in that case there was no partner in the JSON either. The page rules set
 * `ambiguity.groupSize` to 2 for every position-only key, so the sentence sent readers looking for
 * a finding that did not exist. Partners were also matched across documents: the fingerprint has no
 * document path, so blank page 3 of one document "shared" with blank page 3 of another.
 *
 * The oracle is the real renderer (`renderHtml`) on the canonical findings state, whose second
 * finding is ambiguous without a partner, plus two variants that give it one: in the same document
 * and in another document.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderHtml } from "../../src/report/html.ts";
import { findingsReportState } from "../fixtures/report-states.ts";
import type { Report } from "../../src/core/types.ts";

function ambiguityLines(report: Report): string[] {
  return [...renderHtml(report).matchAll(/<strong>Ambiguity:<\/strong> ([^<]*)<\/p>/gu)].map((match) => match[1]!);
}

describe("C8: an ambiguous finding names only a partner that exists in the same document", () => {
  it("without a partner it names none and does not point into the JSON", () => {
    const lines = ambiguityLines(findingsReportState());
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /partner in JSON/u);
    assert.doesNotMatch(lines[0]!, /\bwith Finding\b/u);
    assert.doesNotMatch(lines[0]!, /^\d+ findings share/u, "a group size without a group is not a fact");
    assert.match(lines[0]!, /no other finding in this document/u);
  });

  it("with a partner in the same document it names that finding", () => {
    const report = findingsReportState();
    const ambiguous = report.findings[1]!;
    const partner = report.findings[3]!;
    partner.fingerprint = ambiguous.fingerprint;
    partner.document = ambiguous.document;
    partner.ambiguity = { groupSize: 2, resolvable: false };
    const lines = ambiguityLines(report);
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /with Finding 04\b/u);
    assert.match(lines[1]!, /with Finding 02\b/u);
    for (const line of lines) assert.doesNotMatch(line, /partner in JSON/u);
  });

  it("a finding with the same fingerprint in another document is not a partner", () => {
    const report = findingsReportState();
    const ambiguous = report.findings[1]!;
    const other = report.findings[3]!;
    other.fingerprint = ambiguous.fingerprint;
    other.document = `${ambiguous.document}.other.html`;
    const lines = ambiguityLines(report);
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /\bwith Finding\b/u);
    assert.doesNotMatch(lines[0]!, /partner in JSON/u);
  });
});

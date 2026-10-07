import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDocument } from "../../src/core/engine.ts";
import { tableHeaderNotRepeated } from "../../src/rules/layout/table-continuation.ts";
import { sourceTableMatches } from "../../src/source/table-index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { mutate, mutantsFor, runMutationGuard } from "../tools/mutants.ts";

describe("applicable rule mutation controls", () => {
  it("tests the categorical header witness rather than perturbing absent numeric options", () => {
    assert.deepEqual(mutantsFor(tableHeaderNotRepeated),
      ["emits-nothing", "header-presence-swapped", "rule-id-swapped"]);
  });

  it("changes only repeated-header presence in a positive copy and preserves source membership", () => {
    const snapshot = loadCorpus().find(c => c.name === "table-header-not-repeated-trigger")!.snapshot;
    const before = JSON.stringify(snapshot);
    const original = runDocument({ path: "authored-header-case", snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [tableHeaderNotRepeated], optionsByRule: {}, coverageFloors: {} });
    assert.equal(original.report.findings.length, 1, "authored two-page table lacks its continuation header");
    const [variant] = mutate(tableHeaderNotRepeated, "header-presence-swapped");
    const swapped = runDocument({ path: "authored-header-case", snapshot, infrastructure: [] },
      { failOn: "never", activeRules: [variant!], optionsByRule: {}, coverageFloors: {} });
    assert.equal(swapped.report.findings.length, 0, "source-matched repeated header restores column context");
    assert.equal(swapped.report.coverage[tableHeaderNotRepeated.id]!.measured, 2,
      "a decline cannot kill this witness control");
    assert.equal(JSON.stringify(snapshot), before, "original source and measurement objects remain immutable");
    assert.equal(sourceTableMatches(snapshot.tableIndex!.tables[0]!), true);
  });

  it("kills every applicable mutation for exactly seventeen registered rules", () => {
    const reports = runMutationGuard();
    assert.equal(reports.length, 17);
    assert.ok(reports.every(report => report.triggerFixture !== null && report.survived.length === 0),
      JSON.stringify(reports.filter(report => report.survived.length > 0)));
    assert.equal(reports.reduce((sum, report) => sum + report.killed.length, 0), 83);
  });
});

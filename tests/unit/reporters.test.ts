import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { OUTPUT_FORMATS } from "../../src/core/enums.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { render } from "../../src/report/index.ts";
import { LABELS } from "../../src/report/mandatory.ts";
import type { Report, Snapshot } from "../../src/core/types.ts";

function demoReport(): Report {
  const parsed = JSON.parse(readFileSync(new URL("../../examples/demo-snapshot.json", import.meta.url), "utf8")) as {
    snapshot: Snapshot;
  };
  const outcome = runDocument(
    { path: "examples/demo.html", snapshot: parsed.snapshot, infrastructure: [] },
    { failOn: "error", activeRules: [...ALL_RULES], optionsByRule: {}, loweredFloors: {} },
  );
  return buildReport({
    outcomes: [outcome],
    mode: "demo",
    source: "handwritten snapshot fixture",
    toolVersion: "0.1.0",
    commit: null,
    startedAt: new Date(0).toISOString(),
    durationMs: 0,
    rulesRun: ALL_RULES.length,
    failOn: "error",
    environment: {
      browserVersion: "",
      platform: "test",
      rendererPath: null,
      rendererPresent: false,
      pagedjsVersion: "0.4.3",
      rasterizer: null,
      rasterizerVersion: null,
      textPositionExtractor: null,
      fontFamiliesResolved: [],
      locale: "de-DE",
    },
    config: {
      profile: "demo",
      failOn: "error",
      activeRules: ALL_RULES.map((r) => r.id),
      disabledRules: [],
      loweredFloors: [],
      interventions: [],
      sourceMapInjection: true,
      evidenceBinding: true,
      network: { mode: "offline", allowed: [], blocked: 0 },
    },
  });
}

/** Every mandatory fact, and the aliases each format is allowed to use for it. */
const ALIASES: Record<keyof typeof LABELS, string[]> = {
  inputsFound: [LABELS.inputsFound, "inputsFound"],
  pagesAnalysed: [LABELS.pagesAnalysed, "pagesAnalysed"],
  rulesRun: [LABELS.rulesRun, "rulesRun"],
  measuredRules: [LABELS.measuredRules, "measuredRules"],
  notMeasuredTotal: [LABELS.notMeasuredTotal, "notMeasured"],
  runVerdict: [LABELS.runVerdict, "runVerdict"],
  mode: [LABELS.mode],
  failOn: [LABELS.failOn, "failOn"],
  gateTriggeredBy: [LABELS.gateTriggeredBy, "gateTriggeredBy"],
};

describe("output formats", () => {
  const report = demoReport();

  for (const format of OUTPUT_FORMATS) {
    it(`${format} carries every mandatory counter`, () => {
      // A format that shows only the findings makes the blind run invisible again, and a format
      // that hides its gate threshold leaves the reader unable to say what exit 0 meant. Both
      // were real defects, so both are checked here rather than trusted.
      const out = render(report, format);
      const missing = (Object.keys(ALIASES) as (keyof typeof ALIASES)[]).filter(
        (key) => !ALIASES[key].some((alias) => out.includes(alias)),
      );
      assert.deepEqual(missing, [], `${format} is missing: ${missing.join(", ")}`);
    });

    it(`${format} produces output for a clean run too`, () => {
      // The empty state is where a checker most easily reports its own idleness as success.
      const clean: Report = { ...report, findings: [], documents: report.documents.map((d) => ({ ...d, findings: [] })) };
      const out = render(clean, format);
      assert.ok(out.length > 0, "empty output");
      const missing = (Object.keys(ALIASES) as (keyof typeof ALIASES)[]).filter(
        (key) => !ALIASES[key].some((alias) => out.includes(alias)),
      );
      assert.deepEqual(missing, [], `${format} drops counters when there are no findings`);
    });
  }

  it("html is self-contained: no external request of any kind", () => {
    const html = render(report, "html");
    for (const pattern of [/<script/iu, /src\s*=\s*["']https?:/iu, /@import/iu, /<link[^>]+href\s*=\s*["']https?:/iu]) {
      assert.ok(!pattern.test(html), `html reaches out: ${pattern}`);
    }
  });

  it("sarif gives no physicalLocation to a finding without a source", () => {
    // Fourteen margin boxes produced by the paginator have no source id. Pointing a code
    // scanner at "line 1" for them would be an invented fact.
    const sarif = JSON.parse(render(report, "sarif")) as {
      runs: { results: { locations: { physicalLocation?: unknown; logicalLocations?: unknown }[] }[] }[];
    };
    const results = sarif.runs[0]?.results ?? [];
    const withoutSource = report.findings.filter((f) => f.source === null).length;
    const logical = results.filter((r) => r.locations.some((l) => l.logicalLocations)).length;
    assert.equal(logical, withoutSource, "every sourceless finding must be a logicalLocation");
  });

  it("json is parseable and round-trips the verdict", () => {
    const parsed = JSON.parse(render(report, "json")) as Report;
    assert.equal(parsed.runVerdict, report.runVerdict);
    assert.equal(parsed.exitCode, report.exitCode);
    assert.equal(parsed.schemaVersion, 2);
  });
});

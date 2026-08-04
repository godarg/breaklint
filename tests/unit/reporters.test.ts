import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { OUTPUT_FORMATS } from "../../src/core/enums.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { render } from "../../src/report/index.ts";
import { hasAbsoluteUserPath } from "../../src/report/redact.ts";
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

  /**
   * The error state has to be distinguishable from the empty state, on the surface a user reads.
   *
   * Measured before this existed: a run that exited 3 because the PDF did not reproduce the page
   * the rules measured printed `checked 0 pages in 1 document, no findings` — the wording of a
   * clean run — and the reason appeared nowhere in the console output at all. Every diagnostic
   * this project wrote into its infrastructure events reached the JSON and never a reader. The
   * console reporter had guarded its empty state against exactly this since it was written, and
   * had left the error state open.
   *
   * Red condition: stop projecting infrastructure events, or let the empty-state sentence apply
   * to an infrastructure verdict, and one of the assertions below fails.
   */
  it("an infrastructure failure is visible on the console and is not worded as a clean run", () => {
    const outcome = runDocument(
      {
        path: "doc.html",
        snapshot: null,
        infrastructure: [
          {
            kind: "render-unstable",
            detail: "dom-pdf-divergence on page(s) 2: the PDF does not reproduce the geometry the rules measured.",
            measured: { divergentPages: 1 },
          },
        ],
      },
      { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    const broken = buildReport({
      outcomes: [outcome],
      mode: "live",
      source: "rendered",
      toolVersion: "0.1.0",
      commit: null,
      startedAt: new Date(0).toISOString(),
      durationMs: 0,
      rulesRun: 0,
      failOn: "error",
      environment: report.environment,
      config: report.config,
    });
    assert.equal(broken.exitCode, 3, "precondition: this is an infrastructure run");

    // EVERY format, not the one this repair was written in. The first version of this test
    // asserted on `console` alone, and an audit then measured the other five: markdown and html
    // still printed "No findings." on an exit-3 run, junit rendered failures="0" — which every
    // CI front-end reads as a green build — and sarif set executionSuccessful:false while naming
    // neither the kind nor the reason. The repair had generalised over the reporter it lived in
    // rather than over the property it was about.
    for (const format of OUTPUT_FORMATS) {
      const text = render(broken, format);
      assert.match(text, /render-unstable/u, `${format}: the kind that caused the exit must appear`);
      assert.match(text, /dom-pdf-divergence/u, `${format}: and so must the reason, the useful half`);
      assert.doesNotMatch(
        text,
        /No findings/iu,
        `${format}: that is the wording of a clean run, and this run did not look at anything`,
      );
    }

    // The number a CI system reads first has to reflect it too — and it is the attribute on the
    // ROOT `<testsuites>` element, not any `failures="…"` anywhere in the document. A first
    // version of this line matched the whole string and was satisfied by the inner checker
    // suite while the root still said failures="0": the assertion looked right and gated nothing,
    // measured green under the mutation it existed to catch.
    const junit = render(broken, "junit");
    const root = /<testsuites\b[^>]*>/u.exec(junit)?.[0] ?? "";
    assert.ok(root.length > 0, "no <testsuites> root element in the junit output");
    const rootFailures = /failures="(\d+)"/u.exec(root)?.[1];
    assert.equal(rootFailures, "1", `the root <testsuites> reports failures=${rootFailures}; CI reads this as green`);
  });

  /**
   * A report is something a user pastes into an issue, so it must not carry the account name of
   * whoever ran the tool. `/Users/…` is a hard blocklist item for this project.
   *
   * Measured before the redaction existed: projecting infrastructure events to the console was
   * right, but it printed `InfraEvent.measured` raw, and `render-run.ts` puts the resolved browser
   * path in that field — so the repair that made the error state visible ALSO made an absolute
   * path visible. The realistic trigger is a puppeteer-cached Chrome under the home directory.
   *
   * Red condition: remove the redaction from `render()` and every format below fails.
   */
  it("no format leaks an absolute user path", () => {
    const outcome = runDocument(
      {
        path: "doc.html",
        snapshot: null,
        infrastructure: [
          {
            kind: "checker-crashed",
            detail: "the probe is not wired to a browser in this build.",
            measured: { stage: "measure", browser: "/Users/someone/Library/Caches/chrome/Chromium" },
          },
        ],
      },
      { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    const leaky = buildReport({
      outcomes: [outcome],
      mode: "live",
      source: "rendered",
      toolVersion: "0.1.0",
      commit: null,
      startedAt: new Date(0).toISOString(),
      durationMs: 0,
      rulesRun: 0,
      failOn: "error",
      environment: { ...report.environment, rendererPath: "/Users/someone/bin/chrome" },
      config: report.config,
    });
    for (const format of OUTPUT_FORMATS) {
      const text = render(leaky, format);
      assert.ok(!hasAbsoluteUserPath(text), `${format} leaked an absolute user path`);
      assert.doesNotMatch(text, /\/Users\//u, `${format} contains a literal /Users/ path`);
    }
  });

  /**
   * `measured` grows with the document. A `render-unstable` over fifty divergent pages produced a
   * single 7 488-character console line before the collections were summarised.
   *
   * Red condition: print `measured` raw again and this fails on length.
   */
  it("a large measured payload does not become one unreadable line", () => {
    const pages = Array.from({ length: 50 }, (_, i) => i + 1);
    const outcome = runDocument(
      {
        path: "doc.html",
        snapshot: null,
        infrastructure: [
          {
            kind: "render-unstable",
            detail: "dom-pdf-divergence",
            measured: {
              divergentPages: pages.length,
              pages,
              perPage: pages.map((n) => ({ page: n, refound: 4, placed: 4, maxDxMm: 40, maxDyMm: 0 })),
            },
          },
        ],
      },
      { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    const big = buildReport({
      outcomes: [outcome],
      mode: "live",
      source: "rendered",
      toolVersion: "0.1.0",
      commit: null,
      startedAt: new Date(0).toISOString(),
      durationMs: 0,
      rulesRun: 0,
      failOn: "error",
      environment: report.environment,
      config: report.config,
    });
    const longest = Math.max(...render(big, "console").split("\n").map((l) => l.length));
    assert.ok(longest < 400, `the longest console line is ${longest} characters`);
    // and the count a reader needs is still there
    assert.match(render(big, "console"), /50 entries/u);
  });
});

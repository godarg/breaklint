import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { OUTPUT_FORMATS } from "../../src/core/enums.ts";
import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import { ALL_RULES } from "../../src/rules/index.ts";
import { render } from "../../src/report/index.ts";
import { redactPaths } from "../../src/report/redact.ts";
import { infraLines, MAX_DETAIL_CHARS, MAX_VALUE_CHARS } from "../../src/report/infra.ts";
import { divergenceDetail } from "../../src/render/evidence.ts";
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
            // The REAL leak path: a puppeteer-cached Chrome under THIS process's home directory.
            // A first version used a hard-coded `/Users/someone/…`, which the redaction no longer
            // touches by design — foreign-machine paths cannot be redacted without guessing which
            // segment is an account name, and guessing corrupts legitimate output. Testing with a
            // foreign path measured a scope the tool deliberately does not have.
            measured: { stage: "measure", browser: join(homedir(), ".cache/puppeteer/chrome/chrome") },
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
      environment: { ...report.environment, rendererPath: join(homedir(), "bin/chrome") },
      config: report.config,
    });
    for (const format of OUTPUT_FORMATS) {
      const text = render(leaky, format);
      // One assertion, and its truth does not come from `redact.ts`. There used to be a second one
      // above this line calling `hasAbsoluteUserPath`, a helper that re-implemented the redaction's
      // own matching rule — so the check asked the redaction its own question and could only agree
      // with it. An audit reverted that helper to an earlier, disagreeing version and the suite
      // stayed 170/170, because this fixture contains none of the strings the two versions differ
      // on. The helper had no caller in `src/` at all. It is deleted rather than gated: a checker
      // whose only consumer is the assertion it cannot fail is not a gate.
      assert.ok(!text.includes(homedir()), `${format} contains the literal home directory`);
      // and the redaction marker is there, so the case is not passing because nothing was emitted
      assert.match(text, /~/u, `${format} shows no redaction marker — did the payload reach it at all?`);
    }
  });

  /**
   * The demo's own numbers, so `docs/status.md` cannot state them wrong again.
   *
   * That file said "8 findings across 8 rules". Measured from the product's own output: eight
   * findings across SEVEN rules — `layout/half-empty-page` fires twice. Nothing in the repository
   * computed either number, which is precisely how the earlier "209 leaf values" survived: a
   * figure in the file designated as the truth source, arrived at by counting once, by hand.
   *
   * Red condition: change either number here, or change the demo fixture so the counts move, and
   * this fails with both values named.
   */
  it("the demo produces the counts docs/status.md states", () => {
    const demo = demoReport();
    const ruleIds = new Set(demo.findings.map((f) => f.ruleId));
    assert.equal(demo.findings.length, 8, "findings in the demo");
    assert.equal(ruleIds.size, 7, "distinct rules in the demo");
    assert.equal(demo.exitCode, 1, "the demo must end 1 — a demo that ends 0 shows no finding");
    // The doc sentence itself, so a reader of that file and this test cannot drift apart.
    const status = readFileSync(new URL("../../docs/status.md", import.meta.url), "utf8");
    assert.ok(
      status.includes(`exit 1, ${demo.findings.length} findings across ${ruleIds.size} rules`),
      "docs/status.md states demo counts that the demo does not produce",
    );
  });

  /**
   * A home directory the serialiser has to escape.
   *
   * The redaction runs at `render()`, on text a reporter has already produced. For `json` and
   * `sarif` that text came out of `JSON.stringify`, so a backslash in the home directory arrives
   * doubled and a search for the raw spelling finds nothing. Measured before the fix, with
   * `HOME=/tmp/…\<account>`: `json` and `sarif` carried the account name in full while every check
   * reported clean, because the checks were searching for a string that no longer occurred.
   *
   * The oracle here is a literal this test chose. It is not `homedir()` and not anything from
   * `redact.ts` — both of those are blind in exactly the way the defect is, which is why the defect
   * survived a round.
   *
   * Red condition: drop the serialised spelling from `needles()` in `redact.ts` and `json` and
   * `sarif` fail on the account token.
   */
  it("a home directory that JSON escapes is still redacted in every format", () => {
    const account = "acct7391unlikely";
    const fakeHome = `/tmp/bl-home\\${account}`;
    const realHome = process.env.HOME;
    try {
      process.env.HOME = fakeHome;
      assert.equal(homedir(), fakeHome, "premise: os.homedir() follows $HOME at call time");
      assert.notEqual(
        JSON.stringify(fakeHome).slice(1, -1),
        fakeHome,
        "premise: this home has a spelling the serialiser changes — otherwise the case is vacuous",
      );

      const outcome = runDocument(
        {
          path: "doc.html",
          snapshot: null,
          infrastructure: [
            {
              kind: "checker-crashed",
              detail: "the probe is not wired to a browser in this build.",
              measured: { stage: "measure", browser: `${fakeHome}/.cache/puppeteer/chrome` },
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
        environment: { ...report.environment, rendererPath: `${fakeHome}/bin/chrome` },
        config: report.config,
      });
      for (const format of OUTPUT_FORMATS) {
        const text = render(leaky, format);
        assert.ok(!text.includes(account), `${format} leaked the account name of an escaped home`);
        assert.match(text, /~/u, `${format} shows no redaction marker — did the payload reach it?`);
      }
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
    }
  });

  /**
   * The two caps, pinned by literal and measured on both sides of each boundary.
   *
   * Both constants have been wrong in a way a suite could not see. `MAX_VALUE_CHARS` was
   * unreachable for a round — `renderValue` cut at the longer `detail` limit first, so nothing
   * could still exceed 160 when the comparison ran, and the constant could be raised to 10 000
   * with everything green. `MAX_DETAIL_CHARS` was gated only indirectly, through a downstream
   * `longest < 400` assertion, so it could be raised from 220 to 340 unnoticed.
   *
   * Red condition: change either literal and the first two assertions fail; change the behaviour
   * without the literal and the boundary pairs below fail.
   */
  it("both caps are pinned by literal and fire at their own boundary", () => {
    assert.equal(MAX_DETAIL_CHARS, 220);
    assert.equal(MAX_VALUE_CHARS, 160);

    const lineFor = (detail: string, measured: Record<string, unknown>): { detail: string; measured: string[] } => {
      const outcome = runDocument(
        { path: "doc.html", snapshot: null, infrastructure: [{ kind: "checker-crashed", detail, measured }] },
        { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} },
      );
      const built = buildReport({
        outcomes: [outcome], mode: "live", source: "rendered", toolVersion: "0.1.0", commit: null,
        startedAt: new Date(0).toISOString(), durationMs: 0, rulesRun: 0, failOn: "error",
        environment: report.environment, config: report.config,
      });
      return infraLines(built)[0]!;
    };

    // `detail`, one character under and one character over.
    assert.equal(lineFor("d".repeat(MAX_DETAIL_CHARS), {}).detail.length, MAX_DETAIL_CHARS);
    // The cut point itself, pinned from both sides. Asserting on total LENGTH does not work and
    // the first version of this test did exactly that: the disclosure suffix makes a cut string
    // LONGER than the limit, so `length < limit + 1` fails on correct output. It measured the
    // wrong property and went red on a working cap.
    const overDetail = lineFor("d".repeat(MAX_DETAIL_CHARS + 1), {}).detail;
    assert.ok(overDetail.startsWith("d".repeat(MAX_DETAIL_CHARS)), "the cut must keep exactly the limit");
    assert.ok(!overDetail.startsWith("d".repeat(MAX_DETAIL_CHARS + 1)), "the cut must not keep more");
    assert.match(overDetail, /… \(221 chars\)$/u, "the cut must disclose the original length");

    // A value inside `measured`, one under and one over ITS limit — which is below the detail cap,
    // so a value cut at the detail limit would pass the first of these and fail the second.
    assert.equal(lineFor("x", { v: "v".repeat(MAX_VALUE_CHARS) }).measured[0]!.length, MAX_VALUE_CHARS + 2);
    const overValue = lineFor("x", { v: "v".repeat(MAX_VALUE_CHARS + 1) }).measured[0]!;
    assert.match(overValue, /… \(161 chars\)$/u, "a long value must be cut at its own limit, with its length");

    // The producer's own payload, imported rather than transcribed. A hand-written copy was
    // accurate and still wrong as a method: it does not follow a change to the original.
    const real = divergenceDetail(Array.from({ length: 50 }, (_, i) => i + 1));
    assert.ok(real.length > MAX_DETAIL_CHARS, `the real producer must exceed the cap, got ${real.length}`);
    assert.match(lineFor(real, {}).detail, /… \(\d+ chars\)$/u);

    // A cut that lands on a surrogate pair must not leave half of one behind.
    const astral = `${"a".repeat(MAX_DETAIL_CHARS - 1)}\u{1F600}tail`;
    const cutAstral = lineFor(astral, {}).detail;
    assert.equal(cutAstral.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/gu)?.length ?? 0, 0, "no lone surrogate");
  });

  /**
   * Which formats the cap governs — both halves, because the claim was once made too widely.
   *
   * "capped in all six reporters" was stated and is false: `renderJson` serialises the report
   * itself and never passes through `infraLines`, so the JSON carries `detail` at full length.
   * That is the intended design — the JSON is canonical and the other five are lossy projections
   * of it — but an unstated exception in a claim about six things is a claim about five.
   *
   * Red condition: cap `detail` inside the report before serialisation and the first assertion
   * fails; stop capping in `infraLines` and the second fails for the five projections.
   */
  it("the cap governs the five projections and deliberately not the canonical JSON", () => {
    const long = divergenceDetail(Array.from({ length: 50 }, (_, i) => i + 1));
    assert.ok(long.length > MAX_DETAIL_CHARS, "premise: the producer's payload exceeds the cap");
    const outcome = runDocument(
      { path: "doc.html", snapshot: null, infrastructure: [{ kind: "render-unstable", detail: long, measured: null }] },
      { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    const built = buildReport({
      outcomes: [outcome], mode: "live", source: "rendered", toolVersion: "0.1.0", commit: null,
      startedAt: new Date(0).toISOString(), durationMs: 0, rulesRun: 0, failOn: "error",
      environment: report.environment, config: report.config,
    });

    // Canonical: the whole sentence survives, so nothing is lost from the record of record.
    assert.ok(render(built, "json").includes(long), "the JSON must keep the full detail");

    // Projections: the full sentence must NOT appear, and the disclosure must.
    for (const format of OUTPUT_FORMATS.filter((f) => f !== "json")) {
      const text = render(built, format);
      assert.ok(!text.includes(long), `${format} carries the uncapped detail`);
      assert.match(text, /… \(\d+ chars\)/u, `${format} shows no length disclosure`);
    }
  });

  /**
   * `detail` is built from arbitrary `Error.message` values in `engine.ts`, so it can contain a
   * newline and a control character. Markdown escapes `|` and has no escape for a line break: one
   * `\n` turned one table row into three and destroyed the Checker table. XML 1.0 forbids most C0
   * characters outright and the junit escape helper covers only `& < > "`, so a U+0007 made the
   * report reject as not well-formed.
   *
   * Red condition: stop flattening in `oneLine()` and both assertions fail.
   */
  it("a hostile detail cannot break the markdown table or the XML", () => {
    const outcome = runDocument(
      {
        path: "doc.html",
        snapshot: null,
        infrastructure: [
          {
            kind: "checker-crashed",
            detail: "line one\nline two | with a pipe\r\nand a bell \u0007 and a \u0001 here",
            measured: { note: "second\nline" },
          },
        ],
      },
      { failOn: "error", activeRules: [], optionsByRule: {}, loweredFloors: {} },
    );
    const hostile = buildReport({
      outcomes: [outcome], mode: "live", source: "rendered", toolVersion: "0.1.0", commit: null,
      startedAt: new Date(0).toISOString(), durationMs: 0, rulesRun: 0, failOn: "error",
      environment: report.environment, config: report.config,
    });

    // The Checker table keeps one row per event: find it and count its lines.
    const md = render(hostile, "markdown");
    // Scope to the Checker section only: the slice must stop at the next heading, or it counts
    // the Findings table's rows too and the assertion measures the wrong thing.
    const start = md.indexOf("## Checker");
    const rest = md.slice(start + "## Checker".length);
    const next = rest.indexOf("\n## ");
    const checker = next === -1 ? md.slice(start) : md.slice(start, start + "## Checker".length + next);
    const rows = checker.split("\n").filter((l) => l.startsWith("| `checker-crashed`"));
    assert.equal(rows.length, 1, "one event must be one markdown row");
    // The property is CONTIGUITY, not a count of `|` lines. A spilled row leaves continuation
    // lines that do not start with `|`, so counting `|` lines is blind to exactly this breakage —
    // measured: removing the newline flattening left a count-based assertion green. A spill shows
    // up as a gap in the run of table lines.
    // The property is CELL COUNT per row, and it took three attempts to state correctly — worth
    // recording, because each earlier version looked right and gated nothing:
    //   counting `|` lines      — blind: the spill lines do not start with `|`
    //   contiguity of `|` lines — blind: the spill lands AFTER the row, so the run stays contiguous
    // A row broken by a newline loses cells, so comparing each row's delimiter count against the
    // header's is the check that actually fails when the table breaks.
    const tableLines = checker.split("\n").filter((l) => l.startsWith("|"));
    assert.equal(tableLines.length, 3, `header, separator and one row; got ${tableLines.length}`);
    // Unescaped delimiters only. The reporter escapes a literal pipe as `\|`, and a naive
    // `split("|")` counts that too — which made this assertion fail on the CLEAN build.
    const cells = (l: string) => (l.match(/(?<!\\)\|/gu) ?? []).length;
    for (const line of tableLines) {
      assert.equal(
        cells(line),
        cells(tableLines[0]!),
        `a table row has ${cells(line)} cells against the header's ${cells(tableLines[0]!)} — ` +
          `a value spilled onto its own line: ${JSON.stringify(line)}`,
      );
    }

    for (const format of ["junit", "sarif", "html"] as const) {
      const out = render(hostile, format);
      assert.doesNotMatch(out, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u, `${format} carries a raw C0 control character`);
    }
    // and the junit really parses
    const xml = render(hostile, "junit");
    assert.doesNotMatch(xml, /[\u0000-\u0008]/u);
    assert.match(xml, /<testsuites\b/u);
  });

  /**
   * Redaction must not damage what a finding exists to say.
   *
   * The first version rewrote any `/Users/<x>` or `/home/<x>` prefix, consuming the root AND one
   * following segment. Measured: `/home/img/logo.png` became `~/logo.png` — the `img` segment
   * vanished — and `https://example.com/home/index.html` became `https://example.com~`. Both are
   * reachable through `artifact/local-uri`, the one rule whose entire purpose is to report a
   * reference the document makes, so the redaction was deleting the thing the finding names.
   *
   * Red condition: reinstate a rule that eats a path segment and these fail.
   */
  it("redaction leaves paths that are not this machine's home alone", () => {
    for (const [input, why] of [
      ["/home/img/logo.png", "a directory that merely begins with a user root"],
      ["https://example.com/home/index.html", "a URL path"],
      ["/Users/Shared/templates/a.css", "a shared, non-account path"],
    ] as const) {
      assert.equal(redactPaths(input), input, `redaction damaged ${why}`);
    }
    // and it still removes what it is for
    const mine = join(homedir(), "Library/Caches/chrome/chrome");
    assert.ok(!redactPaths(mine).includes(homedir()), "this machine's home must be redacted");
    // a sibling directory sharing the home prefix is NOT this home
    assert.equal(redactPaths(`${homedir()}XTRA/secret/a.html`), `${homedir()}XTRA/secret/a.html`);
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
            // The REAL producer's shape. `src/render/evidence.ts` builds this detail with
            // `pages.join(", ")`, so fifty divergent pages make a ~490-character sentence. A first
            // version of this test used an 18-character stub, measured 185 characters, and passed
            // a 400-character threshold that the very scenario it names violates at 505.
            detail:
              `dom-pdf-divergence on page(s) ${pages.join(", ")}: the PDF does not reproduce the ` +
              "geometry the rules measured. Per page below, `refound` of `placed` marks were located " +
              "uniquely in the text stream, and `reason` says whether those marks scattered around " +
              "their own reference or agreed on a reference that is itself displaced.",
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

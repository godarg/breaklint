/**
 * SARIF, JUnit and Markdown as the consumers of the GitHub Action read them.
 *
 * Until this file, no test held the SARIF output against the SARIF 2.1.0 schema: the reporter
 * tests asserted individual fields, and a result level, a region or a notification level outside
 * the schema's enums would have gone to `github/codeql-action/upload-sarif` unchecked. Every
 * check here reads what the real CLI or the real reporter module wrote, and every checker is
 * shown to fail on a document that is wrong in exactly one way, so a validator that accepts
 * everything cannot pass this file.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { render } from "../../src/report/index.ts";
import { canonicalReportStates } from "../fixtures/report-states.ts";
import {
  SARIF_SCHEMA_PATH,
  SARIF_SCHEMA_SHA256,
  junitProblems,
  markdownProblems,
  sarifProblems,
} from "../tools/report-format-checks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "src/cli/index.ts");

/** What `breaklint --demo --format <f> --out <file>` writes: the consumer-visible path. */
function demoOutput(format: string): string {
  const dir = mkdtempSync(join(tmpdir(), "breaklint-formats-"));
  try {
    const out = join(dir, `demo.${format}`);
    const run = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--demo", "--format", format, "--out", out], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 1, `--demo --format ${format} exited ${run.status}: ${run.stderr}`);
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Json = Record<string, any>;
const clone = (value: Json): Json => JSON.parse(JSON.stringify(value)) as Json;

/** A demo report whose first finding carries a verified original range, so SARIF has a physicalLocation. */
function physicalLocationSarif(): Json {
  const report = canonicalReportStates().findings;
  const finding = report.findings[0]!;
  finding.source = { file: "generated/input.html", line: 2, column: 1, endLine: 2, endColumn: 8, offset: 10, endOffset: 17, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" };
  finding.originalSource = {
    status: "verified", role: "exact-original-range",
    location: { file: "chapters/a b.html", line: 7, column: 2, endLine: 7, endColumn: 9, offset: 20, endOffset: 27, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" },
    integrity: { sha256: "a".repeat(64), byteLength: 40, role: "authoring" }, candidates: [],
  };
  finding.stableIdentity = { status: "unique", value: "b".repeat(64), candidates: ["b".repeat(64)] };
  if (report.findings[1]) report.findings[1].source = { file: "chapter-2.html", line: 12, column: 3, endLine: 12, endColumn: 30, offset: 100, endOffset: 127, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" };
  return JSON.parse(render(report, "sarif")) as Json;
}

describe("SARIF against the SARIF 2.1.0 schema", () => {
  it("uses the vendored schema whose source, licence and digest are recorded next to it", () => {
    const bytes = readFileSync(SARIF_SCHEMA_PATH);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), SARIF_SCHEMA_SHA256);
    const readme = readFileSync(new URL("../fixtures/sarif-schema/README.md", import.meta.url), "utf8");
    assert.ok(readme.includes(SARIF_SCHEMA_SHA256), "the README does not record the schema's digest");
    assert.match(readme, /https:\/\/raw\.githubusercontent\.com\/microsoft\/sarif-sdk\/[0-9a-f]{40}\/src\/Sarif\/Schemata\/sarif-2\.1\.0\.json/u);
    assert.match(readme, /\bMIT\b/u);
    const licence = readFileSync(new URL("../fixtures/sarif-schema/LICENSE.sarif-sdk", import.meta.url), "utf8");
    assert.match(licence, /MIT License/u);
    assert.match(licence, /Copyright \(c\) Microsoft Corporation/u);
  });

  it("accepts what `breaklint --demo --format sarif` writes", () => {
    assert.deepEqual(sarifProblems(JSON.parse(demoOutput("sarif"))), []);
  });

  it("accepts every report state the reporters distinguish, and physical locations", () => {
    for (const [state, report] of Object.entries(canonicalReportStates())) {
      assert.deepEqual(sarifProblems(JSON.parse(render(report, "sarif"))), [], `${state} SARIF violates the schema`);
    }
    const physical = physicalLocationSarif();
    assert.ok(physical.runs[0].results.some((r: Json) => r.locations[0].physicalLocation), "precondition: a physical location");
    assert.deepEqual(sarifProblems(physical), []);
  });

  it("rejects a SARIF log that is wrong in exactly one way", () => {
    const valid = physicalLocationSarif();
    assert.deepEqual(sarifProblems(valid), [], "precondition");
    const physicalIndex = valid.runs[0].results.findIndex((r: Json) => r.locations[0].physicalLocation);
    const corruptions: [string, (s: Json) => void][] = [
      ["no version", (s) => delete s.version],
      ["version 2.0.0", (s) => { s.version = "2.0.0"; }],
      ["a top-level property the schema does not know", (s) => { s.breaklint = true; }],
      ["result level 'fatal'", (s) => { s.runs[0].results[0].level = "fatal"; }],
      ["notification level 'info'", (s) => { s.runs[0].invocations[0].toolExecutionNotifications = [{ level: "info", message: { text: "x" } }]; }],
      ["invocation without executionSuccessful", (s) => delete s.runs[0].invocations[0].executionSuccessful],
      ["message without text or id", (s) => { s.runs[0].results[0].message = {}; }],
      ["startLine 0", (s) => { s.runs[0].results[physicalIndex].locations[0].physicalLocation.region.startLine = 0; }],
      // The OASIS errata01 constraint the vendored copy lacks, restored by the checker.
      ["a region without startLine, charOffset or byteOffset", (s) => { delete s.runs[0].results[physicalIndex].locations[0].physicalLocation.region.startLine; }],
      ["an artifact URI with a raw space", (s) => { s.runs[0].results[physicalIndex].locations[0].physicalLocation.artifactLocation.uri = "chapters/a b.html"; }],
      ["a $schema that is not a URI", (s) => { s.$schema = "sarif 2.1.0"; }],
      ["a rule with no id", (s) => delete s.runs[0].tool.driver.rules[0].id],
      ["columnKind 'bytes'", (s) => { s.runs[0].columnKind = "bytes"; }],
      // One per format the checker implements itself; an unknown format must not pass silently.
      ["a start time that is not an RFC 3339 date-time", (s) => { s.runs[0].invocations[0].startTimeUtc = "2026-09-24 12:00"; }],
      ["a run GUID that is not a UUID", (s) => { s.runs[0].automationDetails = { guid: "not-a-guid" }; }],
    ];
    for (const [name, corrupt] of corruptions) {
      const document = clone(valid);
      corrupt(document);
      assert.notDeepEqual(sarifProblems(document), [], `the checker accepted SARIF with ${name}`);
    }
  });
});

describe("JUnit, structurally", () => {
  it("accepts what `breaklint --demo --format junit` writes and every report state", () => {
    assert.deepEqual(junitProblems(demoOutput("junit")), []);
    const states = canonicalReportStates();
    for (const [state, report] of Object.entries(states)) {
      assert.deepEqual(junitProblems(render(report, "junit")), [], `${state} JUnit`);
    }
    // The counter a CI front-end reads first: red for findings and infrastructure, green for clean.
    const failures = (state: keyof typeof states) => Number(/<testsuites [^>]*failures="(\d+)"/u.exec(render(states[state], "junit"))?.[1]);
    assert.equal(failures("clean"), 0);
    assert.ok(failures("findings") > 0);
    assert.ok(failures("infrastructure") > 0);
    assert.match(render(states["insufficient-coverage"], "junit"), /<skipped message="coverage /u);
  });

  it("rejects a JUnit document that is wrong in exactly one way", () => {
    const valid = render(canonicalReportStates().findings, "junit");
    assert.deepEqual(junitProblems(valid), [], "precondition");
    const corruptions: [string, (x: string) => string][] = [
      ["a root failure count that disagrees", (x) => x.replace(/(<testsuites [^>]*failures=")\d+"/u, "$1999\"")],
      ["a suite failure count that disagrees", (x) => x.replace(/(<testsuite name="examples[^>]*failures=")\d+"/u, "$1999\"")],
      ["an unescaped & in an attribute", (x) => x.replace(/message="/u, 'message="a & b ')],
      ["an unescaped < in text", (x) => x.replace(/<\/failure>/u, "a < b</failure>")],
      ["an unclosed element", (x) => x.replace(/<\/testsuites>\n$/u, "")],
      ["a mismatched closing tag", (x) => x.replace(/<\/testsuite>/u, "</testcase>")],
      ["a control character", (x) => x.replace(/message="/u, 'message="\u0007')],
      ["another root element", (x) => x.replace(/<testsuites /u, "<results ").replace(/<\/testsuites>/u, "</results>")],
      ["no XML declaration", (x) => x.replace(/^<\?xml[^>]*>\n/u, "")],
      ["a non-integer test count", (x) => x.replace(/(<testsuites [^>]*tests=")\d+"/u, '$1many"')],
    ];
    for (const [name, corrupt] of corruptions) {
      const document = corrupt(valid);
      assert.notEqual(document, valid, `the corruption "${name}" changed nothing`);
      assert.notDeepEqual(junitProblems(document), [], `the checker accepted JUnit with ${name}`);
    }
  });
});

describe("Markdown's verdict line", () => {
  it("opens with the verdict the report carries, in every state", () => {
    assert.deepEqual(markdownProblems(demoOutput("markdown"), "findings"), []);
    for (const [state, report] of Object.entries(canonicalReportStates())) {
      const markdown = render(report, "markdown");
      assert.deepEqual(markdownProblems(markdown, report.runVerdict), [], `${state} Markdown`);
      assert.ok(markdown.startsWith(`# breaklint — ${report.runVerdict}\n`), state);
    }
  });

  it("rejects a missing, contradicted or unexpected verdict", () => {
    const valid = render(canonicalReportStates().clean, "markdown");
    assert.deepEqual(markdownProblems(valid, "clean"), [], "precondition");
    assert.notDeepEqual(markdownProblems(valid.replace(/^# breaklint — clean\n/u, ""), "clean"), []);
    assert.notDeepEqual(markdownProblems(valid.replace(/^# breaklint — clean/u, "# breaklint — findings")), []);
    assert.notDeepEqual(markdownProblems(valid, "findings"), []);
    assert.notDeepEqual(markdownProblems(valid.replace(/^# breaklint — clean/u, "# breaklint — passed")), []);
    assert.notDeepEqual(markdownProblems(valid.replace(/## Coverage/u, "## Something")), []);
  });
});

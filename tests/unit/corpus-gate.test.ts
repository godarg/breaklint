/**
 * Red controls for the self-authored corpus gate (tests/tools/corpus-gate.ts).
 *
 * The gate is the oracle for twenty documents, so a matcher that is too lenient would turn the
 * corpus into a green light that checked nothing. Every matching rule of the corpus README is
 * exercised here on synthetic reports, each with a positive and a negative case, and the
 * fail-closed paths (zero documents, a hash mismatch, an unknown field, a finding nobody
 * accounts for) are observed through the gate's own process boundary with a stand-in CLI.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Finding, Report } from "../../src/core/types.ts";
import {
  compileExpected,
  evaluateDocument,
  indexSource,
  selectElements,
  verifyManifest,
  type CompiledExpected,
  type RunOutcome,
  type SourceIndex,
} from "../tools/corpus-gate.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GATE = join(ROOT, "tests/tools/corpus-gate.ts");

const HTML = [
  "<!doctype html><html lang=\"en\"><head><title>t</title></head><body id=\"top\">",
  "<main id=\"main\">",
  "<h2 id=\"h-a\">Überblick</h2>",
  "<p id=\"p1\">Ä first paragraph with <span id=\"inner\">an inline span</span>.</p>",
  "<p id=\"p2\">See <a id=\"a-file\" href=\"file:///srv/x.txt\">x</a> and <a id=\"a-rel\" href=\"x.html\">y</a>.</p>",
  "<p id=\"p-plain\">No link here.</p>",
  "<h3 id=\"h3-a\" class=\"k\">A</h3><h3 id=\"h3-b\">B</h3>",
  "<table id=\"tbl\"><tr id=\"r1\"><td>1</td></tr><tr id=\"r2\"><td>2</td></tr></table>",
  "<svg id=\"s1\" viewBox=\"0 0 100 50\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
  "<text id=\"t1\" x=\"1\" y=\"10\">one</text><text id=\"t2\" x=\"1\" y=\"20\">two</text><text id=\"t3\" x=\"1\" y=\"30\">three</text>",
  "<defs><text id=\"tdef\">MWh</text></defs><use id=\"u1\" href=\"#tdef\" x=\"5\" y=\"40\"/>",
  "<a id=\"svg-link\" xlink:href=\"file:///opt/d.svg\"><text id=\"t4\" x=\"1\" y=\"45\">four</text></a>",
  "<svg id=\"s-inner\" x=\"50\" width=\"10\" height=\"10\"><text id=\"t-nested\">n</text></svg>",
  "</svg>",
  "</main></body></html>",
].join("\n");
const HTML_BYTES = Buffer.from(HTML, "utf8");
const HTML_SHA = createHash("sha256").update(HTML_BYTES).digest("hex");
const DOC_PATH = "/corpus/documents/syn.html";
const CWD = "/corpus";
const RULES = [
  "layout/widow",
  "layout/orphaned-continuation-page",
  "layout/half-empty-page",
  "svg/text-overflows-viewport",
  "type/straight-quotes",
  "artifact/local-uri",
];
const INDEX: SourceIndex = indexSource(HTML_BYTES);

function span(id: string): { start: number; end: number } {
  const element = INDEX.byId.get(id)?.[0];
  assert.ok(element, `fixture has no #${id}`);
  return { start: element.start, end: element.end };
}

type Json = Record<string, unknown>;
type RuleLists = { mustFire?: Json[]; mustNotFire?: Json[]; allowed?: Json[]; expectedDeclines?: Json[] };

function expectedFile(rules: Record<string, RuleLists> = {}, overrides: Json = {}): Json {
  return {
    schemaVersion: "selfauthored-expected-v1",
    documentId: "syn",
    artifact: "documents/syn.html",
    sha256: HTML_SHA,
    byteLength: HTML_BYTES.length,
    profile: "default",
    pages: { range: [2, 3], measured: 2, basis: "synthetic" },
    expectedExit: { set: [0, 1], derivation: "synthetic", byCode: { "0": "clean", "1": "error" } },
    rules: Object.fromEntries(RULES.map((ruleId) => [ruleId, {
      mustFire: rules[ruleId]?.mustFire ?? [],
      mustNotFire: rules[ruleId]?.mustNotFire ?? [],
      allowed: rules[ruleId]?.allowed ?? [],
      expectedDeclines: rules[ruleId]?.expectedDeclines ?? [],
    }])),
    permittedDeclineReasons: ["env/forced-break", "env/svg-painted-bounds-unsupported"],
    notActiveInDefaultProfile: ["layout/half-empty-page"],
    verification: { fontStacks: { reference: "machine", dejavu: "no-liberation", free: "free" } },
    notes: [],
    ...overrides,
  };
}

function compile(raw: Json): CompiledExpected {
  return compileExpected(raw, INDEX, { id: "syn", artifact: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length });
}

let findingSerial = 0;
function finding(ruleId: string, where: { start: number; end: number } | null, extra: Partial<Finding> = {}): Finding {
  findingSerial += 1;
  return {
    runFindingId: `f${findingSerial}`,
    ruleId,
    page: 1,
    message: "synthetic",
    source: where === null ? null : {
      file: "documents/syn.html",
      line: 1,
      column: 1,
      offset: where.start,
      endLine: 1,
      endColumn: 1,
      endOffset: where.end,
      coordinateSystem: "utf8-bytes-unicode-codepoints-v1",
    },
    ...extra,
  } as Finding;
}

function outcome(findings: Finding[], options: { exit?: number; reason?: string | null; pages?: number; notMeasured?: Json[]; reportExit?: number; activeRules?: string[] } = {}): RunOutcome {
  const exit = options.exit ?? (findings.length ? 1 : 0);
  const report = {
    schemaVersion: 5,
    exitCode: options.reportExit ?? exit,
    config: { profile: "default", activeRules: options.activeRules ?? RULES.filter((ruleId) => ruleId !== "layout/half-empty-page") },
    documents: [{
      exitReason: options.reason ?? null,
      pages: options.pages ?? 2,
      inputIdentity: { html: HTML_SHA },
      findings,
      notMeasured: options.notMeasured ?? [],
    }],
  } as unknown as Report;
  return { exitCode: exit, signal: null, report, reportProblem: null, stderr: "" };
}

function judge(raw: Json, run: RunOutcome) {
  return evaluateDocument(compile(raw), run, { documentPath: DOC_PATH, cwd: CWD, sha256: HTML_SHA });
}

function assertPass(verdict: ReturnType<typeof judge>): void {
  assert.deepEqual(verdict.failures, [], "expected a pass");
  assert.equal(verdict.pass, true);
}

function assertFail(verdict: ReturnType<typeof judge>, pattern: RegExp): void {
  assert.equal(verdict.pass, false, "expected a failure");
  assert.ok(verdict.failures.some((failure) => pattern.test(failure)), `no failure matches ${pattern}: ${JSON.stringify(verdict.failures)}`);
}

test("spans are HTML5 element ranges in UTF-8 bytes, computed by the gate itself", () => {
  // Hand-computed: '<p id="a">' is 10 bytes, 'ä' is 2, '</p>' is 4.
  const small = indexSource(Buffer.from("<p id=\"a\">ä</p><p id=\"b\">x</p>", "utf8"));
  assert.deepEqual([small.byId.get("a")![0]!.start, small.byId.get("a")![0]!.end], [0, 16]);
  assert.deepEqual([small.byId.get("b")![0]!.start, small.byId.get("b")![0]!.end], [16, 31]);
  // An omitted end tag closes where tree construction closes the element.
  const implied = indexSource(Buffer.from("<ul><li id=\"i1\">a<li id=\"i2\">b</ul>", "utf8"));
  assert.deepEqual([implied.byId.get("i1")![0]!.start, implied.byId.get("i1")![0]!.end], [4, 17]);
  assert.throws(() => indexSource(Buffer.from("﻿<p>x</p>", "utf8")), /byte-order mark/u);
  assert.throws(() => indexSource(Buffer.from([0x3c, 0x70, 0x3e, 0xff])), /not valid UTF-8/u);
  // The fixture's non-ASCII heading is counted in bytes, not code units.
  const heading = span("h-a");
  assert.equal(HTML_BYTES.subarray(heading.start, heading.end).toString("utf8"), "<h2 id=\"h-a\">Überblick</h2>");
});

test("id and within match by source containment, inclusively, in the document only", () => {
  const raw = expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }], allowed: [{ target: { within: "main" }, class: "font-dependent" }] } });
  assertPass(judge(raw, outcome([finding("layout/widow", span("p1"))])));
  // A finding inside an inline child still lies within the paragraph.
  assertPass(judge(raw, outcome([finding("layout/widow", span("inner"))])));
  // Straddling the end of the span is not within it.
  const p1 = span("p1");
  const straddle = judge(raw, outcome([finding("layout/widow", { start: p1.start, end: p1.end + 1 })]));
  assertFail(straddle, /mustFire missed/u);
  // Same offsets, another file: not this document.
  const elsewhere = judge(raw, outcome([finding("layout/widow", p1, { source: { ...finding("x", p1).source!, file: "other.html" } })]));
  assertFail(elsewhere, /mustFire missed/u);
  // `within` includes X itself.
  const within = expectedFile({ "layout/widow": { mustFire: [{ target: { within: "p2" } }] } });
  assertPass(judge(within, outcome([finding("layout/widow", span("p2"))])));
});

test("ids, selector and selectors match every listed or selected element, and unsupported syntax is refused", () => {
  const raw = expectedFile({ "layout/widow": { mustNotFire: [{ target: { selectors: ["#tbl tr", "h3:not(#h3-b)"] } }, { target: { ids: ["p-plain", "h-a"] } }] } });
  assertFail(judge(raw, outcome([finding("layout/widow", span("r2"))])), /mustNotFire violated/u);
  assertFail(judge(raw, outcome([finding("layout/widow", span("h3-a"))])), /mustNotFire violated/u);
  assertFail(judge(raw, outcome([finding("layout/widow", span("h-a"))])), /mustNotFire violated/u);
  // #h3-b is carved out by :not(); the finding then only fails the closed world.
  const carved = judge(raw, outcome([finding("layout/widow", span("h3-b"))]));
  assert.equal(carved.mustNotFireViolations, 0);
  assertFail(carved, /unaccounted finding/u);
  assert.deepEqual(selectElements(INDEX, "h3.k").map((element) => element.id), ["h3-a"]);
  assert.throws(() => selectElements(INDEX, "main > p"), /descendant combinators/u);
  assert.throws(() => selectElements(INDEX, "p:first-child"), /unsupported syntax/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustNotFire: [{ target: { selector: "#nothing tr" } }] } })), /matches no element/u);
});

test("a document target matches findings whose source is null, and except carves findings out", () => {
  const raw = expectedFile({
    "type/straight-quotes": {
      mustNotFire: [{ target: { document: true, except: [{ id: "p2" }] } }],
      allowed: [{ target: { id: "p2" }, class: "docs-silent" }],
    },
  });
  assertFail(judge(raw, outcome([finding("type/straight-quotes", null)])), /mustNotFire violated/u);
  assertFail(judge(raw, outcome([finding("type/straight-quotes", span("p1"))])), /mustNotFire violated/u);
  assertPass(judge(raw, outcome([finding("type/straight-quotes", span("a-file"))])));
  assert.throws(() => compile(expectedFile({ "type/straight-quotes": { mustNotFire: [{ target: { id: "p1", except: [{ id: "p2" }] } }] } })), /except is used only on document targets/u);
});

test("svg texts need X as nearest <svg>; a use target matches the referenced <text>", () => {
  const raw = expectedFile({ "svg/text-overflows-viewport": { mustFire: [{ target: { svg: "s1", id: "t3" } }], mustNotFire: [{ target: { svg: "s1", texts: ["t1", "t2"] } }, { target: { svg: "s1", use: "u1" } }] } });
  assertPass(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t3"))])));
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t3")), finding("svg/text-overflows-viewport", span("t2"))])), /mustNotFire violated.*texts/u);
  // The <use> target is the span of #tdef, which #u1 references, not the span of #u1 itself.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t3")), finding("svg/text-overflows-viewport", span("tdef"))])), /mustNotFire violated.*use/u);
  const onUse = judge(raw, outcome([finding("svg/text-overflows-viewport", span("t3")), finding("svg/text-overflows-viewport", span("u1"))]));
  assert.equal(onUse.mustNotFireViolations, 0);
  assertFail(onUse, /unaccounted finding/u);
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { mustNotFire: [{ target: { svg: "s1", texts: ["t-nested"] } }] } })), /nearest <svg>/u);
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { mustNotFire: [{ target: { svg: "s1", use: "t1" } }] } })), /not an SVG <use>/u);
});

test("artifact/local-uri matches by message, xlink:href by its local name href, id targets through descendants", () => {
  const raw = expectedFile({
    "artifact/local-uri": {
      mustFire: [
        { target: { uri: { attribute: "href", value: "file:///srv/x.txt" }, id: "a-file" } },
        { target: { uri: { attribute: "xlink:href", value: "file:///opt/d.svg" }, id: "svg-link" } },
      ],
      mustNotFire: [{ target: { id: "a-rel" } }, { target: { id: "p-plain" } }],
    },
  });
  const local = (message: string) => finding("artifact/local-uri", null, { message: `Local URI ${message} will not resolve.` });
  assertPass(judge(raw, outcome([local("href=\"file:///srv/x.txt\""), local("href=\"file:///opt/d.svg\"")])));
  // The quoted value is compared exactly: a longer value is another URI.
  assertFail(judge(raw, outcome([local("href=\"file:///srv/x.txt\""), local("href=\"file:///opt/d.svgz\"")])), /mustFire missed.*xlink:href/u);
  // An id target reads the URI-bearing attributes of X and its descendants.
  const viaParagraph = expectedFile({ "artifact/local-uri": { mustNotFire: [{ target: { id: "p2" } }] } });
  assertFail(judge(viaParagraph, outcome([local("href=\"x.html\"")])), /mustNotFire violated/u);
  // An element without any URI-bearing attribute can never match; the closed world still catches it.
  const plain = judge(raw, outcome([local("href=\"file:///srv/x.txt\""), local("href=\"file:///opt/d.svg\""), local("href=\"No link here.\"")]));
  assert.equal(plain.mustNotFireViolations, 0);
  assertFail(plain, /unaccounted finding/u);
  // uri plus id must name an attribute of X.
  assert.throws(() => compile(expectedFile({ "artifact/local-uri": { mustFire: [{ target: { uri: { attribute: "href", value: "x.html" }, id: "a-file" } }] } })), /not an attribute/u);
});

test("page targets match Finding.page; the pages allowance excludes the mustNotFire pages", () => {
  const byStack = (pages: number[]) => ({ reference: pages, dejavu: pages, free: pages });
  const raw = expectedFile({
    "layout/orphaned-continuation-page": {
      mustFire: [{ target: { pageOf: { id: "p1", fragment: "last", resolvedPages: [3], resolvedPagesByFontStack: byStack([3]) } } }],
      mustNotFire: [{ target: { pageOf: { id: "p1", fragment: "middle", resolvedPages: [2], resolvedPagesByFontStack: byStack([2]) } } }],
      allowed: [{ target: { pages: "any page not named in mustNotFire" }, class: "font-dependent" }],
    },
  });
  assertPass(judge(raw, outcome([finding("layout/orphaned-continuation-page", null, { page: 3 }), finding("layout/orphaned-continuation-page", null, { page: 1 })])));
  const onForbiddenPage = judge(raw, outcome([finding("layout/orphaned-continuation-page", null, { page: 3 }), finding("layout/orphaned-continuation-page", null, { page: 2 })]));
  assertFail(onForbiddenPage, /mustNotFire violated/u);
  // The allowance does not reach a mustNotFire page, so that finding is also unaccounted.
  assert.equal(onForbiddenPage.unaccounted, 1);
  assertFail(judge(raw, outcome([finding("layout/orphaned-continuation-page", null, { page: 1 })])), /mustFire missed/u);
  const broken = expectedFile({ "layout/orphaned-continuation-page": { mustFire: [{ target: { pageOf: { id: "p1", fragment: "last", resolvedPages: [3], resolvedPagesByFontStack: { reference: [3], dejavu: [4], free: [3] } } } }] } });
  assert.throws(() => compile(broken), /not the union/u);
});

test("closed world: every finding must be accounted for by mustFire or allowed", () => {
  const raw = expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }], allowed: [{ target: { id: "p2" }, class: "font-dependent" }] } });
  assertPass(judge(raw, outcome([finding("layout/widow", span("p1")), finding("layout/widow", span("p2"))])));
  const extra = judge(raw, outcome([finding("layout/widow", span("p1")), finding("layout/widow", span("p-plain"))]));
  assert.equal(extra.unaccounted, 1);
  assertFail(extra, /unaccounted finding \(closed world\)/u);
  // A finding of another rule on a covered element is not covered by this rule's entries.
  assertFail(judge(raw, outcome([finding("layout/widow", span("p1")), finding("type/straight-quotes", span("p1"))])), /unaccounted finding.*straight-quotes/u);
  // A rule the expected file does not name.
  assertFail(judge(raw, outcome([finding("layout/widow", span("p1")), finding("layout/unknown", span("p1"))])), /does not name/u);
  // The inactive rule fails on any finding.
  assertFail(judge(raw, outcome([finding("layout/widow", span("p1")), finding("layout/half-empty-page", null)])), /not active in the default profile/u);
});

test("required declines are checked by count per rule and reason, never per target", () => {
  const raw = expectedFile({
    "layout/widow": {
      expectedDeclines: [
        { target: { id: "p1" }, reason: "env/forced-break", required: true, count: 2 },
        { target: { id: "p2" }, reason: "env/forced-break", required: true, count: 1 },
      ],
    },
  });
  const rows = (count: number, reason = "env/forced-break") => [{ scope: "block", ruleId: "layout/widow", reason, target: null, count }];
  assertPass(judge(raw, outcome([], { notMeasured: [...rows(1), ...rows(2)] })));
  assertFail(judge(raw, outcome([], { notMeasured: rows(2) })), /report declines 2, the required entries sum to 3/u);
  assertFail(judge(raw, outcome([], { notMeasured: rows(4) })), /report declines 4/u);
  assertFail(judge(raw, outcome([])), /report declines 0/u);
  // Another rule's rows do not count toward this rule.
  assertFail(judge(raw, outcome([], { notMeasured: [...rows(2), { scope: "block", ruleId: "type/straight-quotes", reason: "env/forced-break", target: null, count: 1 }] })), /report declines 2/u);
});

test("a non-required decline is checked only against permittedDeclineReasons", () => {
  const raw = expectedFile({ "layout/widow": { expectedDeclines: [{ target: { within: "main" }, reason: "env/forced-break", required: false }] } });
  assertPass(judge(raw, outcome([])));
  assertPass(judge(raw, outcome([], { notMeasured: [{ scope: "block", ruleId: "layout/widow", reason: "env/forced-break", target: null, count: 7 }] })));
  assertFail(judge(raw, outcome([], { notMeasured: [{ scope: "block", ruleId: "layout/widow", reason: "env/multicolumn", target: null, count: 1 }] })), /outside permittedDeclineReasons/u);
  assertFail(judge(raw, outcome([], { notMeasured: [{ scope: "page", ruleId: null, reason: "env/evidence-fragment-outside-page", target: null, count: 1 }] })), /outside permittedDeclineReasons/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { expectedDeclines: [
    { target: { id: "p1" }, reason: "env/forced-break", required: true, count: 1 },
    { target: { id: "p2" }, reason: "env/forced-break", required: false },
  ] } })), /mixed/u);
});

test("measuredAlternative entries are all or nothing per rule and reason", () => {
  const raw = expectedFile({
    "svg/text-overflows-viewport": {
      expectedDeclines: [
        {
          target: { svg: "s1", texts: ["t1", "t2"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 2, measuredAlternative: true,
          perText: [{ id: "t1", ifMeasured: "mustNotFire" }, { id: "t2", ifMeasured: "mustFire" }],
        },
        { target: { svg: "s1", use: "u1" }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 1, measuredAlternative: true, ifMeasured: "mustNotFire" },
      ],
    },
  });
  const rows = (count: number) => [{ scope: "svg", ruleId: "svg/text-overflows-viewport", reason: "env/svg-painted-bounds-unsupported", target: null, count }];
  // Declined: the report's sum equals the entries' total.
  const declined = judge(raw, outcome([], { notMeasured: rows(3) }));
  assertPass(declined);
  assert.equal(declined.declines[0]!.state, "declined");
  // Declined, but a finding on a target is not covered by the alternative.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2"))], { notMeasured: rows(3) })), /unaccounted finding/u);
  // Measured: the mustFire text needs a finding, and that finding is covered.
  const measured = judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2"))]));
  assertPass(measured);
  assert.equal(measured.declines[0]!.state, "measured");
  assertFail(judge(raw, outcome([])), /measured target without a finding/u);
  // Measured: a mustNotFire text, including the text a <use> references, must have none.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2")), finding("svg/text-overflows-viewport", span("t1"))])), /ifMeasured mustNotFire.*t1/u);
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2")), finding("svg/text-overflows-viewport", span("tdef"))])), /ifMeasured mustNotFire.*use/u);
  // Any other sum fails, below and above the total.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2"))], { notMeasured: rows(1) })), /all \(3\) or nothing \(0\)/u);
  assertFail(judge(raw, outcome([], { notMeasured: rows(4) })), /all \(3\) or nothing \(0\)/u);
  // The format invariants hold: count equals the number of targets, perText equals texts.
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { expectedDeclines: [{
    target: { svg: "s1", texts: ["t1", "t2"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 3, measuredAlternative: true,
    perText: [{ id: "t1", ifMeasured: "mustNotFire" }, { id: "t2", ifMeasured: "mustFire" }],
  }] } })), /count 3 differs/u);
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { expectedDeclines: [{
    target: { svg: "s1", texts: ["t1", "t2"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 2, measuredAlternative: true,
    perText: [{ id: "t1", ifMeasured: "mustNotFire" }],
  }] } })), /perText ids differ/u);
});

test("exit and page steps: exit 3 passes only as render-unstable in the set; otherwise set and range", () => {
  const withThree = expectedFile({}, { expectedExit: { set: [0, 3], derivation: "d", byCode: { "0": "a", "3": "b" } } });
  const skipped = judge(withThree, outcome([finding("layout/widow", span("p1"))], { exit: 3, reason: "render-unstable", pages: 0 }));
  assertPass(skipped);
  assert.equal(skipped.ruleChecksSkipped, true);
  assertFail(judge(withThree, outcome([], { exit: 3, reason: "injection-interference", pages: 0 })), /only render-unstable passes/u);
  assertFail(judge(expectedFile(), outcome([], { exit: 3, reason: "render-unstable", pages: 0 })), /exit 3 .* not in the expected set/u);
  assertFail(judge(expectedFile(), outcome([], { exit: 4, reason: "insufficient-coverage" })), /exit 4 .* not in the expected set/u);
  assertFail(judge(expectedFile(), outcome([], { pages: 4 })), /pages 4 outside \[2, 3\]/u);
  assertFail(judge(expectedFile(), outcome([], { pages: 1 })), /pages 1 outside/u);
  assertFail(judge(expectedFile(), outcome([], { reportExit: 1 })), /differs from the process exit/u);
  assertFail(judge(expectedFile(), { exitCode: 0, signal: null, report: null, reportProblem: "none written", stderr: "" }), /no canonical JSON report/u);
});

test("an unknown field anywhere the gate interprets fails the expected file", () => {
  assert.throws(() => compile({ ...expectedFile(), surprise: 1 }), /unknown field "surprise"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" }, dependsOn: "G-02" }] } })), /unknown field "dependsOn"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1", nth: 2 } }] } })), /unknown field "nth"/u);
  assert.throws(() => compile(expectedFile({}, { pages: { range: [2, 3], exact: 2 } })), /unknown field "exact"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "nope" } }] } })), /no element with id "nope"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { allowed: [{ target: { id: "p1" }, class: "sometimes" }] } })), /class sometimes/u);
});

// ---------------------------------------------------------------------------------------------
// The process boundary: a temporary one-document corpus and a stand-in CLI.

const FAKE_CLI = `
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
const argv = process.argv.slice(2);
const out = argv[argv.indexOf("--out") + 1];
const input = argv[argv.length - 1];
const spec = JSON.parse(readFileSync(process.env.FAKE_SPEC, "utf8"));
const html = createHash("sha256").update(readFileSync(input)).digest("hex");
// As the real report does for a path under the home directory, an absolute input is echoed
// redacted, so a gate that passed absolute paths could not resolve any source to its document.
const file = isAbsolute(input) ? "~" + input.slice(input.indexOf("/", 1)) : input;
const findings = spec.findings.map((f, i) => ({ runFindingId: "f" + i, page: 1, message: "m", ...f,
  source: f.source ? { ...f.source, file, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" } : null }));
writeFileSync(out, JSON.stringify({ schemaVersion: 5, exitCode: spec.exit, config: { profile: "default", activeRules: spec.activeRules },
  documents: [{ exitReason: null, pages: 2, inputIdentity: { html }, findings, notMeasured: [] }] }));
process.exit(spec.exit);
`;

function makeCorpus(options: { documents?: number; expected?: Json } = {}) {
  const root = mkdtempSync(join(tmpdir(), "breaklint-corpus-gate-test-"));
  const corpus = join(root, "corpus");
  mkdirSync(join(corpus, "documents"), { recursive: true });
  mkdirSync(join(corpus, "expected"), { recursive: true });
  writeFileSync(join(corpus, "documents/syn.html"), HTML_BYTES);
  const expectedBytes = Buffer.from(JSON.stringify(options.expected ?? expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }] } })));
  writeFileSync(join(corpus, "expected/syn.expected.json"), expectedBytes);
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const files = [
    { path: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length },
    { path: "expected/syn.expected.json", sha256: digest(expectedBytes), byteLength: expectedBytes.length },
  ];
  const documents = (options.documents ?? 1) === 0 ? [] : [{
    id: "syn",
    artifact: { relativePath: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length },
    expected: { relativePath: "expected/syn.expected.json", sha256: digest(expectedBytes), schemaVersion: "selfauthored-expected-v1" },
    pagesRange: [2, 3],
    expectedExit: [0, 1],
  }];
  const manifest = { contractVersion: "selfauthored-corpus-v1", manifestId: "syn-v1", calibrationEvidenceEligible: false, profile: "default", documentCount: documents.length, documents, files };
  writeFileSync(join(corpus, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "fake-cli.mjs"), FAKE_CLI);
  return { root, corpus, manifest };
}

function runGateProcess(root: string, corpus: string, spec: Json) {
  writeFileSync(join(root, "spec.json"), JSON.stringify(spec));
  return spawnSync(process.execPath, ["--experimental-strip-types", GATE, "--corpus", corpus, "--cli", join(root, "fake-cli.mjs"), "--cwd", root], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FAKE_SPEC: join(root, "spec.json") },
  });
}

const ACTIVE = RULES.filter((ruleId) => ruleId !== "layout/half-empty-page");
const p1 = span("p1");

test("process boundary: a matching run passes with exit 0 and prints the verdict table", () => {
  const { root, corpus } = makeCorpus();
  try {
    const run = runGateProcess(root, corpus, { exit: 1, activeRules: ACTIVE, findings: [{ ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } }] });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /\| syn +\| 1 \{0,1\} +\|/u);
    assert.match(run.stdout, /corpus gate: PASS: 1\/1 documents passed\n$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process boundary: an unaccounted finding fails the gate", () => {
  const { root, corpus } = makeCorpus();
  try {
    const plain = span("p-plain");
    const run = runGateProcess(root, corpus, { exit: 1, activeRules: ACTIVE, findings: [
      { ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } },
      { ruleId: "layout/widow", source: { offset: plain.start, endOffset: plain.end } },
    ] });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /FAIL syn: unaccounted finding \(closed world\)/u);
    assert.match(run.stdout, /corpus gate: FAIL: 0\/1 documents passed/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process boundary: zero documents is a failure, never a skip", () => {
  const { root, corpus } = makeCorpus({ documents: 0 });
  try {
    const run = runGateProcess(root, corpus, { exit: 0, activeRules: ACTIVE, findings: [] });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /zero documents/u);
    assert.throws(() => verifyManifest(corpus), /zero documents/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process boundary: a hash or length mismatch fails before anything runs", () => {
  const { root, corpus, manifest } = makeCorpus();
  try {
    // One flipped byte in the document, same length.
    const tampered = Buffer.from(HTML_BYTES);
    tampered[tampered.length - 2] = 0x41;
    writeFileSync(join(corpus, "documents/syn.html"), tampered);
    const run = runGateProcess(root, corpus, { exit: 1, activeRules: ACTIVE, findings: [{ ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } }] });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /documents\/syn\.html: SHA-256 [0-9a-f]{64}, manifest says/u);
    assert.doesNotMatch(run.stdout, /\| syn /u, "no document may be judged after a hash mismatch");
    writeFileSync(join(corpus, "documents/syn.html"), HTML_BYTES);
    writeFileSync(join(corpus, "manifest.json"), JSON.stringify({ ...manifest, files: manifest.files.map((file) => ({ ...file, byteLength: file.byteLength + 1 })) }));
    assert.throws(() => verifyManifest(corpus), /byte length/u);
    writeFileSync(join(corpus, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(corpus, "expected/extra.expected.json"), "{}");
    assert.throws(() => verifyManifest(corpus), /not bound by the manifest/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process boundary: an unknown field in an expected file fails the gate", () => {
  const { root, corpus } = makeCorpus({ expected: { ...expectedFile(), dependsOn: "WP-F1" } });
  try {
    const run = runGateProcess(root, corpus, { exit: 0, activeRules: ACTIVE, findings: [] });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /unknown field "dependsOn"/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the frozen corpus verifies and compiles, and CI runs the gate with the default binding", () => {
  // Every expected file validates and every target resolves in its document before any run.
  const manifest = verifyManifest(join(ROOT, "corpus/public/selfauthored-v1"));
  assert.equal(manifest.documents.length, 20);
  for (const document of manifest.documents) {
    compileExpected(JSON.parse(readFileSync(document.expectedPath, "utf8")), indexSource(readFileSync(document.htmlPath)), {
      id: document.id,
      artifact: `documents/${document.id}.html`,
      sha256: document.sha256,
      byteLength: document.byteLength,
    });
  }
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["test:corpus"], "node --experimental-strip-types tests/tools/corpus-gate.ts --cwd .");
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const check = ci.slice(ci.indexOf("\n  check:"), ci.indexOf("\n  node-floor:"));
  assert.ok(check.includes("run: npm run test:corpus"), "the check job does not run the corpus gate");
  assert.ok(check.indexOf("npm run test:corpus") > check.indexOf("npm run test:live"), "the corpus gate runs before the live suite");
  assert.ok(check.indexOf("npm run test:corpus") > check.indexOf("npm run build"), "the corpus gate runs before the CLI is built");
  assert.doesNotMatch(ci, /no-evidence-binding/u);
});

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
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Finding, Report } from "../../src/core/types.ts";
import { conditionKeys, executablePart, jobsOf, stepsOf } from "../tools/release-workflow-contract.mjs";
import {
  compileExpected,
  ENTRY_FIELDS,
  evaluateDocument,
  EXCEPT_ITEM_SHAPE,
  FIELD_LIST,
  indexSource,
  PAGE_OF_FIELDS,
  PER_TEXT_FIELDS,
  processGroupMembers,
  selectElements,
  summarizeGate,
  TARGET_SHAPES,
  URI_FIELDS,
  verifyManifest,
  type Field,
  type FieldType,
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
  "<p id=\"p-amp\"><a id=\"a-amp\" href=\"file:///srv/a&amp;b.txt\">z</a></p>",
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

const withWhy = (entries: Json[] | undefined): Json[] => (entries ?? []).map((entry) => ({ why: "synthetic", ...entry }));

function expectedFile(rules: Record<string, RuleLists> = {}, overrides: Json = {}): Json {
  // Every top-level key of the README's field list is required, so the fixture carries all of them.
  return {
    schemaVersion: "selfauthored-expected-v1",
    documentId: "syn",
    artifact: "documents/syn.html",
    sha256: HTML_SHA,
    byteLength: HTML_BYTES.length,
    authoredOn: "2026-09-25",
    provenanceClass: "synthetic_first_party",
    calibrationEvidenceEligible: false,
    title: "synthetic",
    genre: "test fixture",
    language: { htmlLang: "en", typeRulesUnderDefaultLocale: "synthetic" },
    paper: [{ pageRule: "@page", size: "A4", orientation: "portrait", pageBoxCssPx: [793.7, 1122.5], margins: "20mm", contentBoxCssPx: [642.5, 971.3] }],
    profile: "default",
    pages: { range: [2, 3], measured: 2, basis: "synthetic" },
    expectedExit: { set: [0, 1], derivation: "synthetic", byCode: { "0": "clean", "1": "error" }, environmentNote: "synthetic" },
    fontDependence: "synthetic",
    features: [],
    runningElements: [],
    constructionFacts: [],
    rules: Object.fromEntries(RULES.map((ruleId) => [ruleId, {
      mustFire: withWhy(rules[ruleId]?.mustFire),
      mustNotFire: withWhy(rules[ruleId]?.mustNotFire),
      allowed: withWhy(rules[ruleId]?.allowed),
      expectedDeclines: rules[ruleId]?.expectedDeclines ?? [],
    }])),
    parityBlankPages: { count: 0, byFontStack: { reference: [] }, basis: "synthetic" },
    permittedDeclineReasons: ["env/forced-break", "env/svg-painted-bounds-unsupported"],
    notActiveInDefaultProfile: ["layout/half-empty-page"],
    verification: {
      method: "synthetic", browser: "none", pagedjs: "0.4.3", measuredOn: "2026-09-25", pageCount: 2,
      pageCountByFontStack: { reference: 2 }, pdfPageCount: 2, contentBoxHeightsPx: [971.3], platformFonts: {},
      overflowColumnResidue: [], fontStacks: { reference: "machine", dejavu: "no-liberation", free: "free" },
    },
    notes: [],
    ...overrides,
  };
}

/** A `perText` item with every field the README's field list names. */
const pt = (id: string, ifMeasured: string): Json => ({ id, ifMeasured, why: "synthetic", strokeWidthPx: 3, cellInsetsPx: {}, fillInkInsetsPx: {}, paintedInkInsetsPx: {} });

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
    config: { profile: "default", activeRules: options.activeRules ?? RULES.filter((ruleId) => ruleId !== "layout/half-empty-page"), disabledRules: ["layout/half-empty-page"] },
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
  // Field list: except belongs to a document target, and every except item is `{id}`.
  assert.throws(() => compile(expectedFile({ "type/straight-quotes": { mustNotFire: [{ target: { id: "p1", except: [{ id: "p2" }] } }] } })), /target shape \{id, except\}/u);
  assert.throws(() => compile(expectedFile({ "type/straight-quotes": { mustNotFire: [{ target: { document: true, except: [{ within: "p2" }] } }] } })), /except\[0\]: target shape \{within\}/u);
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
  // resolvedPagesByFontStack (E43): one entry per label of verification.fontStacks, and
  // resolvedPages is their union (README "Page targets").
  const notUnion = expectedFile({ "layout/orphaned-continuation-page": { mustFire: [{ target: { pageOf: { id: "p1", fragment: "last", resolvedPages: [3], resolvedPagesByFontStack: { reference: [3], dejavu: [4], free: [3] } } } }] } });
  assert.throws(() => compile(notUnion), /resolvedPages \[3\] is not the union of resolvedPagesByFontStack \[3, 4\]/u);
  const missingStack = expectedFile({ "layout/orphaned-continuation-page": { mustFire: [{ target: { pageOf: { id: "p1", fragment: "last", resolvedPages: [3], resolvedPagesByFontStack: { reference: [3], dejavu: [3] } } } }] } });
  assert.throws(() => compile(missingStack), /resolvedPagesByFontStack names dejavu, reference, verification\.fontStacks names reference, dejavu, free/u);
  const mistyped = expectedFile({ "layout/orphaned-continuation-page": { mustFire: [{ target: { pageOf: { id: "p1", fragment: "last", resolvedPages: [3], resolvedPagesByFontStack: { reference: 3, dejavu: [3], free: [3] } } } }] } });
  assert.throws(() => compile(mistyped), /resolvedPagesByFontStack\.reference: expected array of integer/u);
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
  assert.throws(() => compile(expectedFile({ "layout/widow": { expectedDeclines: [
    { target: { id: "p1" }, reason: "env/forced-break", required: true, count: 1 },
    { target: { id: "p2" }, reason: "env/forced-break", required: false },
  ] } })), /mixed/u);
});

test("measuredAlternative entries are all or nothing per rule and reason", () => {
  // Two halo entries under one reason (as sa10 and sa11 have), and a <use> entry under another:
  // the README forbids mixing halo and <use> entries within one rule and reason.
  const raw = expectedFile({
    "svg/text-overflows-viewport": {
      expectedDeclines: [
        {
          target: { svg: "s1", texts: ["t1", "t2"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 2, measuredAlternative: true,
          perText: [pt("t1", "mustNotFire"), pt("t2", "mustFire")],
        },
        {
          target: { svg: "s1", texts: ["t3"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 1, measuredAlternative: true,
          perText: [pt("t3", "mustNotFire")],
        },
        { target: { svg: "s1", use: "u1" }, reason: "env/svg-ctm-unavailable", required: true, count: 1, measuredAlternative: true, ifMeasured: "mustNotFire" },
      ],
    },
  }, { permittedDeclineReasons: ["env/forced-break", "env/svg-painted-bounds-unsupported", "env/svg-ctm-unavailable"] });
  const rows = (count: number) => [{ scope: "svg", ruleId: "svg/text-overflows-viewport", reason: "env/svg-painted-bounds-unsupported", target: null, count }];
  const useRow = { scope: "svg", ruleId: "svg/text-overflows-viewport", reason: "env/svg-ctm-unavailable", target: null, count: 1 };
  // Declined: the report's sum equals the entries' total, per rule and reason.
  const declined = judge(raw, outcome([], { notMeasured: [...rows(3), useRow] }));
  assertPass(declined);
  assert.deepEqual(declined.declines.map((d) => d.state), ["declined", "declined"]);
  // Declined, but a finding on a target is not covered by the alternative.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2"))], { notMeasured: [...rows(3), useRow] })), /unaccounted finding/u);
  // Measured: the mustFire text needs a finding, and that finding is covered.
  const measured = judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2"))]));
  assertPass(measured);
  assert.deepEqual(measured.declines.map((d) => d.state), ["measured", "measured"]);
  assertFail(judge(raw, outcome([])), /measured target without a finding/u);
  // Measured: a mustNotFire text of either entry, and the text a <use> references, must have none.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2")), finding("svg/text-overflows-viewport", span("t1"))])), /ifMeasured mustNotFire.*t1/u);
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2")), finding("svg/text-overflows-viewport", span("t3"))])), /ifMeasured mustNotFire.*t3/u);
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2")), finding("svg/text-overflows-viewport", span("tdef"))])), /ifMeasured mustNotFire.*use/u);
  // Any other sum fails, below and above the total.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t2"))], { notMeasured: rows(1) })), /all \(3\) or nothing \(0\)/u);
  assertFail(judge(raw, outcome([], { notMeasured: [...rows(4), useRow] })), /all \(3\) or nothing \(0\)/u);
  // The format invariants hold: count equals the number of targets, perText equals texts.
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { expectedDeclines: [{
    target: { svg: "s1", texts: ["t1", "t2"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 3, measuredAlternative: true,
    perText: [pt("t1", "mustNotFire"), pt("t2", "mustFire")],
  }] } })), /count 3 differs/u);
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { expectedDeclines: [{
    target: { svg: "s1", texts: ["t1", "t2"] }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 2, measuredAlternative: true,
    perText: [pt("t1", "mustNotFire")],
  }] } })), /perText ids \[t1\] are not the target.s texts \[t1, t2\]/u);
});

test("exit and page steps: exit 3 passes only as render-unstable in the set; otherwise set and range", () => {
  const withThree = expectedFile({}, { expectedExit: { set: [0, 3], derivation: "d", byCode: { "0": "a", "3": "b" }, environmentNote: "e" } });
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

test("E36: {svg, id} matches the span of the <text> T and needs X as T's nearest <svg>", () => {
  const raw = expectedFile({ "svg/text-overflows-viewport": { mustFire: [{ target: { svg: "s1", id: "t4" } }] } });
  // t4 sits inside an <a> inside s1: its nearest <svg> is still s1.
  assertPass(judge(raw, outcome([finding("svg/text-overflows-viewport", span("t4"))])));
  // A finding on the enclosing <a> is not within the text.
  assertFail(judge(raw, outcome([finding("svg/text-overflows-viewport", span("svg-link"))])), /mustFire missed/u);
  // Inside s1 but under the nested svg: s1 is not its nearest <svg>.
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { mustFire: [{ target: { svg: "s1", id: "t-nested" } }] } })), /nearest <svg>/u);
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { mustFire: [{ target: { svg: "s1", id: "svg-link" } }] } })), /not an SVG <text>/u);
});

test("E37: rows with ruleId null are left out only for the two evidence-level declines, each with its scope", () => {
  const raw = expectedFile();
  const row = (scope: string, reason: string) => ({ scope, ruleId: null, reason, target: null, count: 2 });
  const allowed = judge(raw, outcome([], { notMeasured: [row("page", "env/evidence-fragment-outside-page"), row("document", "env/evidence-overlay-removed")] }));
  assertPass(allowed);
  assert.equal(allowed.evidenceLevelDeclines, 4);
  // Any other reason without a rule fails, even one the document permits for its rules.
  assertFail(judge(raw, outcome([], { notMeasured: [row("page", "env/forced-break")] })), /ruleId null that is not an evidence-level decline: page env\/forced-break/u);
  // The right reason under the other scope is not exempt.
  assertFail(judge(raw, outcome([], { notMeasured: [row("document", "env/evidence-fragment-outside-page")] })), /not an evidence-level decline/u);
  assertFail(judge(raw, outcome([], { notMeasured: [row("page", "env/evidence-overlay-removed")] })), /not an evidence-level decline/u);
  // The exemption covers the per-rule checks, not the exit: an evidence exit 4 outside the set fails.
  assertFail(judge(raw, outcome([], { exit: 4, reason: "evidence/required-page-binding-incomplete", notMeasured: [row("page", "env/evidence-fragment-outside-page")] })), /exit 4 .* not in the expected set/u);
});

test("E41: env/parity-blank-page rows without a rule are checked by count against parityBlankPages", () => {
  const parity = (scope: string, count: number) => ({ scope, ruleId: null, reason: "env/parity-blank-page", target: null, count });
  const two = expectedFile({}, { parityBlankPages: { count: 2, byFontStack: { reference: [4, 8] }, basis: "synthetic" } });
  // Matching: the counts of all rows add up to the construction fact.
  const matching = judge(two, outcome([], { notMeasured: [parity("page", 1), parity("page", 1)] }));
  assertPass(matching);
  assert.deepEqual(matching.parityBlankPages, { expected: 2, actual: 2 });
  assertPass(judge(expectedFile(), outcome([])));
  // Mismatching, in both directions.
  assertFail(judge(two, outcome([], { notMeasured: [parity("page", 1)] })), /sum to 1, parityBlankPages\.count is 2/u);
  assertFail(judge(expectedFile(), outcome([], { notMeasured: [parity("page", 1)] })), /sum to 1, parityBlankPages\.count is 0/u);
  // The right reason under the wrong scope fails, and does not count.
  const wrongScope = judge(two, outcome([], { notMeasured: [parity("page", 1), parity("page", 1), parity("document", 1)] }));
  assertFail(wrongScope, /env\/parity-blank-page has scope document, not page/u);
  assert.deepEqual(wrongScope.parityBlankPages, { expected: 2, actual: 2 });
  // The rule-level decline stays outside permittedDeclineReasons.
  assertFail(judge(expectedFile(), outcome([], { notMeasured: [{ scope: "page", ruleId: "layout/orphaned-continuation-page", reason: "env/parity-blank-page", target: null, count: 1 }] })), /outside permittedDeclineReasons: layout\/orphaned-continuation-page env\/parity-blank-page/u);
  // The construction fact is normative and typed.
  const { parityBlankPages: _parity, ...withoutParity } = expectedFile();
  assert.throws(() => compile(withoutParity), /required field "parityBlankPages" is missing/u);
  assert.throws(() => compile(expectedFile({}, { parityBlankPages: { count: -1, byFontStack: {}, basis: "b" } })), /must not be negative/u);
  assert.throws(() => compile(expectedFile({}, { parityBlankPages: { count: 0, byFontStack: { reference: 3 }, basis: "b" } })), /byFontStack\.reference: expected array of integer/u);
});

test("E39: uri values are compared as the parser decodes them, and srcset targets are rejected", () => {
  const raw = expectedFile({ "artifact/local-uri": { mustFire: [{ target: { uri: { attribute: "href", value: "file:///srv/a&b.txt" }, id: "a-amp" } }] } });
  const local = (message: string) => finding("artifact/local-uri", null, { message: `occurrences: 1 (permitted: 0). ${message} resolves only on the machine.` });
  assertPass(judge(raw, outcome([local("href=\"file:///srv/a&b.txt\"")])));
  assertFail(judge(raw, outcome([local("href=\"file:///srv/a&amp;b.txt\"")])), /mustFire missed/u);
  assert.throws(() => compile(expectedFile({ "artifact/local-uri": { mustFire: [{ target: { uri: { attribute: "href", value: "file:///srv/a&amp;b.txt" }, id: "a-amp" } }] } })), /not an attribute/u);
  assert.throws(() => compile(expectedFile({ "artifact/local-uri": { mustFire: [{ target: { uri: { attribute: "srcset", value: "file:///x.png" }, id: "a-amp" } }] } })), /srcset is out of scope/u);
  // A bare `{uri}` is not a Field list shape.
  assert.throws(() => compile(expectedFile({ "artifact/local-uri": { mustFire: [{ target: { uri: { attribute: "href", value: "file:///srv/x.txt" } } }] } })), /target shape \{uri\}/u);
});

test("E40: ids occur exactly once, targets do not repeat, and the page range includes both ends", () => {
  const duplicated = indexSource(Buffer.from("<p id=\"dup\">a</p><p id=\"dup\">b</p><p id=\"one\">c</p>", "utf8"));
  const binding = { id: "syn", artifact: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length };
  assert.throws(() => compileExpected(expectedFile({ "layout/widow": { mustNotFire: [{ target: { id: "dup" } }] } }), duplicated, binding), /id "dup" occurs 2 times/u);
  assert.throws(() => compileExpected(expectedFile({ "layout/widow": { allowed: [{ target: { within: "dup" }, class: "font-dependent" }] } }), duplicated, binding), /id "dup" occurs 2 times/u);
  compileExpected(expectedFile({ "layout/widow": { mustNotFire: [{ target: { id: "one" } }] } }), duplicated, binding);
  // Within one list; across mustFire, mustNotFire and allowed; compared as canonical JSON.
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustNotFire: [{ target: { svg: "s1", texts: ["t1"] } }, { target: { texts: ["t1"], svg: "s1" } }] } })), /repeats the target/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }], allowed: [{ target: { id: "p1" }, class: "font-dependent" }] } })), /repeats the target/u);
  // A mustFire or allowed target may also be an expectedDeclines target; declines compare target and reason.
  compile(expectedFile({ "layout/widow": { allowed: [{ target: { id: "p1" }, class: "font-dependent" }], expectedDeclines: [
    { target: { id: "p1" }, reason: "env/forced-break", required: false },
    { target: { id: "p1" }, reason: "env/multicolumn", required: false },
  ] } }));
  assert.throws(() => compile(expectedFile({ "layout/widow": { expectedDeclines: [
    { target: { id: "p1" }, reason: "env/forced-break", required: false },
    { target: { id: "p1" }, reason: "env/forced-break", required: false },
  ] } })), /repeats the target and reason/u);
  assertPass(judge(expectedFile(), outcome([], { pages: 2 })));
  assertPass(judge(expectedFile(), outcome([], { pages: 3 })));
});

test("the expected rules must be exactly the registered rules the run reports", () => {
  const run = outcome([]);
  (run.report!.config as unknown as { disabledRules: string[] }).disabledRules = [];
  assertFail(judge(expectedFile(), run), /registered rules/u);
});

// ---------------------------------------------------------------------------------------------
// E38: the README's closed field list and the gate's encoding must not diverge.

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/u;
const NOT_KEYS = new Set(["true", "false", "null"]);

/** Key names mentioned in a README cell: backticked names and the items of backticked `{a, b: t}` lists. */
function keysIn(text: string): string[] {
  const keys: string[] = [];
  for (const [, token] of text.matchAll(/`([^`]+)`/gu)) {
    const inner = /^\{(.*)\}$/u.exec(token!);
    const items = inner ? inner[1]!.split(",").map((item) => item.split(":")[0]!.trim()) : [token!];
    for (const item of items) if (IDENTIFIER.test(item) && !NOT_KEYS.has(item)) keys.push(item);
  }
  return keys;
}

interface Flat { name: string; role: "N" | "I"; required: boolean; opaque: boolean }

function nestedOf(type: FieldType): Flat[] {
  switch (type.kind) {
    case "object":
      return Object.entries(type.fields).flatMap(([name, field]) => [
        { name, role: field.role, required: field.required, opaque: field.type.kind === "opaque" },
        ...nestedOf(field.type),
      ]);
    case "array":
    case "map":
      return nestedOf(type.of);
    default:
      return [];
  }
}

const sortedSet = (items: Iterable<string>): string => [...new Set(items)].sort().join(", ");

function fieldListDivergences(readme: string, encoded: {
  top: Record<string, Field>;
  entries: Record<string, Record<string, Field>>;
  perText: Record<string, Field>;
  shapes: string[][];
  uri: Record<string, Field>;
  pageOf: Record<string, Field>;
  exceptItem: string[];
}): string[] {
  const issues: string[] = [];
  const differ = (what: string, readmeSide: string, encodedSide: string): void => {
    if (readmeSide !== encodedSide) issues.push(`${what}: README [${readmeSide}], gate [${encodedSide}]`);
  };
  const start = readme.indexOf("\n## Field list\n");
  if (start < 0) return ["README has no Field list section"];
  const end = readme.indexOf("\n## ", start + 5);
  const section = readme.slice(start, end < 0 ? undefined : end);
  const [topPart, rest] = section.split("\nEntries.");
  if (!rest) return ["Field list has no Entries paragraph"];

  // Top level: every row, key column, role column, nested keys, optional and opaque markers.
  const rows = topPart!.split("\n").filter((line) => line.startsWith("| `"));
  const readmeTop: string[] = [];
  for (const row of rows) {
    const [, keyCell, roleCell, meaning] = row.split("|").map((cell) => cell.trim());
    const role = roleCell as "N" | "I";
    for (const key of keysIn(keyCell!)) {
      readmeTop.push(key);
      const field = encoded.top[key];
      if (!field) continue;
      if (field.role !== role) issues.push(`${key}: README role ${role}, gate ${field.role}`);
      if (!field.required) issues.push(`${key}: the README requires every top-level key`);
      const literal = /^`("[^"]*"|true|false)`$/u.exec(meaning!);
      if (literal) differ(`${key} literal`, literal[1]!, field.type.kind === "literal" ? JSON.stringify(field.type.value) : field.type.kind);
      const nested = nestedOf(field.type);
      differ(`${key} nested keys`, sortedSet(keysIn(meaning!)), sortedSet(nested.map((item) => item.name)));
      const optionalAt = meaning!.indexOf("optional");
      differ(`${key} optional keys`, sortedSet(optionalAt < 0 ? [] : keysIn(meaning!.slice(optionalAt))), sortedSet(nested.filter((item) => !item.required).map((item) => item.name)));
      differ(`${key} opaque keys`, sortedSet([...meaning!.matchAll(/`(\w+)` \((?:[NI], )?opaque\)/gu)].map((match) => match[1]!)), sortedSet(nested.filter((item) => item.opaque).map((item) => item.name)));
      const stated = new Map<string, string>();
      for (const match of meaning!.matchAll(/`(\w+)` \((N|I)\b/gu)) stated.set(match[1]!, match[2]!);
      for (const match of meaning!.matchAll(/`\{([^}]*)\}` \((N|I)\b/gu)) for (const item of match[1]!.split(",")) stated.set(item.trim(), match[2]!);
      for (const item of nested) differ(`${key}.${item.name} role`, stated.get(item.name) ?? role, item.role);
    }
  }
  differ("top-level keys", sortedSet(readmeTop), sortedSet(Object.keys(encoded.top)));

  // Entries: the "Required:" sentence, then the table of N and I keys.
  const entriesText = rest.replace(/\n/gu, " ");
  const requiredSentence = /Required: (.*?) Every other key/u.exec(entriesText)?.[1] ?? "";
  const readmeRequired = new Map<string, Set<string>>();
  for (const match of requiredSentence.matchAll(/((?:`\w+`(?:, | and )?)+) in ((?:`\w+`(?:, | and )?)+)/gu)) {
    for (const list of keysIn(match[2]!)) for (const key of keysIn(match[1]!)) readmeRequired.set(list, new Set([...(readmeRequired.get(list) ?? []), key]));
  }
  const entryRows = rest.split("\n").filter((line) => /^\| `(mustFire|mustNotFire|allowed|expectedDeclines)` \|/u.test(line));
  differ("entry lists", sortedSet(entryRows.map((line) => keysIn(line.split("|")[1]!)[0]!)), sortedSet(Object.keys(encoded.entries)));
  for (const line of entryRows) {
    const [, listCell, nCell, iCell] = line.split("|");
    const list = keysIn(listCell!)[0]!;
    const fields = encoded.entries[list] ?? {};
    const byRole = (role: string) => sortedSet(Object.entries(fields).filter(([, field]) => field.role === role).map(([name]) => name));
    differ(`${list} N keys`, sortedSet(keysIn(nCell!)), byRole("N"));
    differ(`${list} I keys`, sortedSet(keysIn(iCell!)), byRole("I"));
    differ(`${list} required keys`, sortedSet(readmeRequired.get(list) ?? []), sortedSet(Object.entries(fields).filter(([, field]) => field.required).map(([name]) => name)));
    differ(`${list} opaque keys`, sortedSet([...line.matchAll(/`(\w+)` \(opaque\)/gu)].map((match) => match[1]!)), sortedSet(Object.entries(fields).filter(([, field]) => field.type.kind === "opaque").map(([name]) => name)));
  }

  // perText.
  const perText = /`perText\[\]` \([^)]*\): (.*?)\. /u.exec(entriesText)?.[1];
  if (!perText) issues.push("Field list has no perText sentence");
  else {
    const [nPart, iPart] = perText.split(/\(N[^)]*\);/u);
    differ("perText N keys", sortedSet(keysIn(nPart!)), sortedSet(Object.entries(encoded.perText).filter(([, field]) => field.role === "N").map(([name]) => name)));
    differ("perText I keys", sortedSet(keysIn(iPart ?? "")), sortedSet(Object.entries(encoded.perText).filter(([, field]) => field.role === "I").map(([name]) => name)));
    const opaqueAt = (iPart ?? "").indexOf("opaque");
    differ("perText opaque keys", sortedSet(opaqueAt < 0 ? [] : keysIn(iPart!.slice(opaqueAt))), sortedSet(Object.entries(encoded.perText).filter(([, field]) => field.type.kind === "opaque").map(([name]) => name)));
  }

  // Targets: shapes, uri, pageOf, except.
  const shapesText = /in one of these shapes: (.*?)\. `uri` is/u.exec(entriesText)?.[1] ?? "";
  const shape = (keys: string) => keys.split(",").map((key) => key.trim()).sort().join("+");
  differ("target shapes", sortedSet([...shapesText.matchAll(/`\{([^}]*)\}`/gu)].map((match) => shape(match[1]!))), sortedSet(encoded.shapes.map((keys) => shape(keys.join(",")))));
  differ("uri keys", shape(/`uri` is `\{([^}]*)\}`/u.exec(entriesText)?.[1] ?? ""), shape(Object.keys(encoded.uri).join(",")));
  const pageOf = /`pageOf` is\s*`\{([^}]*)\}`[^(]*\(the last one I/u.exec(entriesText)?.[1] ?? "";
  differ("pageOf keys", shape(pageOf), shape(Object.keys(encoded.pageOf).join(",")));
  const pageOfKeys = pageOf.split(",").map((key) => key.trim());
  pageOfKeys.forEach((key, i) => differ(`pageOf.${key} role`, i === pageOfKeys.length - 1 ? "I" : "N", encoded.pageOf[key]?.role ?? "-"));
  differ("except item", shape(/every `except` item is `\{([^}]*)\}`/u.exec(entriesText)?.[1] ?? ""), shape(encoded.exceptItem.join(",")));
  return issues;
}

const ENCODED = { top: FIELD_LIST, entries: ENTRY_FIELDS, perText: PER_TEXT_FIELDS, shapes: TARGET_SHAPES, uri: URI_FIELDS, pageOf: PAGE_OF_FIELDS, exceptItem: EXCEPT_ITEM_SHAPE };
const CORPUS_README = readFileSync(join(ROOT, "corpus/public/selfauthored-v1/README.md"), "utf8");

test("E38: the gate's encoded field list is the README's closed field list", () => {
  assert.deepEqual(fieldListDivergences(CORPUS_README, ENCODED), []);
});

test("E38: a divergence on either side is detected", () => {
  // README gains a key the gate does not know, or loses one it does.
  assert.match(fieldListDivergences(CORPUS_README.replace("`title`, `genre`, `fontDependence`", "`title`, `genre`, `fontDependence`, `subtitle`"), ENCODED).join("\n"), /top-level keys/u);
  assert.match(fieldListDivergences(CORPUS_README.replace("`{reference, dejavu, free}`", "`{reference, dejavu}`"), ENCODED).join("\n"), /verification nested keys/u);
  assert.match(fieldListDivergences(CORPUS_README.replace("`docsBasis`, `observed` (renderer", "`observed` (renderer"), ENCODED).join("\n"), /mustFire I keys/u);
  assert.match(fieldListDivergences(CORPUS_README.replace("`{svg, use}`, ", ""), ENCODED).join("\n"), /target shapes/u);
  // The gate's encoding drops a key, changes a role, makes a key optional or stops treating it as opaque.
  const { genre: _genre, ...withoutGenre } = FIELD_LIST;
  assert.match(fieldListDivergences(CORPUS_README, { ...ENCODED, top: withoutGenre }).join("\n"), /top-level keys/u);
  assert.match(fieldListDivergences(CORPUS_README, { ...ENCODED, top: { ...FIELD_LIST, title: { ...FIELD_LIST.title!, role: "N" } } }).join("\n"), /title: README role I, gate N/u);
  assert.match(fieldListDivergences(CORPUS_README, { ...ENCODED, entries: { ...ENTRY_FIELDS, allowed: { ...ENTRY_FIELDS.allowed, why: { ...ENTRY_FIELDS.allowed.why!, required: false } } } }).join("\n"), /allowed required keys/u);
  assert.match(fieldListDivergences(CORPUS_README, { ...ENCODED, perText: { ...PER_TEXT_FIELDS, cellInsetsPx: { role: "I", required: true, type: { kind: "string" } } } }).join("\n"), /perText opaque keys/u);
});

test("an unknown field anywhere the gate interprets fails the expected file", () => {
  assert.throws(() => compile({ ...expectedFile(), surprise: 1 }), /unknown field "surprise"/u);
  // The field list is closed in both directions: a required field that is missing fails too.
  const { genre: _genre, ...withoutGenre } = expectedFile();
  assert.throws(() => compile(withoutGenre), /required field "genre" is missing/u);
  const withoutWhy = expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }] } });
  delete ((withoutWhy.rules as Record<string, { mustFire: Json[] }>)["layout/widow"]!.mustFire[0]!).why;
  assert.throws(() => compile(withoutWhy), /mustFire\[0\]: required field "why" is missing/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { expectedDeclines: [{ target: { id: "p1" }, reason: "env/forced-break" }] } })), /required field "required" is missing/u);
  // README "Expected files": a reason is a member of ENV_IDS, not merely an env/ string.
  assert.throws(() => compile(expectedFile({ "layout/widow": { expectedDeclines: [{ target: { id: "p1" }, reason: "env/forced-brake", required: false }] } })), /reason env\/forced-brake is not one of src\/core\/enums\.ts ENV_IDS/u);
  // Informational fields are checked for type.
  assert.throws(() => compile(expectedFile({}, { title: 7 })), /syn\.title: expected string/u);
  assert.throws(() => compile(expectedFile({}, { calibrationEvidenceEligible: true })), /calibrationEvidenceEligible: expected false/u);
  // Opaque values are not looked into.
  compile(expectedFile({ "layout/widow": { mustNotFire: [{ target: { id: "p1" }, measured: { anything: [1, { goes: true }] } }] } }));
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" }, dependsOn: "G-02" }] } })), /unknown field "dependsOn"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1", nth: 2 } }] } })), /target shape \{id, nth\}/u);
  assert.throws(() => compile(expectedFile({}, { pages: { range: [2, 3], exact: 2 } })), /unknown field "exact"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { mustFire: [{ target: { id: "nope" } }] } })), /no element with id "nope"/u);
  assert.throws(() => compile(expectedFile({ "layout/widow": { allowed: [{ target: { id: "p1" }, class: "sometimes" }] } })), /class sometimes/u);
});

// ---------------------------------------------------------------------------------------------
// The process boundary: a temporary one-document corpus and a stand-in CLI.

const FAKE_CLI = `
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
const argv = process.argv.slice(2);
const out = argv[argv.indexOf("--out") + 1];
const input = argv[argv.length - 1];
const spec = JSON.parse(readFileSync(process.env.FAKE_SPEC, "utf8"));
// --demo: the stored-snapshot run the gate reads the rule registry from.
if (argv.includes("--demo")) {
  const active = spec.demoActiveRules ?? spec.activeRules;
  writeFileSync(out, JSON.stringify({ schemaVersion: 5, mode: "demo", exitCode: 1, config: { profile: "default", activeRules: active, disabledRules: ["layout/half-empty-page"] }, documents: [] }));
  process.exit(1);
}
const html = createHash("sha256").update(readFileSync(input)).digest("hex");
// As the real report does for a path under the home directory, an absolute input is echoed
// redacted, so a gate that passed absolute paths could not resolve any source to its document.
const file = isAbsolute(input) ? "~" + input.slice(input.indexOf("/", 1)) : input;
const findings = spec.findings.map((f, i) => ({ runFindingId: "f" + i, page: 1, message: "m", ...f,
  source: f.source ? { ...f.source, file, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" } : null }));
if (spec.leaderPid) writeFileSync(spec.leaderPid, String(process.pid));
// A grandchild modelled on Chrome: puppeteer starts the browser detached, so it leads a session and
// process group of its own, outside the CLI's; it starts a child of its own in that session, passes
// a --user-data-dir on its command line, records both pids and may ignore SIGTERM.
if (spec.grandchild) {
  const term = "process.on('SIGTERM', () => {" + (spec.grandchildIgnoresTerm ? "" : " process.exit(0);") + " });";
  const inner = term + "setInterval(() => {}, 1000);";
  const code = term +
    "const c = require('node:child_process').spawn(process.execPath, ['-e', " + JSON.stringify(inner) + "], { stdio: 'ignore' });" +
    "require('node:fs').writeFileSync(" + JSON.stringify(spec.grandchild) + ", process.pid + ' ' + c.pid); setInterval(() => {}, 1000);";
  const extra = spec.profile ? ["--", "--user-data-dir=" + spec.profile] : [];
  spawn(process.execPath, ["-e", code, ...extra], { stdio: "ignore", detached: true }).unref();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { try { if (readFileSync(spec.grandchild, "utf8").includes(" ")) break; } catch {} }
}
if (spec.hang) {
  if (spec.ignoreTerm) process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  writeFileSync(out, JSON.stringify({ schemaVersion: 5, exitCode: spec.exit, config: { profile: "default", activeRules: spec.activeRules, disabledRules: ["layout/half-empty-page"] },
    documents: [{ exitReason: null, pages: 2, inputIdentity: { html }, findings, notMeasured: [] }] }));
  process.exit(spec.exit);
}
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
  // The gate procedure is the real README's, repeated in the manifest as the real corpus does.
  const readmeBytes = readFileSync(join(ROOT, "corpus/public/selfauthored-v1/README.md"));
  writeFileSync(join(corpus, "README.md"), readmeBytes);
  const files = [
    { path: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length },
    { path: "expected/syn.expected.json", sha256: digest(expectedBytes), byteLength: expectedBytes.length },
    { path: "README.md", sha256: digest(readmeBytes), byteLength: readmeBytes.length },
  ];
  const documents = (options.documents ?? 1) === 0 ? [] : [{
    id: "syn",
    artifact: { relativePath: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length },
    expected: { relativePath: "expected/syn.expected.json", sha256: digest(expectedBytes), schemaVersion: "selfauthored-expected-v1" },
    pagesRange: [2, 3],
    expectedExit: [0, 1],
  }];
  const gate = (JSON.parse(readFileSync(join(ROOT, "corpus/public/selfauthored-v1/manifest.json"), "utf8")) as { gate: { steps: string[]; runConditions: string[] } }).gate;
  const manifest = { contractVersion: "selfauthored-corpus-v1", manifestId: "syn-v1", calibrationEvidenceEligible: false, profile: "default", gate, documentCount: documents.length, documents, files };
  writeFileSync(join(corpus, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "fake-cli.mjs"), FAKE_CLI);
  return { root, corpus, manifest };
}

function runGateProcess(root: string, corpus: string, spec: Json, extra: string[] = []) {
  writeFileSync(join(root, "spec.json"), JSON.stringify(spec));
  return spawnSync(process.execPath, ["--experimental-strip-types", GATE, "--corpus", corpus, "--cli", join(root, "fake-cli.mjs"), "--cwd", root, ...extra], {
    cwd: root,
    encoding: "utf8",
    // A gate that never returns must fail this test, not hang it.
    timeout: 60_000,
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

// ---------------------------------------------------------------------------------------------
// Harness integrity: each guard of the gate that is not a README matching rule, red on its own.

test("report shape: one document, schema 5, default profile, bound to the verified bytes", () => {
  const raw = expectedFile();
  const mutate = (change: (report: Record<string, unknown>, document: Record<string, unknown>) => void): RunOutcome => {
    const run = outcome([]);
    const report = run.report as unknown as Record<string, unknown>;
    change(report, (report.documents as Record<string, unknown>[])[0]!);
    return run;
  };
  assertFail(judge(raw, mutate((report, document) => { report.documents = [document, { ...document }]; })), /report holds 2 documents; one document per invocation/u);
  assertFail(judge(raw, mutate((report) => { report.documents = []; })), /report holds 0 documents/u);
  assertFail(judge(raw, mutate((report) => { report.schemaVersion = 4; })), /report schemaVersion 4, this gate reads 5/u);
  assertFail(judge(raw, mutate((report) => { (report.config as Record<string, unknown>).profile = "strict"; })), /report profile strict/u);
  assertFail(judge(raw, mutate((_report, document) => { document.inputIdentity = { html: "0".repeat(64) }; })), /inputIdentity\.html 0{64} is not the verified document/u);
  // L1: a report that binds nothing is not accepted as bound.
  assertFail(judge(raw, mutate((_report, document) => { document.inputIdentity = null; })), /inputIdentity is null/u);
});

test("process outcome: a signal, a missing exit code or a timeout fails the document", () => {
  const raw = expectedFile();
  assertFail(judge(raw, { ...outcome([]), signal: "SIGKILL" }), /terminated by SIGKILL/u);
  assertFail(judge(raw, { ...outcome([]), exitCode: null }), /produced no exit code/u);
  assertFail(judge(raw, { ...outcome([]), timedOutMs: 1234 }), /timed out after 1234 ms/u);
  assertFail(judge(raw, { ...outcome([]), leftovers: { pids: [7], survivedSigkill: [7], removedProfiles: [] } }), /processes the CLI started survived SIGKILL: 7/u);
  const leftover = judge(raw, { ...outcome([]), timedOutMs: null, leftovers: { pids: [7], survivedSigkill: [], removedProfiles: ["/tmp/breaklint-chrome-profile-x"] } });
  assertPass(leftover);
  assert.match(leftover.notes.join("\n"), /left 1 process\(es\) it started; they were terminated/u);
  assert.match(leftover.notes.join("\n"), /removed 1 browser profile\(s\) left behind/u);
});

test("decline rows: a malformed count and a rule the expected file does not name fail", () => {
  const raw = expectedFile();
  const row = (ruleId: string, count: number) => ({ scope: "block", ruleId, reason: "env/forced-break", target: null, count });
  assertFail(judge(raw, outcome([], { notMeasured: [row("layout/widow", 0)] })), /malformed decline row count: layout\/widow env\/forced-break 0/u);
  assertFail(judge(raw, outcome([], { notMeasured: [row("layout/widow", 1.5)] })), /malformed decline row count/u);
  assertFail(judge(raw, outcome([], { notMeasured: [row("layout/unknown", 1)] })), /decline of a rule the expected file does not name: layout\/unknown/u);
});

test("the default profile: a rule listed as not active must not be active", () => {
  const run = outcome([], { activeRules: RULES });
  (run.report!.config as unknown as { disabledRules: string[] }).disabledRules = [];
  assertFail(judge(expectedFile(), run), /layout\/half-empty-page is active/u);
});

test("a source in another coordinate system lies within no span", () => {
  const raw = expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }] } });
  const utf16 = finding("layout/widow", span("p1"));
  (utf16.source as unknown as { coordinateSystem: string }).coordinateSystem = "utf16-code-units";
  assertFail(judge(raw, outcome([utf16])), /mustFire missed/u);
});

test("expected-file invariants the gate enforces before any run", () => {
  const byStack = (pages: number[]) => ({ reference: pages, dejavu: pages, free: pages });
  assert.throws(() => compile(expectedFile({ "layout/orphaned-continuation-page": {
    mustFire: [{ target: { pageOf: { id: "p1", fragment: "last", resolvedPages: [3, 4], resolvedPagesByFontStack: byStack([3, 4]) } } }],
    mustNotFire: [{ target: { pageOf: { id: "p1", fragment: "middle", resolvedPages: [4], resolvedPagesByFontStack: byStack([4]) } } }],
  } })), /page sets overlap on 4/u);
  assert.throws(() => compile(expectedFile({}, { rules: {} })), /rules is empty/u);
  assert.throws(() => compileExpected(expectedFile(), INDEX, { id: "syn", artifact: "documents/syn.html", sha256: "f".repeat(64), byteLength: HTML_BYTES.length }), /binds sha256/u);
  assert.throws(() => compileExpected(expectedFile(), INDEX, { id: "other", artifact: "documents/syn.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length }), /documentId syn does not name the manifest document/u);
  assert.throws(() => compileExpected(expectedFile(), INDEX, { id: "syn", artifact: "documents/other.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length }), /artifact documents\/syn\.html differs/u);
  assert.throws(() => compileExpected(expectedFile(), INDEX, { id: "syn", artifact: "documents/syn.html", sha256: HTML_SHA, byteLength: 1 }), /binds byteLength/u);
  assert.throws(() => compile(expectedFile({ "svg/text-overflows-viewport": { expectedDeclines: [{
    target: { svg: "s1", texts: ["t1"] }, reason: "env/svg-painted-bounds-unsupported", required: false, count: 1, measuredAlternative: true, perText: [pt("t1", "mustNotFire")],
  }] } })), /a measuredAlternative decline is required/u);
  assert.throws(() => compile(expectedFile({ "layout/orphaned-continuation-page": { mustNotFire: [{ target: { pages: "any page not named in mustNotFire" } }] } })), /the pages target is a page-level allowance/u);
});

test("the gate passes only when every bound document was judged and passed", () => {
  const passed = judge(expectedFile(), outcome([]));
  assertPass(passed);
  assert.equal(summarizeGate(1, [passed]).pass, true);
  assert.equal(summarizeGate(2, [passed]).pass, false, "one verdict for two documents is not a pass");
  assert.equal(summarizeGate(1, [{ ...passed, pass: false }]).pass, false);
  assert.throws(() => summarizeGate(0, []), /zero documents were run/u);
});

test("process boundary: configuration in the CLI's cwd, an unknown argument and bad numbers are refused", () => {
  const { root, corpus } = makeCorpus();
  try {
    const spec = { exit: 1, activeRules: ACTIVE, findings: [{ ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } }] };
    const bogus = runGateProcess(root, corpus, spec, ["--bogus"]);
    assert.equal(bogus.status, 1);
    assert.match(bogus.stderr, /unknown argument --bogus/u);
    for (const [flag, value] of [["--timeout-ms", "0"], ["--grace-ms", "x"]] as const) {
      const run = runGateProcess(root, corpus, spec, [flag, value]);
      assert.equal(run.status, 1);
      assert.match(run.stderr, new RegExp(`${flag} must be a positive integer`, "u"));
    }
    writeFileSync(join(root, "breaklint.config.json"), "{}");
    const configured = runGateProcess(root, corpus, spec);
    assert.equal(configured.status, 1);
    assert.match(configured.stderr, /holds a breaklint\.config\.json/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process boundary: the manifest's paths, counts and summaries bind", () => {
  const { root, corpus, manifest } = makeCorpus();
  const rewrite = (change: (copy: typeof manifest) => void) => {
    const copy = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    change(copy);
    writeFileSync(join(corpus, "manifest.json"), JSON.stringify(copy));
  };
  const spec = { exit: 1, activeRules: ACTIVE, findings: [{ ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } }] };
  try {
    writeFileSync(join(root, "outside.txt"), "x");
    rewrite((copy) => { copy.files.push({ path: "../outside.txt", sha256: createHash("sha256").update("x").digest("hex"), byteLength: 1 }); });
    assert.match(runGateProcess(root, corpus, spec).stderr, /path \.\.\/outside\.txt leaves the corpus directory/u);
    rewrite((copy) => { copy.documentCount = 2; });
    assert.match(runGateProcess(root, corpus, spec).stderr, /documentCount 2 differs from 1 listed documents/u);
    rewrite((copy) => { copy.documents[0]!.expectedExit = [1]; });
    assert.match(runGateProcess(root, corpus, spec).stderr, /manifest expectedExit \[1\] differs from the expected file \[0, 1\]/u);
    rewrite((copy) => { copy.documents[0]!.pagesRange = [2, 4]; });
    assert.match(runGateProcess(root, corpus, spec).stderr, /manifest pagesRange differs from the expected file/u);
    // L2: every bound document belongs to exactly one manifest document.
    rewrite((copy) => { copy.documents.push({ ...copy.documents[0]!, id: "syn-twin" }); copy.documentCount = 2; });
    assert.match(runGateProcess(root, corpus, spec).stderr, /documents\/syn\.html belongs to 2 manifest documents \(syn, syn-twin\)/u);
    writeFileSync(join(corpus, "documents/orphan.html"), "<p>x</p>");
    rewrite((copy) => { copy.files.push({ path: "documents/orphan.html", sha256: createHash("sha256").update("<p>x</p>").digest("hex"), byteLength: 8 }); });
    const orphan = runGateProcess(root, corpus, spec);
    assert.equal(orphan.status, 1);
    assert.match(orphan.stderr, /documents\/orphan\.html belongs to no manifest document/u);
    assert.doesNotMatch(orphan.stdout, /\| syn /u, "nothing may be judged when the manifest does not bind");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
    return state !== "Z" && state !== "X";
  } catch {
    return false;
  }
}

function pidsIn(file: string): number[] {
  return readFileSync(file, "utf8").trim().split(" ").map(Number);
}

test("process boundary: on timeout everything the CLI started is terminated, including a browser in its own session", { skip: process.platform !== "linux" ? "reads /proc" : false }, () => {
  for (const ignoreTerm of [false, true]) {
    const { root, corpus } = makeCorpus();
    const pidFile = join(root, "grandchild.pid");
    const leaderFile = join(root, "leader.pid");
    const profile = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-"));
    try {
      const run = runGateProcess(root, corpus, { exit: 1, activeRules: ACTIVE, findings: [], hang: true, ignoreTerm, grandchild: pidFile, grandchildIgnoresTerm: ignoreTerm, leaderPid: leaderFile, profile }, ["--timeout-ms", "1500", "--grace-ms", "500"]);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      assert.match(run.stdout, /FAIL syn: the CLI timed out after 1500 ms; it and every process it started were sent SIGTERM, then SIGKILL/u);
      // SIGTERM first: a CLI that honours it ends on SIGTERM; one that ignores it is killed after the grace period.
      assert.match(run.stdout, new RegExp(`FAIL syn: the CLI was terminated by ${ignoreTerm ? "SIGKILL" : "SIGTERM"}\n`, "u"));
      const [grandchild, greatGrandchild] = pidsIn(pidFile);
      const leader = Number(readFileSync(leaderFile, "utf8"));
      assert.ok(grandchild! > 0 && greatGrandchild! > 0 && leader > 0);
      // The grandchild leads its own group and session, as Chrome does: the CLI's group alone would miss it.
      assert.notEqual(grandchild, leader);
      assert.equal(alive(grandchild!), false, `the detached grandchild ${grandchild} survived (ignoreTerm=${ignoreTerm})`);
      assert.equal(alive(greatGrandchild!), false, `the grandchild's child ${greatGrandchild} survived (ignoreTerm=${ignoreTerm})`);
      assert.deepEqual(processGroupMembers(leader), []);
      assert.deepEqual(processGroupMembers(grandchild!), []);
      assert.equal(existsSync(profile), false, "the browser profile was left behind");
      assert.doesNotMatch(run.stdout, /survived SIGKILL/u);
    } finally {
      for (const pid of existsSync(pidFile) ? pidsIn(pidFile) : []) {
        try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      }
      rmSync(profile, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a zombie is not a live member of a process group", { skip: process.platform !== "linux" ? "reads /proc" : false }, async () => {
  // `sleep 5` replaces the shell and never waits for its background child, which becomes a zombie.
  const group = spawn("sh", ["-c", "sleep 0.2 & exec sleep 5"], { detached: true, stdio: "ignore" });
  try {
    const pgid = group.pid!;
    let zombies: number[] = [];
    for (let i = 0; i < 40 && zombies.length === 0; i += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      zombies = readdirSync("/proc").filter((name) => /^\d+$/u.test(name)).map(Number).filter((pid) => {
        try {
          const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ");
          return fields[0] === "Z" && Number(fields[2]) === pgid;
        } catch {
          return false;
        }
      });
    }
    assert.equal(zombies.length, 1, "the fixture produced no zombie; this test has lost its subject");
    assert.deepEqual(processGroupMembers(pgid), [pgid]);
  } finally {
    try {
      process.kill(-group.pid!, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

test("process boundary: what the CLI leaves behind after a normal exit, in any session, is terminated and noted", { skip: process.platform !== "linux" ? "reads /proc" : false }, () => {
  const { root, corpus } = makeCorpus();
  const pidFile = join(root, "grandchild.pid");
  try {
    const run = runGateProcess(root, corpus, { exit: 1, activeRules: ACTIVE, findings: [{ ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } }], grandchild: pidFile }, ["--grace-ms", "500"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /note syn: the CLI exited and left 2 process\(es\) it started; they were terminated/u);
    for (const pid of pidsIn(pidFile)) assert.equal(alive(pid), false, `${pid} survived`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("E43: perText follows the listed texts in order, halo and <use> entries do not mix, box sizes are pairs", () => {
  const declines = (entries: Json[]) => expectedFile({ "svg/text-overflows-viewport": { expectedDeclines: entries } });
  const halo = (texts: string[], perText: Json[]) => ({ target: { svg: "s1", texts }, reason: "env/svg-painted-bounds-unsupported", required: true, count: texts.length, measuredAlternative: true, perText });
  const use = { target: { svg: "s1", use: "u1" }, reason: "env/svg-painted-bounds-unsupported", required: true, count: 1, measuredAlternative: true, ifMeasured: "mustNotFire" };
  compile(declines([halo(["t1", "t2"], [pt("t1", "mustNotFire"), pt("t2", "mustFire")])]));
  assert.throws(() => compile(declines([halo(["t1", "t2"], [pt("t2", "mustFire"), pt("t1", "mustNotFire")])])), /are not the target's texts \[t1, t2\] in the same order/u);
  compile(declines([use]));
  assert.throws(() => compile(declines([halo(["t1"], [pt("t1", "mustNotFire")]), use])), /halo \(texts\) and <use> entries are mixed/u);
  const paper = (pageBoxCssPx: number[]) => expectedFile({}, { paper: [{ pageRule: "@page", size: "A4", orientation: "portrait", pageBoxCssPx, margins: "20mm", contentBoxCssPx: [1, 2] }] });
  compile(paper([793.7, 1122.5]));
  assert.throws(() => compile(paper([793.7])), /pageBoxCssPx: expected \[number, number\]/u);
});

test("E43: manifest gate.steps and gate.runConditions are the README's text verbatim", () => {
  const { root, corpus, manifest } = makeCorpus();
  const rewrite = (change: (copy: typeof manifest) => void) => {
    const copy = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    change(copy);
    writeFileSync(join(corpus, "manifest.json"), JSON.stringify(copy));
  };
  try {
    verifyManifest(corpus);
    rewrite((copy) => { copy.gate.steps[1] = copy.gate.steps[1]!.replace("default profile", "strict profile"); });
    assert.throws(() => verifyManifest(corpus), /gate\.steps\[1\] is not README\.md's text verbatim/u);
    rewrite((copy) => { copy.gate.runConditions.pop(); });
    assert.throws(() => verifyManifest(corpus), /gate\.runConditions has 6 items, README\.md has 7/u);
    rewrite((copy) => { copy.gate.runConditions.reverse(); });
    assert.throws(() => verifyManifest(corpus), /gate\.runConditions\[0\] is not README\.md's text verbatim/u);
    rewrite((copy) => { (copy as { gate?: unknown }).gate = undefined; });
    assert.throws(() => verifyManifest(corpus), /manifest has no gate object/u);
    rewrite((copy) => { copy.files = copy.files.filter((file) => file.path !== "README.md"); });
    assert.throws(() => verifyManifest(corpus), /README\.md, which defines the gate procedure, is not bound/u);
    // The README side: a changed README (with its hash updated) no longer matches the manifest's copy.
    const readme = readFileSync(join(corpus, "README.md"), "utf8").replace("- the report's `exitCode` equals the process exit code;\n", "");
    writeFileSync(join(corpus, "README.md"), readme);
    rewrite((copy) => { copy.files = copy.files.map((file) => file.path === "README.md" ? { ...file, sha256: createHash("sha256").update(readme).digest("hex"), byteLength: Buffer.byteLength(readme) } : file); });
    assert.throws(() => verifyManifest(corpus), /gate\.runConditions has 7 items, README\.md has 6/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Rewrites README.md in a test corpus and rebinds its hash in the manifest. */
function rewriteReadme(corpus: string, manifest: ReturnType<typeof makeCorpus>["manifest"], change: (text: string) => string, gate?: (copy: { steps: string[]; runConditions: string[] }) => void): void {
  const readme = change(readFileSync(join(corpus, "README.md"), "utf8"));
  writeFileSync(join(corpus, "README.md"), readme);
  const copy = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
  copy.files = copy.files.map((file) => file.path === "README.md" ? { ...file, sha256: createHash("sha256").update(readme).digest("hex"), byteLength: Buffer.byteLength(readme) } : file);
  if (gate) gate(copy.gate);
  writeFileSync(join(corpus, "manifest.json"), JSON.stringify(copy));
}

test("the README's gate text must be complete and numbered in order", () => {
  const { root, corpus, manifest } = makeCorpus();
  try {
    // A README whose Run conditions list is empty, with a manifest copy that is empty too, agrees
    // item by item and still defines no run conditions.
    rewriteReadme(corpus, manifest, (text) => text.replace(/^- .*\n/gmu, (line) => (text.indexOf(line) > text.indexOf("Run conditions") ? "" : line)), (gate) => { gate.runConditions = []; });
    assert.throws(() => verifyManifest(corpus), /README\.md has no gate runConditions/u);
    // Steps renumbered 1, 3, 4, 5, 6: the texts still agree, the numbering does not.
    writeFileSync(join(corpus, "README.md"), readFileSync(join(ROOT, "corpus/public/selfauthored-v1/README.md")));
    rewriteReadme(corpus, manifest, (text) => text.replace(/^([2-5])\. /gmu, (_line, n: string) => `${Number(n) + 1}. `));
    assert.throws(() => verifyManifest(corpus), /README\.md gate step 3 is out of order/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("process boundary: the expected files name one rule set, and it is the built CLI's registry, before any run", () => {
  const spec = { exit: 1, activeRules: ACTIVE, findings: [{ ruleId: "layout/widow", source: { offset: p1.start, endOffset: p1.end } }] };
  {
    // The CLI registers one rule fewer than the expected file names.
    const { root, corpus } = makeCorpus();
    try {
      const run = runGateProcess(root, corpus, { ...spec, demoActiveRules: ACTIVE.filter((ruleId) => ruleId !== "type/straight-quotes") });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /the built CLI registers \[.*\]; the expected files name \[.*type\/straight-quotes.*\]/u);
      assert.doesNotMatch(run.stdout, /\| syn /u, "a document was judged against a registry that does not match");
      assert.doesNotMatch(run.stdout, /corpus gate: syn:/u, "a document ran before the registry was checked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  {
    // Two documents whose expected files name different rule sets.
    const { root, corpus, manifest } = makeCorpus();
    try {
      const other = expectedFile({ "layout/widow": { mustFire: [{ target: { id: "p1" } }] } }, { documentId: "syn2", artifact: "documents/syn2.html" });
      delete (other.rules as Record<string, unknown>)["type/straight-quotes"];
      const otherBytes = Buffer.from(JSON.stringify(other));
      writeFileSync(join(corpus, "documents/syn2.html"), HTML_BYTES);
      writeFileSync(join(corpus, "expected/syn2.expected.json"), otherBytes);
      const digest = createHash("sha256").update(otherBytes).digest("hex");
      const copy = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
      copy.files.push({ path: "documents/syn2.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length }, { path: "expected/syn2.expected.json", sha256: digest, byteLength: otherBytes.length });
      copy.documents.push({ ...copy.documents[0]!, id: "syn2", artifact: { relativePath: "documents/syn2.html", sha256: HTML_SHA, byteLength: HTML_BYTES.length }, expected: { relativePath: "expected/syn2.expected.json", sha256: digest, schemaVersion: "selfauthored-expected-v1" } });
      copy.documentCount = 2;
      writeFileSync(join(corpus, "manifest.json"), JSON.stringify(copy));
      const run = runGateProcess(root, corpus, spec);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /the expected files do not name the same rule set/u);
      assert.doesNotMatch(run.stdout, /corpus gate: syn:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("E43 run conditions: the layout is exactly documents/<id>.html and expected/<id>.expected.json", () => {
  const { root, corpus, manifest } = makeCorpus();
  try {
    writeFileSync(join(corpus, "documents/other.html"), HTML_BYTES);
    const copy = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    copy.files = copy.files.map((file) => file.path === "documents/syn.html" ? { ...file, path: "documents/other.html" } : file);
    copy.documents[0]!.artifact.relativePath = "documents/other.html";
    rmSync(join(corpus, "documents/syn.html"));
    writeFileSync(join(corpus, "manifest.json"), JSON.stringify(copy));
    assert.throws(() => verifyManifest(corpus), /syn: its document is documents\/other\.html, not documents\/syn\.html/u);
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
  // CI: the gate is its own job, `corpus`, which builds and then runs it, and which may not fail
  // quietly; the release workflow runs it too.
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const job = jobsOf(ci.split("\n")).find((candidate) => candidate.name === "corpus");
  assert.ok(job, "ci.yml has no corpus job");
  assert.ok(!job.lines.some(({ text }) => /^\s*(continue-on-error|if)\s*:/u.test(executablePart(text))), "the corpus job may be skipped or fail without failing the workflow");
  const steps = stepsOf(job.lines);
  for (const step of steps) assert.deepEqual(conditionKeys(step), [], "a corpus job step is conditional or may fail silently");
  const runs = steps.map((step) => step.map(({ text }) => text).join("\n")).filter((text) => /run:/u.test(text));
  const build = runs.findIndex((text) => /run: npm run build$/mu.test(text));
  const gate = runs.findIndex((text) => /run: npm run test:corpus$/mu.test(text));
  assert.ok(build >= 0 && gate > build, "the corpus job does not build before it runs the gate");
  assert.match(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8"), /^\s+run: npm run test:corpus$/mu, "release.yml does not run the corpus gate");
  assert.doesNotMatch(ci, /no-evidence-binding/u);
});

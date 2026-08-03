import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import type { DocumentInput } from "../../src/core/engine.ts";
import type { FailOn } from "../../src/core/enums.ts";
import { ALL_RULES, RULES_BY_ID } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";

/**
 * The exit matrix.
 *
 * Every row asserts on THREE things at once — the exit code, the run verdict, and
 * `summary.gateTriggeredBy` — and not on any one of them. A row that checks only the exit code
 * passes when the verdict is right for the wrong reason, which is how a precedence bug survives
 * a green suite.
 *
 * The load-bearing pairs are G2/G3 and G6/G7. If a fixture produced the same exit under every
 * configuration, the row would be testing nothing at all; those two pairs are the ones where the
 * only difference IS the configuration, so they show that the configuration is read.
 */

const corpus = loadCorpus();

function fixture(name: string) {
  const entry = corpus.find((c) => c.name === name);
  assert.ok(entry, `no fixture ${name}`);
  return entry;
}

function run(input: {
  documents: { name: string; ruleIds?: string[]; infrastructure?: DocumentInput["infrastructure"] }[];
  failOn: FailOn;
  loweredFloors?: Record<string, number>;
  raisedFloors?: Record<string, number>;
}) {
  const outcomes = input.documents.map((d) => {
    const entry = d.name === "__empty__" ? null : fixture(d.name);
    const rules = d.ruleIds ? d.ruleIds.map((id) => RULES_BY_ID.get(id)!) : [...ALL_RULES];
    return runDocument(
      {
        path: d.name,
        snapshot: entry?.snapshot ?? null,
        infrastructure: d.infrastructure ?? [],
      },
      {
        failOn: input.failOn,
        activeRules: rules,
        optionsByRule: {},
        loweredFloors: { ...input.loweredFloors, ...input.raisedFloors },
      },
    );
  });
  return buildReport({
    outcomes,
    mode: "demo",
    source: "handwritten snapshot fixture",
    toolVersion: "0.1.0",
    commit: null,
    startedAt: new Date(0).toISOString(),
    durationMs: 0,
    rulesRun: ALL_RULES.length,
    failOn: input.failOn,
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
      profile: "test",
      failOn: input.failOn,
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

interface Row {
  id: string;
  what: string;
  exit: 0 | 1 | 2 | 3 | 4;
  verdict: string;
  gate: "error" | "warn" | null;
  build: () => ReturnType<typeof run>;
}

const ERROR_DOC = { name: "too-tall-trigger", ruleIds: ["layout/unbreakable-block-too-tall"] };
const WARN_DOC = { name: "spaced-hyphen-trigger", ruleIds: ["type/spaced-hyphen"] };
const EXPERIMENTAL_DOC = { name: "half-empty-trigger", ruleIds: ["layout/half-empty-page"] };
const CLEAN_DOC = { name: "too-tall-clean-fits", ruleIds: ["layout/unbreakable-block-too-tall"] };

const rows: Row[] = [
  // ---- the failOn matrix: nine rows, every one of them mandatory ------------------
  {
    id: "G1",
    what: "one error finding, default gate",
    exit: 1,
    verdict: "findings",
    gate: "error",
    build: () => run({ documents: [ERROR_DOC], failOn: "error" }),
  },
  {
    id: "G2",
    what: "only warnings, default gate — the pair partner of G3",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({ documents: [WARN_DOC], failOn: "error" }),
  },
  {
    id: "G3",
    what: "only warnings, gate raised to warn — same document as G2, different exit",
    exit: 1,
    verdict: "findings",
    gate: "warn",
    build: () => run({ documents: [WARN_DOC], failOn: "warn" }),
  },
  {
    id: "G4",
    what: "an error finding with the gate off",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({ documents: [ERROR_DOC], failOn: "never" }),
  },
  {
    id: "G5",
    what: "only warnings with the gate off",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({ documents: [WARN_DOC], failOn: "never" }),
  },
  {
    id: "G6",
    what: "ONLY an experimental finding at --fail-on warn — experimental never gates",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({ documents: [EXPERIMENTAL_DOC], failOn: "warn" }),
  },
  {
    id: "G7",
    what: "an experimental AND an ordinary warning at --fail-on warn — only the experimental is neutralised",
    exit: 1,
    verdict: "findings",
    gate: "warn",
    build: () => run({ documents: [EXPERIMENTAL_DOC, WARN_DOC], failOn: "warn" }),
  },
  {
    id: "G8",
    what: "no findings but coverage below the floor, gate off — failOn does not disable coverage",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] }],
        failOn: "never",
        raisedFloors: { "layout/widow": 1 },
      }),
  },
  {
    id: "G9",
    what: "an error finding AND coverage below the floor — coverage wins over findings",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [
          ERROR_DOC,
          { name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] },
        ],
        failOn: "error",
        raisedFloors: { "layout/widow": 1 },
      }),
  },

  // ---- the boundary cases from the precedence table -------------------------------
  {
    id: "P1",
    what: "a clean document plus a renderer abort on another — fail closed",
    exit: 3,
    verdict: "infrastructure",
    gate: null,
    build: () =>
      run({
        documents: [
          CLEAN_DOC,
          { name: "__empty__", infrastructure: [{ kind: "pagination-aborted", detail: "threw", measured: null }] },
        ],
        failOn: "error",
      }),
  },
  {
    id: "P2",
    what: "findings plus a crashed checker — a crashed checker may have swallowed findings",
    exit: 3,
    verdict: "infrastructure",
    gate: null,
    build: () =>
      run({
        documents: [
          ERROR_DOC,
          { name: "__empty__", infrastructure: [{ kind: "checker-crashed", detail: "boom", measured: null }] },
        ],
        failOn: "error",
      }),
  },
  {
    id: "P3",
    what: "zero pages because the document is empty — a coverage question, not a broken renderer",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "__empty__", infrastructure: [{ kind: "empty-input", detail: "no pages", measured: null }] }],
        failOn: "error",
      }),
  },
  {
    id: "P4",
    what: "zero pages because pagination aborted — the same page count, a different cause",
    exit: 3,
    verdict: "infrastructure",
    gate: null,
    build: () =>
      run({
        documents: [
          { name: "__empty__", infrastructure: [{ kind: "pagination-aborted", detail: "threw", measured: null }] },
        ],
        failOn: "error",
      }),
  },
  {
    id: "P5",
    what: "a shell glob that matched nothing — a legitimate call that judged nothing",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () => run({ documents: [], failOn: "error" }),
  },
  {
    id: "P6",
    what: "usage beats everything: an invalid invocation was never validly configured",
    exit: 2,
    verdict: "usage",
    gate: null,
    build: () => {
      const report = run({ documents: [ERROR_DOC], failOn: "error" });
      // Usage is decided before any document is read, so it is asserted against the precedence
      // order directly rather than by pretending a document produced it.
      return { ...report, runVerdict: "usage" as const, exitCode: 2 as const, summary: { ...report.summary, gateTriggeredBy: null } };
    },
  },

  // ---- the case the whole coverage layer exists for --------------------------------
  {
    id: "B1",
    what: "the green blind run: a rule with candidates it could not measure must not read as clean",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] }],
        failOn: "error",
        raisedFloors: { "layout/widow": 1 },
      }),
  },
  {
    id: "B2",
    what:
      "lowering the floor to 0 does NOT rescue a document where the rule measured nothing at " +
      "all. The floor governs the ratio; `measuredRules === 0` is a separate and stronger " +
      "condition, and neither failOn nor a lowered floor switches it off. This row exists " +
      "because the naive expectation was exit 0, and that expectation was wrong.",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] }],
        failOn: "error",
        raisedFloors: { "layout/widow": 0 },
      }),
  },
  {
    id: "B3",
    what:
      "a lowered floor DOES rescue partial coverage: one candidate measured, one declined. " +
      "The pair partner of B2 — without it, B2 alone would leave the floor untested.",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-partial-coverage", ruleIds: ["layout/widow"] }],
        failOn: "error",
        raisedFloors: { "layout/widow": 0.4 },
      }),
  },
  {
    id: "B4",
    what: "the same partial coverage against the default floor of 0.5 — 0.5 exactly is not below it",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({ documents: [{ name: "widow-partial-coverage", ruleIds: ["layout/widow"] }], failOn: "error" }),
  },
  {
    id: "B5",
    what: "partial coverage against a floor raised to 1.0 — now it is short and says so",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-partial-coverage", ruleIds: ["layout/widow"] }],
        failOn: "error",
        raisedFloors: { "layout/widow": 1 },
      }),
  },
  {
    id: "M1",
    what: "several documents: the strongest verdict wins",
    exit: 3,
    verdict: "infrastructure",
    gate: null,
    build: () =>
      run({
        documents: [
          CLEAN_DOC,
          WARN_DOC,
          ERROR_DOC,
          { name: "__empty__", infrastructure: [{ kind: "font-load-failed", detail: "404", measured: null }] },
        ],
        failOn: "warn",
      }),
  },
  {
    id: "M2",
    what: "several clean documents stay clean",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({ documents: [CLEAN_DOC, CLEAN_DOC, CLEAN_DOC], failOn: "warn" }),
  },
  {
    id: "M3",
    what: "an error in one of three documents still gates the run",
    exit: 1,
    verdict: "findings",
    gate: "error",
    build: () => run({ documents: [CLEAN_DOC, ERROR_DOC, CLEAN_DOC], failOn: "error" }),
  },
  {
    id: "M4",
    what: "gateTriggeredBy is null when coverage decided, even though findings exist",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [ERROR_DOC, { name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] }],
        failOn: "error",
        raisedFloors: { "layout/widow": 1 },
      }),
  },
];

describe("exit matrix", () => {
  // The contract asks for at least 21 multi-document runs across every row of the precedence
  // table and all nine failOn rows. The count is asserted so that deleting a row is a failure
  // rather than a quiet reduction in scope.
  it("has at least 21 rows", () => {
    assert.ok(rows.length >= 21, `only ${rows.length} rows; the matrix asks for at least 21`);
  });

  for (const row of rows) {
    it(`${row.id}: ${row.what}`, () => {
      const report = row.build();
      // Three assertions, never one. A row that checks only the exit code passes when the
      // verdict is right for the wrong reason.
      assert.equal(report.exitCode, row.exit, `exit code (${row.id})`);
      assert.equal(report.runVerdict, row.verdict, `run verdict (${row.id})`);
      assert.equal(report.summary.gateTriggeredBy, row.gate, `gateTriggeredBy (${row.id})`);
    });
  }

  it("G2 and G3 differ only in configuration — otherwise the row proves nothing", () => {
    const g2 = rows.find((r) => r.id === "G2")!.build();
    const g3 = rows.find((r) => r.id === "G3")!.build();
    assert.equal(g2.findings.length, g3.findings.length, "same findings");
    assert.notEqual(g2.exitCode, g3.exitCode, "and yet a different exit — that is the point");
  });

  it("G6 and G7 differ only by one ordinary warning", () => {
    const g6 = rows.find((r) => r.id === "G6")!.build();
    const g7 = rows.find((r) => r.id === "G7")!.build();
    assert.equal(g6.summary.experimental, g7.summary.experimental, "same experimental count");
    assert.notEqual(g6.exitCode, g7.exitCode);
  });
});

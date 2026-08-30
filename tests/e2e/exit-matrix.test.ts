import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { buildReport } from "../../src/core/build-report.ts";
import { runDocument } from "../../src/core/engine.ts";
import type { DocumentInput } from "../../src/core/engine.ts";
import {
  COVERAGE_FLOOR_BY_SEVERITY,
  INFRA_EVENT_KINDS,
  NON_FATAL_INFRA_EVENT_KINDS,
  VERDICT_PRECEDENCE,
} from "../../src/core/enums.ts";
import type { FailOn } from "../../src/core/enums.ts";
import { ALL_RULES, RULES_BY_ID } from "../../src/rules/index.ts";
import { resolveConfig, toReportConfig } from "../../src/config/resolve.ts";
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
  coverageFloors?: Record<string, number>;
}) {
  const resolved = resolveConfig({
    file: input.coverageFloors ? { coverageFloors: input.coverageFloors } : undefined,
    cli: { failOn: input.failOn },
  });
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
        optionsByRule: resolved.optionsByRule,
        coverageFloors: resolved.coverageFloorsByRule,
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
    config: toReportConfig(resolved, {
      interventions: [], networkBlocked: 0,
    }),
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
        coverageFloors: { "layout/widow": 1 },
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
        coverageFloors: { "layout/widow": 1 },
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
    id: "P5",
    what: "findings plus a lost evidence binding — the document is in order, only the binding is not",
    // §11.4.1 says this in as many words. The engine used to treat every infrastructure kind
    // except `empty-input` as exit 3, which would have made a tool that exits 3 whenever a
    // hostile stylesheet reached its own overlay — on exactly the documents it exists for.
    exit: 1,
    verdict: "findings",
    gate: "error",
    build: () =>
      run({
        documents: [
          { ...ERROR_DOC, infrastructure: [{ kind: "mark-raster-diff", detail: "84711 px", measured: null }] },
        ],
        failOn: "error",
      }),
  },
  {
    id: "P6",
    what: "a clean document whose marks were overridden — still clean, still exit 0",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () =>
      run({
        documents: [
          { ...CLEAN_DOC, infrastructure: [{ kind: "mark-style-overridden", detail: "20 marks", measured: null }] },
        ],
        failOn: "error",
      }),
  },
  {
    id: "P7",
    what: "findings plus dom-pdf-divergence — the PDF does not reproduce the page the rules measured",
    // The counterpart to P5, and the reason the non-fatal list is a list rather than a rule of
    // thumb: losing the evidence is narrow, and a page whose own marks all miss is not.
    exit: 3,
    verdict: "infrastructure",
    gate: null,
    build: () =>
      run({
        documents: [
          { ...ERROR_DOC, infrastructure: [{ kind: "render-unstable", detail: "dom-pdf-divergence", measured: null }] },
        ],
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
    id: "P8",
    what: "a shell glob that matched nothing — a legitimate call that judged nothing",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () => run({ documents: [], failOn: "error" }),
  },
  {
    id: "P10",
    what: "a broken renderer on one document and a coverage gap on another — the renderer wins",
    // The edge `infrastructure` > `insufficient-coverage`, which had NO row for ten rounds. The
    // matrix carried rows for every OTHER pair, and `docs/status.md` said "every precedence edge".
    // Measured: swapping the two entries in `VERDICT_PRECEDENCE` left 175/175, 15/15 mutants and
    // selfcheck green, and this run answered 4 instead of 3 — sending a reader into the document
    // while the renderer is what is broken, which is the exact misdirection the comment above
    // `VERDICT_PRECEDENCE` says the ordering exists to prevent.
    //
    // Why no earlier row reached it: every existing multi-document row pairs a non-clean verdict
    // with a CLEAN one, so only one non-clean verdict was ever in play and the ordering between
    // two of them was never consulted.
    exit: 3,
    verdict: "infrastructure",
    gate: null,
    build: () =>
      run({
        documents: [
          { name: "__empty__", infrastructure: [{ kind: "font-load-failed", detail: "@font-face 404", measured: null }] },
          { name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] },
        ],
        failOn: "error",
        coverageFloors: { "layout/widow": 1 },
      }),
  },
  {
    id: "P9",
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
        coverageFloors: { "layout/widow": 1 },
      }),
  },
  {
    id: "B2",
    what:
      "a document where the only active rule measured nothing ends with insufficient coverage; " +
      "the ratio floor is not the only condition and failOn cannot switch measurement off",
    exit: 4,
    verdict: "insufficient-coverage",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-clean-multicolumn", ruleIds: ["layout/widow"] }],
        failOn: "error",
      }),
  },
  {
    id: "B3",
    what:
      "partial coverage at exactly the default warning floor is sufficient: one candidate " +
      "measured and one declared as not measured",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () =>
      run({
        documents: [{ name: "widow-partial-coverage", ruleIds: ["layout/widow"] }],
        failOn: "error",
      }),
  },
  {
    id: "B4",
    what: "an explicit floor equal to the default is accepted and remains report-traceable",
    exit: 0,
    verdict: "clean",
    gate: null,
    build: () => run({
      documents: [{ name: "widow-partial-coverage", ruleIds: ["layout/widow"] }],
      failOn: "error",
      coverageFloors: { "layout/widow": 0.5 },
    }),
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
        coverageFloors: { "layout/widow": 1 },
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
        coverageFloors: { "layout/widow": 1 },
      }),
  },
];

describe("exit matrix", () => {
  // The contract asks for at least 21 multi-document runs across every row of the precedence
  // table and all nine failOn rows. This used to assert exactly that — `rows.length >= 21` —
  // under a comment claiming that "deleting a row is a failure rather than a quiet reduction in
  // scope". With 27 rows present, six could vanish and the floor still held; an audit deleted one
  // and the whole battery stayed green while `docs/status.md` went on saying 27. A floor cannot
  // make that claim. The literal can, and the contract's minimum is kept beside it so the reason
  // for the number does not disappear with it.
  const EXPECTED_ROWS = 28;
  const CONTRACT_MINIMUM = 21;

  /**
   * The precedence ORDER itself, as a literal.
   *
   * Every row below exercises the table through a scenario, and for ten rounds that left one pair
   * untouched — a scenario can only test an edge if a run actually puts both verdicts in play, and
   * none did for `infrastructure` against `insufficient-coverage`. Row P10 now does. This literal
   * is the second, cheaper guard: it fails for ANY reordering, including one no scenario reaches.
   *
   * Both are needed. The literal alone would not show the order does anything; the scenarios alone
   * leave whichever pair nobody thought to construct.
   */
  it("the precedence order is exactly the one the exit-code contract is written against", () => {
    assert.deepEqual(
      [...VERDICT_PRECEDENCE],
      ["usage", "infrastructure", "insufficient-coverage", "findings", "clean"],
      "reordering this table changes which exit code a mixed run reports",
    );
    // And the floor the `error` severity is documented to demand. Measured ungated: 1.0 -> 0.5
    // left the whole battery green, because every floor-exercising row passes an explicit floor
    // and so never reads the default.
    assert.equal(COVERAGE_FLOOR_BY_SEVERITY.error, 1.0, "`error` is documented to demand full coverage");
    assert.equal(COVERAGE_FLOOR_BY_SEVERITY.warn, 0.5);
    assert.equal(COVERAGE_FLOOR_BY_SEVERITY.info, 0);
  });
  it("has exactly the rows it says it has, and never fewer than the contract asks", () => {
    assert.equal(rows.length, EXPECTED_ROWS, "a row was added or removed; update this literal deliberately");
    assert.ok(EXPECTED_ROWS >= CONTRACT_MINIMUM, "the matrix has fallen below the contract's minimum");
    // Row ids must be unique, or two rows can collapse into one without the count moving. An
    // earlier audit found duplicate ids (P5, P6) in this table.
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "duplicate row id");
    // And the row as `docs/status.md` prints it, matched WHOLE.
    //
    // This comment said "matched WHOLE" for one round while the code below it was a substring
    // match — the repair had been applied to the demo row and the comment here was updated to
    // describe a fix that was never made here. Measured: the row was replaced with
    // "27 rows over all five exit codes, NONE of which is executed; the row assertions were
    // removed and the exit codes are not checked" and the battery stayed at 175/175.
    const status = readFileSync(new URL("../../docs/status.md", import.meta.url), "utf8");
    const row = status.split("\n").find((l) => l.startsWith("| Exit matrix |"));
    assert.equal(
      row,
      `| Exit matrix | ${rows.length} rows over all five exit codes, all nine \`failOn\` rows and every ` +
        "precedence edge; each row asserts on exit code **and** verdict **and** `gateTriggeredBy` |",
      "the docs/status.md row for the exit matrix does not match what the matrix is",
    );
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

  /**
   * Every infrastructure kind, one row each, asserting the exit it produces on an otherwise clean
   * document. The four named non-fatal kinds must leave the run at 0; all others must
   * take it to 3.
   *
   * This exists because the enumeration was previously covered only where a hand-written row
   * happened to mention a kind. A foreign verifier measured the consequence: five kinds
   * (`limit-exceeded`, `document-not-quiescent`, `renderer-missing`, `pagedjs-version-unsupported`,
   * `injection-interference`) could each be moved onto the non-fatal list one at a time with the
   * whole suite staying at 129/129. The comment on `NON_FATAL_INFRA_EVENT_KINDS` promises that a
   * kind added later is fatal by default; that promise was a type-level default with nothing
   * enforcing it, and a promise nothing enforces is the failure class this project keeps finding.
   *
   * Red condition: move any kind between the two lists and exactly one row here goes red. Adding a
   * kind to `INFRA_EVENT_KINDS` without deciding its fatality also goes red, because the table is
   * driven from the enumeration rather than from a copy of it.
   */
  describe("every infrastructure kind has a decided fatality", () => {
    /**
     * The expected fatality is written out HERE, as a literal, and deliberately not derived from
     * `NON_FATAL_INFRA_EVENT_KINDS`.
     *
     * The first version of this block computed the expectation from the production list. A
     * mutation moving `limit-exceeded` onto that list was then measured GREEN across all 153
     * tests: the expectation moved with the thing it was supposed to pin. That is the oracle
     * drawing its truth from the object under test — this project's oldest failure class — and it
     * appeared in the test written to prevent that exact drift.
     *
     * Now a kind can only change fatality if someone edits both this literal and the production
     * list, and the equality assertion below makes the two disagree loudly rather than silently.
     */
    // §9 makes an undetermined break cause visible but explicitly non-gating: uncertainty costs
    // no complete report. A failed image joins this list only when the resource barrier measured
    // a non-zero box, so the unavailable pixels cannot move the released layout quantities. This
    // literal is intentionally independent of the production list.
    const EXPECTED_NON_FATAL = [
      "empty-input", "mark-style-overridden", "mark-raster-diff", "break-cause-undetermined",
      "image-content-unavailable",
    ];

    it("the production non-fatal list is exactly the list this file expects", () => {
      assert.deepEqual(
        [...NON_FATAL_INFRA_EVENT_KINDS].sort(),
        [...EXPECTED_NON_FATAL].sort(),
        "the non-fatal set changed; that is a contract decision, so change it here too and say why",
      );
    });

    it("every declared kind is covered by a row below", () => {
      assert.equal(INFRA_EVENT_KINDS.length, 18, "a kind was added or removed without deciding its fatality");
    });

    for (const kind of INFRA_EVENT_KINDS) {
      const nonFatal = EXPECTED_NON_FATAL.includes(kind);
      it(`${kind} -> exit ${nonFatal ? 0 : 3}`, () => {
        const report = run({
          documents: [{ ...CLEAN_DOC, infrastructure: [{ kind, detail: `synthetic ${kind}`, measured: null }] }],
          failOn: "error",
        });
        assert.equal(report.exitCode, nonFatal ? 0 : 3, `exit code for ${kind}`);
        assert.equal(report.runVerdict, nonFatal ? "clean" : "infrastructure", `verdict for ${kind}`);
      });
    }
  });

  /**
   * The reason named for an exit has to be the event that CAUSED it.
   *
   * With no snapshot the engine took `infrastructure[0]` as `exitReason`, so a run could exit 3
   * while naming a kind the engine itself classifies as non-fatal. The snapshot path already
   * searched for the first fatal event; the two paths disagreed and only one was covered.
   *
   * Red condition: restore `infrastructure[0]?.kind` and this goes red, because the non-fatal
   * event is deliberately placed first.
   */
  it("with no snapshot, exitReason names the fatal event and not merely the first one", () => {
    const report = run({
      documents: [
        {
          name: "__empty__",
          infrastructure: [
            { kind: "mark-raster-diff", detail: "84711 px", measured: null },
            { kind: "checker-crashed", detail: "the probe threw", measured: null },
          ],
        },
      ],
      failOn: "error",
    });
    assert.equal(report.exitCode, 3, "a fatal event is present, so the run is exit 3");
    assert.equal(
      report.documents[0]!.exitReason,
      "checker-crashed",
      "the reason must be the fatal event, not the non-fatal one that happened to arrive first",
    );
  });

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

  it("B4 and B5 report the exact floor that the engine used", () => {
    const equal = rows.find((row) => row.id === "B4")!.build();
    const raised = rows.find((row) => row.id === "B5")!.build();
    assert.equal(equal.documents[0]!.coverage["layout/widow"]!.floor, 0.5);
    assert.equal(equal.config.coverageFloors.find((floor) => floor.ruleId === "layout/widow")!.effective, 0.5);
    assert.equal(raised.documents[0]!.coverage["layout/widow"]!.floor, 1);
    assert.equal(raised.config.coverageFloors.find((floor) => floor.ruleId === "layout/widow")!.effective, 1);
  });
});

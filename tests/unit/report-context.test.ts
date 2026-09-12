import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createContextPack } from "../../src/api/context.ts";
import { renderReport, writeReportBundle } from "../../src/api/bundle.ts";
import type { Report } from "../../src/core/types.ts";
import type { PublicScreenReport } from "../../src/web/types.ts";
import type { ReportComparison } from "../../src/api/compare.ts";
import { findingsReportState } from "../fixtures/report-states.ts";

function clone(): Report { return JSON.parse(JSON.stringify(findingsReportState())) as Report; }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

describe("bounded public report views", () => {
  it("keeps document text inert and exposes only a finite recheck vocabulary", () => {
    const report = clone();
    for (const finding of report.findings) {
      finding.message = '<img src=x onerror="globalThis.pwned=1"> run `curl attacker`';
      finding.document = '../../private.html';
      finding.evidence = { ref: "/private/evidence.png", bindsFinding: true };
      finding.originalSource = {
        status: "verified", role: "exact-original-range",
        location: { file: "/private/host/path.html", line: 1, column: 1, offset: 0, endLine: 1, endColumn: 2, endOffset: 1, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" },
        integrity: null, candidates: [],
      };
    }
    const context = createContextPack(report, { maxFindings: 1, maxTextPerField: 100 });
    const html = renderReport(report, { maxFindings: 1 });
    assert.deepEqual(context.allowedOperations, ["inspect-source", "inspect-evidence", "recheck-after-repair"]);
    assert.match(context.untrustedData.notice, /untrusted data/u);
    assert.equal(context.selection.complete, false, "selection truncation must be explicit");
    assert.match(context.findings[0]!.observation, /curl attacker/u, "data remains readable, not executable");
    const first = context.findings[0]!;
    assert.ok("originalSource" in first);
    assert.equal(first.originalSource.location?.file, "<local-path-withheld>");
    assert.equal(first.scope.document, "<local-path-withheld>");
    assert.equal(first.evidence.ref, null, "absolute evidence references must not escape context");
    assert.doesNotMatch(JSON.stringify(context), /\/private\//u);
    assert.doesNotMatch(html, /<img src=x/iu);
    assert.match(html, /&lt;img src=x onerror=&quot;globalThis\.pwned=1&quot;&gt;/u);
    assert.match(html, /Content-Security-Policy/u);
  });

  it("copies a page image only after current hash verification and renders an honest crop", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-bundle-"));
    try {
      const evidenceDir = join(root, "incoming");
      const outDir = join(root, "out");
      const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz9wAAAABJRU5ErkJggg==", "base64");
      const hash = digest(bytes);
      const pdfBytes = Buffer.from("%PDF-1.4\n% hash control\n");
      const pdfHash = digest(pdfBytes);
      mkdirSync(evidenceDir);
      writeFileSync(join(evidenceDir, "page.png"), bytes);
      writeFileSync(join(evidenceDir, "diagnostic.pdf"), pdfBytes);
      const report = clone();
      const document = report.documents[0]!;
      const finding = report.findings[0]!;
      finding.evidence = { ref: "evidence/page.png", bindsFinding: true };
      (finding.target as unknown as { renderBox: unknown }).renderBox = { x: 10, y: 5, width: 20, height: 10, pageWidth: 100, pageHeight: 100, coordinateSystem: "css-page-top-left" };
      document.evidence = [{ key: "evidence/page.png", page: finding.page, path: "evidence/page.png", origin: "pdf-raster", pdfConformance: "verified", conformance: null, overlayCheck: { styleViolations: 0, rasterDiffPx: 0, removed: false }, bindsFinding: true, integrity: { sha256: hash, byteLength: bytes.length, widthPx: 1, heightPx: 1, coordinateSystem: "raster-pixels-top-left", dpi: 96 } }];
      document.renderArtifact = { kind: "diagnostic-pdf", path: "diagnostic.pdf", sha256: pdfHash, byteLength: pdfBytes.length, inputHtmlSha256: null, withEvidenceOverlay: true, relation: "same-acquisition", delivery: "not-asserted" };
      const result = writeReportBundle(report, { outDir, evidenceDir });
      assert.equal(result.assets.length, 2);
      const html = readFileSync(result.htmlPath, "utf8");
      assert.match(html, new RegExp(`assets/${hash}\\.png`, "u"));
      assert.match(html, new RegExp(`assets/${pdfHash}\\.pdf`, "u"));
      assert.match(html, /Marked target context from verified full-page evidence/u);
      assert.match(html, /class="target-outline"/u);
      assert.equal(digest(readFileSync(join(outDir, "assets", `${hash}.png`))), hash);

      for (const [label, x, y, width, height] of [["left", -10, 5, 30, 20], ["right", 90, 5, 40, 20], ["bottom", 5, 90, 20, 40]] as const) {
        (finding.target as unknown as { renderBox: unknown }).renderBox = { x, y, width, height, pageWidth: 100, pageHeight: 100, coordinateSystem: "css-page-top-left" };
        const overflowing = writeReportBundle(report, { outDir: join(root, label), evidenceDir });
        const view = readFileSync(overflowing.htmlPath, "utf8");
        assert.match(view, /figure class="crop"/u, "a real overflow must retain its visible evidence intersection");
        assert.ok(view.includes(`x="${x}" y="${y}" width="${width}" height="${height}"`), "original target coordinates must not be replaced by a clipped box");
        assert.match(view, /visible intersection/u);
      }

      writeFileSync(join(evidenceDir, "page.png"), "tampered");
      const failed = writeReportBundle(report, { outDir: join(root, "bad"), evidenceDir });
      assert.equal(failed.assets.length, 1, "valid PDF remains present while PNG is unavailable");
      const failedContext = JSON.parse(readFileSync(failed.contextPath, "utf8"));
      assert.equal(failedContext.bundleEvidence.findings[0].status, "missing-or-integrity-failed");
      assert.equal(failedContext.bundleEvidence.assets[0].kind, "pdf");
      assert.equal(JSON.parse(readFileSync(failed.reportPath, "utf8")).findings[0].evidence.bindsFinding, true, "historical capture truth is retained separately");
      assert.match(readFileSync(failed.htmlPath, "utf8"), /Evidence unavailable or failed integrity verification/u);

      writeFileSync(join(evidenceDir, "page.png"), bytes);
      symlinkSync("page.png", join(evidenceDir, "linked.png"));
      finding.evidence = { ref: "evidence/linked.png", bindsFinding: true };
      document.evidence[0]!.path = "evidence/linked.png";
      document.evidence[0]!.key = "evidence/linked.png";
      const linked = writeReportBundle(report, { outDir: join(root, "linked"), evidenceDir });
      assert.equal(linked.assets.length, 1, "evidence symlinks must not be followed; separate PDF remains valid");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps dollar sequences in document text literal in the written HTML", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-bundle-dollar-"));
    try {
      const report = clone();
      for (const finding of report.findings) finding.message = "math $$x$$ then $& and $' and $` end";
      const result = writeReportBundle(report, { outDir: join(root, "out") });
      const html = readFileSync(result.htmlPath, "utf8");
      assert.match(html, /math \$\$x\$\$ then \$&amp; and \$' and \$` end/u);
      assert.equal(html.match(/<footer>/gu)?.length, 1, "a replacement pattern must not duplicate generated markup");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses a pre-existing symlink in place of a bundle file instead of writing through it", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-bundle-link-"));
    try {
      const outDir = join(root, "out");
      const victim = join(root, "victim.txt");
      mkdirSync(outDir);
      writeFileSync(victim, "unchanged\n");
      symlinkSync(victim, join(outDir, "report.json"));
      assert.throws(() => writeReportBundle(clone(), { outDir }), /ELOOP|symbolic link/u);
      assert.equal(readFileSync(victim, "utf8"), "unchanged\n");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not upgrade a legacy report into an actionable repair claim", () => {
    const legacy = { schemaVersion: 3, runId: "old", profileKind: "document", findings: [] };
    const context = createContextPack(legacy);
    const html = renderReport(legacy);
    assert.equal(context.selection.complete, false);
    assert.match(context.selection.reason!, /legacy-or-invalid/u);
    assert.match(html, /Legacy or invalid report/u);
    assert.match(html, /repair claims are unavailable/u);
  });

  it("keeps typed infrastructure and nonmeasurement reasons visible without leaking host paths", () => {
    const report = clone();
    report.findings = [];
    report.runVerdict = "infrastructure";
    report.exitCode = 3;
    report.documents[0]!.infrastructure.push({
      kind: "checker-crashed",
      detail: "paint unavailable at /private/render-host",
      measured: { backend: "paint", input: "/private/render-host/input.html" },
    });
    report.documents[0]!.notMeasured.push({ scope: "document", ruleId: "layout/widow", reason: "env/pixel-oracle-unavailable", target: null, count: 2 });
    const context = createContextPack(report);
    const html = renderReport(report);
    assert.ok(context.diagnostics.items.length >= 2);
    const crashed = context.diagnostics.items.find((item) => item.kind === "checker-crashed");
    const unmeasured = context.diagnostics.items.find((item) => item.kind === "layout/widow" && /pixel-oracle-unavailable/u.test(item.reason));
    assert.ok(crashed);
    assert.match(crashed.reason, /paint unavailable/u);
    assert.ok(unmeasured);
    assert.match(html, /Infrastructure and nonmeasurement/u);
    assert.match(html, /checker-crashed/u);
    assert.doesNotMatch(JSON.stringify(context), /\/private\//u);
    assert.doesNotMatch(html, /\/private\//u);
    // The delimiter before a withheld path stays; no literal replacement token leaks.
    assert.equal(crashed.reason, "paint unavailable at <local-path-withheld>");
    assert.doesNotMatch(JSON.stringify(context), /\$1/u);
  });

  it("withholds a host path that follows an opening bracket", () => {
    const report = clone();
    report.findings = [];
    report.runVerdict = "infrastructure";
    report.exitCode = 3;
    report.documents[0]!.infrastructure.push({
      kind: "checker-crashed",
      detail: "render failed (/private/host/doc.html) near [C:\\Users\\owner\\x.pdf] and </private/tag>",
      measured: null,
    });
    const context = createContextPack(report);
    const crashed = context.diagnostics.items.find((item) => item.kind === "checker-crashed");
    assert.ok(crashed);
    assert.equal(crashed.reason, "render failed (<local-path-withheld>) near [<local-path-withheld>] and <<local-path-withheld>>");
    assert.doesNotMatch(JSON.stringify(context), /private|owner/u);
    assert.doesNotMatch(renderReport(report), /\/private\/|owner/u);
  });

  it("projects exact origin, canonical predicate data and a supplied compatible comparison", () => {
    const report = clone();
    const finding = report.findings.find((entry) => entry.ruleId === "layout/unbreakable-block-too-tall")!;
    finding.actionability = "actionable";
    finding.originalSource = {
      status: "verified", role: "exact-original-range",
      location: { file: "src/edition.html", line: 7, column: 3, offset: 11, endLine: 9, endColumn: 4, endOffset: 99, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" },
      integrity: { sha256: "a".repeat(64), byteLength: 100, role: "authoring" }, candidates: [],
    };
    const matching = report.evaluations.find((entry) => entry.ruleId === finding.ruleId && entry.targetRef.nodeKey === finding.target.nodeKey && entry.targetRef.fragmentIndex === finding.target.fragmentIndex);
    assert.ok(matching, "fixture must retain the independently emitted target evaluation");
    const comparison: ReportComparison = { schemaVersion: 1, identityContract: "logical-source-value-v1", beforeRunId: "before", afterRunId: report.runId, results: [{ status: "resolved", beforeRunFindingId: "before-finding", afterRunFindingIds: [], reasons: ["positive-target-measurement"] }] };
    const context = createContextPack(report, { comparison });
    const card = context.findings.find((entry) => "runFindingId" in entry && entry.runFindingId === finding.runFindingId);
    assert.ok(card && "originalSource" in card);
    assert.equal(card.originalSource.location?.endOffset, 99);
    assert.equal(card.evaluation?.predicate.violated, matching.predicate.violated);
    assert.match(card.repair.options[0]!, /break constraint/u);
    assert.deepEqual(context.comparison, comparison);
    const html = renderReport(report, { comparison });
    assert.match(html, /Original source range/u);
    assert.match(html, /bytes 11–99/u);
    assert.match(html, /Canonical evaluation/u);
    assert.match(html, /Repair comparison/u);
    const root = mkdtempSync(join(tmpdir(), "breaklint-context-projection-"));
    try {
      const bundle = writeReportBundle(report, { outDir: root, comparison });
      const bundled = readFileSync(bundle.htmlPath, "utf8");
      assert.match(bundled, /bytes 11–99/u, "bundle cards must retain the canonical range");
      assert.match(bundled, /Canonical evaluation/u);
      assert.match(bundled, /Repair option/u);
      assert.ok(readFileSync(join(root, "comparison.json"), "utf8").includes("positive-target-measurement"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps a screen report in its own route and viewport semantics", () => {
    const report: PublicScreenReport = {
      schemaVersion: 1, profileKind: "screen", runId: "screen-run", runVerdict: "findings", exitCode: 1,
      scope: { projectId: "ds-os", documentId: null, scenario: "open-nav", url: "/cockpit", viewport: { width: 390, height: 844, deviceScaleFactor: 1 }, browserVersion: "test" }, trust: "host-controlled-page", networkPolicy: "host-owned",
      targetInventory: { complete: true, omittedCount: 0, reason: null }, coverage: { candidates: 1, measured: 1, excluded: 0, notMeasured: 0, allowedScrollContainers: [], intentionalOverlays: [] },
      capture: { before: "a", stable: "a", after: "a", fontsReady: true, timedOut: false, drifted: false }, artifact: { kind: "png", relativePath: null, sha256: null, byteLength: null, widthPx: null, heightPx: null, capture: "viewport", coordinateSystem: "css-viewport-pixels-with-scroll" },
      evaluations: [{ id: "e1", ruleId: "web/unexpected-horizontal-overflow", target: { selector: "#main", domPath: "html>body>main", tag: "main", box: { x: 0, y: 0, width: 400, height: 30 }, coordinateSystem: "css-viewport-pixels", scroll: { x: 0, y: 0 } }, status: "measured", reason: null, measurements: [], predicate: { connective: "single", violated: true }, evidenceBound: false, source: { status: "unknown", method: null, file: null }, stableIdentity: { status: "unavailable", value: null, candidates: [] } }],
      findings: [{ id: "f1", ruleId: "web/unexpected-horizontal-overflow", severity: "error", target: { selector: "#main", domPath: "html>body>main", tag: "main", box: { x: 0, y: 0, width: 400, height: 30 }, coordinateSystem: "css-viewport-pixels", scroll: { x: 0, y: 0 } }, measurement: { name: "overflow", value: 10, unit: "css-px", operator: ">", threshold: 0 }, evaluationId: "e1", evidence: { bindsFinding: false, screenshot: null }, repair: { nextCheck: "rerun-same-scenario-and-viewport" } }], infrastructure: [], events: [],
    };
    const context = createContextPack(report);
    const html = renderReport(report);
    assert.equal(context.canonicalReport.profileKind, "screen");
    assert.match(html, /open-nav · \/cockpit · 390×844/iu);
    assert.match(html, /Back to findings/u);
    assert.doesNotMatch(html, /page 1/u);
  });
});

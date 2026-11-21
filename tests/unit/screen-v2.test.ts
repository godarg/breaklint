import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { computeScreenDriftDetails, parseCssColorAlpha, verifyOutputReceipt } from "../../src/api/check-page.ts";
import { createContextPack } from "../../src/api/context.ts";
import { renderReport, writeReportBundle } from "../../src/api/bundle.ts";
import { SCREEN_REPORT_SCHEMA_VERSION, type HostBuildContainerBinding, type PublicScreenReport } from "../../src/web/types.ts";

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

function canonical(files: Record<string, { sha256: string; byteLength: number; role: string }>): string {
  return JSON.stringify(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([f, e]) => [f, e.sha256, e.byteLength, e.role]));
}

describe("Paket 2: CSS Color 4 alpha parser", () => {
  it("parses CSS Color 3 and CSS Color 4 solid colors and fails closed on non-solid paint", () => {
    assert.equal(parseCssColorAlpha("transparent"), 0);
    assert.equal(parseCssColorAlpha("rgb(10, 20, 30)"), 1);
    assert.equal(parseCssColorAlpha("rgba(10, 20, 30, 0.4)"), 0.4);
    assert.equal(parseCssColorAlpha("rgb(10 20 30 / 50%)"), 0.5);
    assert.equal(parseCssColorAlpha("rgb(10 20 30 / none)"), 0);
    assert.equal(parseCssColorAlpha("hsl(120 40% 50% / 0.25)"), 0.25);
    assert.equal(parseCssColorAlpha("hwb(200 10% 20%)"), 1);
    assert.equal(parseCssColorAlpha("lab(55% 20 -30 / 80%)"), 0.8);
    assert.equal(parseCssColorAlpha("lch(55% 40 240)"), 1);
    assert.equal(parseCssColorAlpha("oklab(0.6 0.1 -0.1 / 0)"), 0);
    assert.equal(parseCssColorAlpha("oklch(0.7 0.15 180 / 0.75)"), 0.75);
    assert.equal(parseCssColorAlpha("color(srgb 0.2 0.4 0.6)"), 1);
    assert.equal(parseCssColorAlpha("color(display-p3 1 0.5 0 / 50%)"), 0.5);
    assert.equal(parseCssColorAlpha("color(xyz-d65 0.5 0.5 0.5 / 0)"), 0);
    assert.equal(parseCssColorAlpha("oklab(0.5 -1.2e-3 0.05 / 0.5)"), 0.5);

    // Fail closed on gradients, unknown color spaces, malformed/empty alpha, trailing commas, or non-numeric channels.
    assert.equal(parseCssColorAlpha("url(#grad)"), null);
    assert.equal(parseCssColorAlpha("color(unknown-space 1 0 0)"), null);
    assert.equal(parseCssColorAlpha("oklch(0.7 0.15 180 / 1.5)"), null);
    assert.equal(parseCssColorAlpha("oklch(0.7 0.15)"), null);
    assert.equal(parseCssColorAlpha("not-a-color"), null);
    assert.equal(parseCssColorAlpha("rgb(255 0 0 / )"), null);
    assert.equal(parseCssColorAlpha("rgb(255 0 0 / %)"), null);
    assert.equal(parseCssColorAlpha("rgb(255, 0, 0, )"), null);
    assert.equal(parseCssColorAlpha("rgba(255, 0, 0,   )"), null);
    assert.equal(parseCssColorAlpha("oklch(0.5 0.2 120 / )"), null);
    assert.equal(parseCssColorAlpha("rgb(foo bar baz)"), null);
    assert.equal(parseCssColorAlpha("oklch(not a color)"), null);
    assert.equal(parseCssColorAlpha("color(srgb foo bar baz / 0.5)"), null);
  });
});

describe("Paket 2: framework-agnostic SourceBinding output receipt verification", () => {
  function setupBinding(root: string): HostBuildContainerBinding {
    return {
      kind: "host-build-container",
      root,
      receiptPath: ".breaklint/source.json",
      buildOutputReceiptPath: ".breaklint/output.json",
      compiledBuildSelector: 'meta[name="build"]',
      compiledBuildAttribute: "content",
      containers: [],
    };
  }

  it("verifies schemaVersion 1 (Next.js .next/BUILD_ID) and schemaVersion 2 (generic manifest with and without marker)", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-receipt-v2-"));
    try {
      mkdirSync(join(root, ".breaklint"), { recursive: true });
      mkdirSync(join(root, ".next"), { recursive: true });
      mkdirSync(join(root, "dist"), { recursive: true });
      const sourceBuildId = "a".repeat(64);

      // 1. Legacy Next.js schema 1
      const buildIdBytes = Buffer.from("next-build-42\n");
      writeFileSync(join(root, ".next/BUILD_ID"), buildIdBytes);
      const nextFiles = { ".next/BUILD_ID": { sha256: sha(buildIdBytes), byteLength: buildIdBytes.length, role: "build-output" } };
      writeFileSync(join(root, ".breaklint/output.json"), JSON.stringify({
        schemaVersion: 1, sourceBuildId, nextBuildId: "next-build-42", files: nextFiles, filesSha256: sha(canonical(nextFiles)),
      }));
      assert.doesNotThrow(() => verifyOutputReceipt(setupBinding(root), sourceBuildId));

      // 2. Generic schema 2 without marker (buildId === filesSha256)
      const htmlBytes = Buffer.from("<!doctype html><h1>Astro Dist</h1>");
      writeFileSync(join(root, "dist/index.html"), htmlBytes);
      const distFiles = { "dist/index.html": { sha256: sha(htmlBytes), byteLength: htmlBytes.length, role: "build-output" } };
      const distDigest = sha(canonical(distFiles));
      writeFileSync(join(root, ".breaklint/output.json"), JSON.stringify({
        schemaVersion: 2, sourceBuildId, buildId: distDigest, files: distFiles, filesSha256: distDigest,
      }));
      assert.doesNotThrow(() => verifyOutputReceipt(setupBinding(root), sourceBuildId));

      // 3. Generic schema 2 with explicit buildMarkerPath
      const markerBytes = Buffer.from("vite-2026-11-20\n");
      writeFileSync(join(root, "dist/BUILD_MARKER"), markerBytes);
      const markerFiles = {
        ...distFiles,
        "dist/BUILD_MARKER": { sha256: sha(markerBytes), byteLength: markerBytes.length, role: "build-output" },
      };
      writeFileSync(join(root, ".breaklint/output.json"), JSON.stringify({
        schemaVersion: 2, sourceBuildId, buildId: "vite-2026-11-20", buildMarkerPath: "dist/BUILD_MARKER",
        files: markerFiles, filesSha256: sha(canonical(markerFiles)),
      }));
      assert.doesNotThrow(() => verifyOutputReceipt(setupBinding(root), sourceBuildId));

      // Negative control: tampered output file fails closed
      writeFileSync(join(root, "dist/index.html"), Buffer.from("<!doctype html><h1>Tampered!!</h1>"));
      assert.throws(() => verifyOutputReceipt(setupBinding(root), sourceBuildId), /build output mismatch/);

      // Negative control: __proto__ key in schema-2 receipt fails closed without passing an empty inventory
      const protoFilesSha = sha("[]");
      writeFileSync(
        join(root, ".breaklint/output.json"),
        `{"schemaVersion":2,"sourceBuildId":${JSON.stringify(sourceBuildId)},"buildId":${JSON.stringify(protoFilesSha)},"files":{"__proto__":{"sha256":${JSON.stringify("a".repeat(64))},"byteLength":1,"role":"build-output"}},"filesSha256":${JSON.stringify(protoFilesSha)}}`,
      );
      assert.throws(() => verifyOutputReceipt(setupBinding(root), sourceBuildId), /invalid|inventory/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Paket 2: screen capture drift diff & schemaVersion 2 context/bundle compatibility", () => {
  it("reports concrete drifted fields and selectors bounded to 10 entries", () => {
    const baseTarget = {
      selector: "#card", domPath: "html:nth-child(1)>body:nth-child(2)>div:nth-child(1)", tag: "div", id: "card", className: "",
      textLength: 5, directTextSha256: "abc", hasDirectText: true, isSvg: false, isSvgText: false, isInteractiveControl: false, siblingEligible: true,
      fontSizePx: 16, siblingOverlapPx: 0, svgTextOverflowPx: 0, paintSignature: "p1", ancestorSignatureComplete: true,
      box: { x: 0, y: 0, width: 100, height: 40 }, coordinateSystem: "css-viewport-pixels" as const,
      state: "candidate" as const, reason: null, paint: null, transform: null, clipped: "none" as const,
      horizontalOverflow: 0, allowedScroll: false, overlay: false, sourceContainer: null, scroll: { x: 0, y: 0 },
    };
    const first = {
      signature: { url: "http://127.0.0.1/", viewport: [640, 400, 1] as [number, number, number], scroll: [0, 0] as [number, number], document: [640, 400, 640, 400, 2] as [number, number, number, number, number], fonts: "loaded" },
      targets: [baseTarget],
    };
    const second = {
      signature: { ...first.signature, scroll: [0, 20] as [number, number] },
      targets: [{ ...baseTarget, box: { x: 0, y: 0, width: 220, height: 40 } }],
    };
    const diff = computeScreenDriftDetails(first, second, "post-screenshot");
    assert.equal(diff.some((d) => d.field === "scroll" && d.phase === "post-screenshot"), true);
    assert.equal(diff.some((d) => d.field === "box" && d.selector === "#card" && d.before === "0,0,100x40" && d.after === "0,0,220x40"), true);
  });

  it("reads schemaVersion 2 screen reports in createContextPack and renderReport", () => {
    const report: PublicScreenReport = {
      schemaVersion: SCREEN_REPORT_SCHEMA_VERSION,
      profileKind: "screen",
      runId: "screen-v2-run",
      runVerdict: "findings",
      exitCode: 1,
      scope: { projectId: "pilot", documentId: "/", scenario: "full-page", url: "http://127.0.0.1/", viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, browserVersion: "test" },
      trust: "host-controlled-page",
      networkPolicy: "host-owned",
      rulesEnabled: ["web/unexpected-horizontal-overflow", "web/content-clipped", "web/sibling-overlap", "web/svg-text-overflows-viewport"],
      targetInventory: { complete: true, omittedCount: 0, reason: null },
      coverage: { candidates: 4, measured: 4, excluded: 0, notMeasured: 0, allowedScrollContainers: [], intentionalOverlays: [] },
      capture: { before: "a", stable: "a", after: "a", fontsReady: true, timedOut: false, drifted: false, stabilized: true, stabilizationAttempts: 1, driftDetails: [] },
      artifact: { kind: "png", relativePath: "evidence/screen-1.png", sha256: "0".repeat(64), byteLength: 100, widthPx: 1280, heightPx: 1600, capture: "full-page", coordinateSystem: "css-document-pixels" },
      evaluations: [{
        id: "eval-1", ruleId: "web/sibling-overlap",
        target: { selector: "#b", domPath: "div:nth-child(2)", tag: "div", box: { x: 10, y: 900, width: 100, height: 30 }, coordinateSystem: "css-document-pixels", scroll: { x: 0, y: 0 } },
        status: "measured", reason: null,
        measurements: [{ name: "sibling-overlap-depth", value: 12, unit: "css-px", operator: ">", threshold: 2, calibrated: false }],
        predicate: { connective: "single", violated: true },
        evidenceBound: true,
        source: { status: "unknown", method: null, file: null },
        stableIdentity: { status: "unavailable", value: null, candidates: [] },
      }],
      findings: [{
        id: "finding-1", ruleId: "web/sibling-overlap", severity: "warn",
        target: { selector: "#b", domPath: "div:nth-child(2)", tag: "div", box: { x: 10, y: 900, width: 100, height: 30 }, coordinateSystem: "css-document-pixels", scroll: { x: 0, y: 0 } },
        measurement: { name: "sibling-overlap-depth", value: 12, unit: "css-px", operator: ">", threshold: 2, calibrated: false },
        evaluationId: "eval-1",
        evidence: { bindsFinding: true, screenshot: "evidence/screen-1.png" },
        repair: { nextCheck: "rerun-same-scenario-and-viewport" },
      }],
      infrastructure: [],
      events: [],
    };
    const pack = createContextPack(report);
    assert.equal(pack.canonicalReport.schemaVersion, 2);
    assert.equal(pack.canonicalReport.profileKind, "screen");
    assert.equal(pack.findings.length, 1);
    assert.equal(pack.findings[0]!.ruleId, "web/sibling-overlap");
    const html = renderReport(report);
    assert.ok(html.includes("web/sibling-overlap"));
    assert.ok(html.includes("css-document-pixels"));

    // HTML-escape repair prose (e.g. `<text>` in web/svg-text-overflows-viewport) in writeReportBundle so tags never leak raw.
    const svgReport: PublicScreenReport = {
      ...report,
      evaluations: [{ ...report.evaluations[0]!, id: "eval-svg", ruleId: "web/svg-text-overflows-viewport" }],
      findings: [{ ...report.findings[0]!, id: "finding-svg", ruleId: "web/svg-text-overflows-viewport", severity: "error", evaluationId: "eval-svg" }],
    };
    const bundleDir = mkdtempSync(join(tmpdir(), "breaklint-screen-svg-bundle-"));
    try {
      const bundle = writeReportBundle(svgReport, { outDir: bundleDir });
      const svgHtml = readFileSync(bundle.htmlPath, "utf8");
      assert.ok(svgHtml.includes("&lt;text&gt;"), "screen repair text must HTML-escape <text>");
      assert.equal(svgHtml.includes("rendered <text> bounding box"), false, "raw <text> tag must not appear in HTML");

      // Malicious string injected into a numeric viewport field must never reach the HTML as
      // markup. Since 0.11.1 a numeric field is shown only when it is a finite number (C6), so the
      // string is replaced by "unavailable" rather than shown escaped.
      const xssReport = {
        ...svgReport,
        scope: { ...svgReport.scope, viewport: { ...svgReport.scope.viewport, width: "<b>injected</b>" as unknown as number } },
      };
      const xssBundle = writeReportBundle(xssReport, { outDir: bundleDir });
      const xssHtml = readFileSync(xssBundle.htmlPath, "utf8");
      assert.match(xssHtml, /<dt>Viewport<\/dt><dd>unavailable×\d+<\/dd>/u);
      assert.equal(xssHtml.includes("<b>injected</b>"), false);
      assert.equal(xssHtml.includes("injected"), false, "the non-numeric viewport value must not be shown at all");

      // Failed bundle write (mismatched comparison) must NOT overwrite existing report.json on disk.
      const priorReportJson = readFileSync(join(bundleDir, "report.json"), "utf8");
      assert.throws(() => writeReportBundle(
        { ...svgReport, runId: "new-run-should-not-write" },
        {
          outDir: bundleDir,
          comparison: { schemaVersion: 1, identityContract: "logical-source-value-v1", beforeRunId: "b", afterRunId: "other-run", results: [] },
        },
      ), /comparison does not refer/);
      assert.equal(readFileSync(join(bundleDir, "report.json"), "utf8"), priorReportJson);
    } finally {
      rmSync(bundleDir, { recursive: true, force: true });
    }

    // Drifted / insufficient-coverage screen reports must never claim selection.complete === true.
    const driftedReport: PublicScreenReport = {
      ...report,
      runVerdict: "insufficient-coverage",
      exitCode: 4,
      capture: { ...report.capture, drifted: true },
      findings: [],
    };
    const driftedPack = createContextPack(driftedReport);
    assert.equal(driftedPack.selection.complete, false);
    assert.equal(driftedPack.selection.reason, "run-verdict-insufficient-coverage");
  });
});

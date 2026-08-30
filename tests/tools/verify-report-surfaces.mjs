#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import {
  assertCurrentReviewInput,
  runReviewInputMutationControl,
} from "./report-surface-contract.mjs";

const output = resolve(
  process.env.BREAKLINT_SURFACE_DIR ?? fileURLToPath(new URL("../../.artifacts/report-surfaces", import.meta.url)),
);
const manifestPath = resolve(output, "manifest.json");
const ledgerPath = new URL("../golden/report-surfaces/review-ledger.json", import.meta.url);
const reviewInputRoot = resolve(process.env.BREAKLINT_REVIEW_INPUT_ROOT ?? fileURLToPath(new URL("../..", import.meta.url)));
const REVIEW_ARTIFACT_CONTRACT_VERSION = 3;
const SCREEN_PIXEL_CONTRACT_VERSION = 1;
const REQUIRED_BROWSER_RENDER_ARGS = [
  "--deterministic-mode",
  "--disable-gpu",
  "--disable-lcd-text",
  "--disable-skia-runtime-opts",
  "--font-render-hinting=none",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
];

function verificationMode(args) {
  if (args.length === 0) return "local";
  if (args.length === 2 && args[0] === "--mode" && ["local", "technical"].includes(args[1])) return args[1];
  if (args.length === 1 && /^--mode=(?:local|technical)$/u.test(args[0])) return args[0].slice("--mode=".length);
  throw new Error("usage: verify-report-surfaces.mjs [--mode local|technical]");
}

const mode = verificationMode(process.argv.slice(2));
assert.equal(existsSync(manifestPath), true, `render manifest missing: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: reviewInputRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

function independentlyLongestDarkHorizontalRun(path, maxY = 120) {
  const decoded = PNG.sync.read(readFileSync(path), { checkCRC: true });
  let longest = 0;
  for (let y = 0; y < Math.min(maxY, decoded.height); y += 1) {
    let current = 0;
    for (let x = 0; x < decoded.width; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      const dark = decoded.data[offset] < 180 && decoded.data[offset + 1] < 180 && decoded.data[offset + 2] < 180;
      current = dark ? current + 1 : 0;
      longest = Math.max(longest, current);
    }
  }
  return { pixels: longest, required: Math.ceil(decoded.width * 0.75) };
}

function independentlyCheckCoveragePageStarts(pdf, raster) {
  const pdfPath = resolve(output, pdf.path);
  return raster.pages.map((pageArtifact, index) => {
    const page = index + 1;
    const firstToken = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"])
      .trim()
      .match(/^\S+/u)?.[0] ?? null;
    const border = independentlyLongestDarkHorizontalRun(resolve(output, pageArtifact.path));
    const beginsWithCoverageRecord = firstToken === "RULE";
    const beginsWithCoverageFragment = firstToken !== null && firstToken !== "RULE" && firstToken.includes("/");
    assert.equal(beginsWithCoverageFragment, false, `${pageArtifact.path}: page begins inside a coverage record at ${firstToken}`);
    assert.ok(!beginsWithCoverageRecord || border.pixels >= border.required, `${pageArtifact.path}: fragmented coverage record at page start`);
    return { page, firstToken, beginsWithCoverageRecord, beginsWithCoverageFragment, topHorizontalBorderPx: border.pixels, requiredBorderPx: border.required };
  });
}

function independentlyCheckCoverageBoxClosure(pdf, raster, expectedRecords) {
  assert.ok(expectedRecords > 0, `${pdf.cell}: coverage box inventory must not be empty`);
  const pdfPath = resolve(output, pdf.path);
  const rasterDpi = manifest.reviewEnvironment.print.rasterDpi;
  const contentWidthCssPx = manifest.reviewEnvironment.print.contentViewportCssPx.width;
  const minimumEdgeCoverage = 0.98;
  const maximumEdgeGapPx = 2;
  const minimumHorizontalCoverage = 0.95;
  const pages = raster.pages.map((pageArtifact, pageIndex) => {
    const page = pageIndex + 1;
    const xml = run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdfPath, "-"]);
    const words = [...xml.matchAll(
      /<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]+)<\/word>/gu,
    )].map((match) => ({
      xMin: Number(match[1]),
      yMin: Number(match[2]),
      xMax: Number(match[3]),
      yMax: Number(match[4]),
      text: match[5],
    }));
    const rules = words.filter((word) => word.text === "RULE").sort((a, b) => a.yMin - b.yMin);
    const results = words.filter((word) => word.text === "RESULT").sort((a, b) => a.yMin - b.yMin);
    const decoded = PNG.sync.read(readFileSync(resolve(output, pageArtifact.path)), { checkCRC: true });
    const contentWidthRasterPx = contentWidthCssPx * rasterDpi / 96;
    const projectedLeft = Math.round((decoded.width - contentWidthRasterPx) / 2);
    const projectedRight = Math.round(decoded.width - (decoded.width - contentWidthRasterPx) / 2 - 1);
    const isDark = (x, y) => {
      const offset = (y * decoded.width + x) * 4;
      return decoded.data[offset] < 180 && decoded.data[offset + 1] < 180 &&
        decoded.data[offset + 2] < 180 && decoded.data[offset + 3] > 0;
    };
    const edgeRowIsDark = (x, y) => [x - 2, x - 1, x, x + 1, x + 2]
      .some((candidate) => candidate >= 0 && candidate < decoded.width && isDark(candidate, y));
    const horizontalCoverage = (y) => {
      let hits = 0;
      for (let x = projectedLeft; x <= projectedRight; x += 1) {
        if (isDark(x, y)) hits += 1;
      }
      return hits / (projectedRight - projectedLeft + 1);
    };
    const edgeStats = (x, top, bottom) => {
      let darkRows = 0;
      let currentGapPx = 0;
      let maximumGapPx = 0;
      for (let y = top; y <= bottom; y += 1) {
        if (edgeRowIsDark(x, y)) {
          darkRows += 1;
          currentGapPx = 0;
        } else {
          currentGapPx += 1;
          maximumGapPx = Math.max(maximumGapPx, currentGapPx);
        }
      }
      const rows = bottom - top + 1;
      return { coverage: Math.round(darkRows / rows * 1_000) / 1_000, maximumGapPx };
    };
    const anchors = rules.map((rule, index) => {
      const nextRuleY = rules[index + 1]?.yMin ?? Number.POSITIVE_INFINITY;
      const result = results.find((candidate) => candidate.yMin > rule.yMax && candidate.yMin < nextRuleY);
      assert.ok(result, `${pageArtifact.path}: RULE has no RESULT anchor before the next coverage card`);
      const ruleY = Math.round((rule.yMin + rule.yMax) / 2 * rasterDpi / 72);
      const resultY = Math.round((result.yMin + result.yMax) / 2 * rasterDpi / 72);
      let top = ruleY;
      while (top >= 0 && horizontalCoverage(top) < minimumHorizontalCoverage) top -= 1;
      let bottom = resultY;
      while (bottom < decoded.height && horizontalCoverage(bottom) < minimumHorizontalCoverage) bottom += 1;
      assert.ok(top >= 0 && bottom < decoded.height && top < ruleY && bottom > resultY,
        `${pageArtifact.path}: PDF text anchors have no complete enclosing horizontal frame`);
      const leftStats = edgeStats(projectedLeft, top, bottom);
      const rightStats = edgeStats(projectedRight, top, bottom);
      assert.ok(
        leftStats.coverage >= minimumEdgeCoverage && leftStats.maximumGapPx <= maximumEdgeGapPx &&
        rightStats.coverage >= minimumEdgeCoverage && rightStats.maximumGapPx <= maximumEdgeGapPx,
        `${pageArtifact.path}: full-height physical edge is open ` +
          `(left ${leftStats.coverage}/${leftStats.maximumGapPx}px, right ${rightStats.coverage}/${rightStats.maximumGapPx}px; ` +
          `required ${minimumEdgeCoverage}/${maximumEdgeGapPx}px)`,
      );
      return {
        ruleY,
        resultY,
        top,
        bottom,
        left: projectedLeft,
        right: projectedRight,
        leftCoverage: leftStats.coverage,
        leftMaximumGapPx: leftStats.maximumGapPx,
        rightCoverage: rightStats.coverage,
        rightMaximumGapPx: rightStats.maximumGapPx,
      };
    });
    return { page, path: pageArtifact.path, anchors };
  });
  const anchors = pages.flatMap((page) => page.anchors);
  assert.equal(anchors.length, expectedRecords, `coverage text-anchor inventory drift: detected ${anchors.length}/${expectedRecords}`);

  assert.equal(pdf.boxClosureChecks.expectedRecords, expectedRecords, `${pdf.cell}: reported box inventory input drift`);
  assert.equal(pdf.boxClosureChecks.detectedRecords, expectedRecords, `${pdf.cell}: renderer did not detect every coverage box`);
  assert.equal(pdf.boxClosureChecks.minimumHorizontalCoverage, minimumHorizontalCoverage, `${pdf.cell}: horizontal frame threshold drift`);
  assert.equal(pdf.boxClosureChecks.minimumEdgeCoverage, minimumEdgeCoverage, `${pdf.cell}: box edge threshold drift`);
  assert.equal(pdf.boxClosureChecks.maximumEdgeGapPx, maximumEdgeGapPx, `${pdf.cell}: box edge gap threshold drift`);
  const reportedBoxes = pdf.boxClosureChecks.pages.flatMap((page) => page.boxes);
  assert.equal(reportedBoxes.length, expectedRecords, `${pdf.cell}: reported box detail inventory drift`);
  assert.ok(
    reportedBoxes.every((box) =>
      box.leftCoverage >= minimumEdgeCoverage && box.leftMaximumGapPx <= maximumEdgeGapPx &&
      box.rightCoverage >= minimumEdgeCoverage && box.rightMaximumGapPx <= maximumEdgeGapPx
    ),
    `${pdf.cell}: renderer reported an open coverage edge`,
  );
  for (const page of pages) {
    const reported = pdf.boxClosureChecks.pages.find((candidate) => candidate.page === page.page);
    assert.ok(reported, `${pdf.cell}: renderer omitted box details for page ${page.page}`);
    assert.equal(reported.path, page.path, `${pdf.cell}: renderer box page path drift`);
    assert.equal(reported.boxes.length, page.anchors.length, `${pdf.cell}: renderer/PDF-anchor page inventory drift`);
    const orderedReported = [...reported.boxes].sort((a, b) => a.top - b.top);
    for (const [index, anchor] of page.anchors.entries()) {
      const box = orderedReported[index];
      for (const coordinate of ["top", "bottom", "left", "right"]) {
        assert.ok(
          Math.abs(box[coordinate] - anchor[coordinate]) <= 2,
          `${pdf.cell}: renderer ${coordinate} geometry disagrees with independent PDF-anchor frame on page ${page.page}`,
        );
      }
    }
  }
  return {
    expectedRecords,
    verifiedAnchors: anchors.length,
    minimumHorizontalCoverage,
    minimumEdgeCoverage,
    maximumEdgeGapPx,
    pages,
  };
}

function independentlyRasterInkBounds(path) {
  const decoded = PNG.sync.read(readFileSync(path), { checkCRC: true });
  let topPx = decoded.height;
  let bottomPx = 0;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      if (decoded.data[offset] < 248 || decoded.data[offset + 1] < 248 || decoded.data[offset + 2] < 248) {
        topPx = Math.min(topPx, y);
        bottomPx = Math.max(bottomPx, y + 1);
      }
    }
  }
  return { topPx: bottomPx === 0 ? null : topPx, bottomPx, pageHeightPx: decoded.height };
}

function independentlyCheckTerminalPageContent(pdf, raster) {
  const pdfPath = resolve(output, pdf.path);
  const pages = raster.pages.map((pageArtifact, index) => {
    const page = index + 1;
    const pageText = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    return {
      page,
      firstToken: pageText.trim().match(/^\S+/u)?.[0] ?? null,
      nonWhitespaceCharacters: pageText.replace(/\s/gu, "").length,
      coverageRecords: (pageText.match(/^\s*RULE\s*$/gmu) ?? []).length,
      ink: independentlyRasterInkBounds(resolve(output, pageArtifact.path)),
    };
  });
  const emptyNonCoverPages = pages.filter((page) => page.page > 1 && page.nonWhitespaceCharacters === 0).map((page) => page.page);
  const terminal = pages.at(-1);
  const previous = pages.at(-2);
  const continuesCoverage = Boolean(terminal && previous && terminal.firstToken === "RULE" && previous.coverageRecords > 0);
  const minimumTerminalCoverageRecords = continuesCoverage ? Math.max(1, Math.ceil(previous.coverageRecords / 2)) : 0;
  const expectedMinimumInkBottomPx = continuesCoverage
    ? Math.round(previous.ink.bottomPx * minimumTerminalCoverageRecords / previous.coverageRecords)
    : 0;
  const underfilledCoverageContinuation = Boolean(
    continuesCoverage && terminal &&
    terminal.coverageRecords < minimumTerminalCoverageRecords &&
    terminal.ink.bottomPx < expectedMinimumInkBottomPx
  );
  assert.deepEqual(emptyNonCoverPages, [], `${pdf.cell}: empty non-cover page`);
  assert.equal(underfilledCoverageContinuation, false, `${pdf.cell}: underfilled terminal coverage continuation`);
  return {
    pages,
    emptyNonCoverPages,
    terminalCoverage: {
      continuesCoverage,
      previousCoverageRecords: previous?.coverageRecords ?? 0,
      terminalCoverageRecords: terminal?.coverageRecords ?? 0,
      minimumTerminalCoverageRecords,
      terminalInkBottomPx: terminal?.ink.bottomPx ?? 0,
      expectedMinimumInkBottomPx,
      underfilledCoverageContinuation,
    },
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function independentlyComputeArtifactFingerprint(reviewInputFingerprint, reviewEnvironment, cell, visibleContract) {
  return createHash("sha256")
    .update("breaklint-stable-review-artifact-v3\0")
    .update(JSON.stringify(canonical({ reviewInputFingerprint, reviewEnvironment, cell, visibleContract })))
    .digest("hex");
}

/** Independent implementation of the renderer's visible-screen contract. */
function independentlyNormalizeScreenPixels(bytes) {
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  const rgba = Buffer.from(decoded.data);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) {
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
    }
  }
  return {
    contract: {
      contractVersion: SCREEN_PIXEL_CONTRACT_VERSION,
      format: "decoded 8-bit straight RGBA; transparent RGB canonicalized to zero",
      width: decoded.width,
      height: decoded.height,
      rgbaBytes: rgba.length,
      normalizedRgbaSha256: createHash("sha256").update(rgba).digest("hex"),
    },
    decoded,
    rgba,
  };
}

function printVisibleContract(state) {
  const pdf = manifest.artifacts.find((artifact) => artifact.cell === `print/${state}/pdf`);
  const raster = manifest.artifacts.find((artifact) => artifact.cell === `print/${state}/raster-set`);
  assert.ok(pdf, `print/${state}: PDF cell missing`);
  assert.ok(raster, `print/${state}: raster-set cell missing`);
  assert.equal(pdf.pages, raster.pages.length, `print/${state}: PDF/raster page-count mismatch`);
  assert.deepEqual(
    pdf.rasterPageVisualHashes,
    raster.pages.map((page) => page.sha256),
    `print/${state}: PDF is not bound to the current independent page rasters`,
  );
  assert.equal(pdf.printSemantics.trustLabelLines, 1, `print/${state}: Coverage Trust label split across lines`);
  assert.equal(pdf.printSemantics.trustValueOverflowPx, 0, `print/${state}: Coverage Trust verdict is not fully visible inside its card`);
  assert.equal(pdf.printSemantics.trustSiblingOverlapPx, 0, `print/${state}: Coverage Trust verdict overlaps its sibling summary card`);
  assert.equal(pdf.printSemantics.coverageListDisplay, "block", `print/${state}: coverage list fragmentation context drift`);
  assert.ok(pdf.printSemantics.coverageRecordDisplay.every((value) => value === "flow-root"), `print/${state}: coverage record uses a fragment-prone layout context`);
  assert.ok(pdf.printSemantics.coverageMaxCellsPerRow.every((count) => count <= 2), `print/${state}: coverage print columns are compressed`);
  assert.ok(pdf.printSemantics.coverageRecordBreakInside.every((value) => ["avoid", "avoid-page"].includes(value)), `print/${state}: coverage row may fragment`);
  assert.deepEqual(pdf.printSemantics.overflowingCoverageCells, [], `print/${state}: coverage cell overflows its column`);
  assert.deepEqual(pdf.pageStartChecks, independentlyCheckCoveragePageStarts(pdf, raster), `print/${state}: page-start raster invariant drift`);
  assert.deepEqual(pdf.pageContentChecks, independentlyCheckTerminalPageContent(pdf, raster), `print/${state}: terminal-page content invariant drift`);
  independentlyCheckCoverageBoxClosure(pdf, raster, pdf.printSemantics.coverageRecordCount);
  return {
    pages: pdf.pages,
    pageSize: pdf.pageSize,
    contrast: pdf.contrast,
    printSemantics: pdf.printSemantics,
    pageStartChecks: pdf.pageStartChecks,
    pageContentChecks: pdf.pageContentChecks,
    boxClosureChecks: pdf.boxClosureChecks,
    rasterPages: raster.pages.map((page) => ({ sha256: page.sha256, dimensions: page.dimensions })),
  };
}

function verifyBackgroundDisabledProbe() {
  assert.ok(Array.isArray(manifest.technicalProbes), "technical report-surface probes are missing");
  assert.equal(manifest.technicalProbes.length, 1, "exactly one background-disabled technical probe is required");
  const probe = manifest.technicalProbes[0];
  assert.equal(probe.id, "print-background-disabled/insufficient-coverage");
  assert.equal(probe.state, "insufficient-coverage");
  assert.equal(probe.printBackground, false, "background-disabled probe was rendered with background graphics");
  assert.equal(probe.coverageRecordCount, 13, "background-disabled probe coverage inventory drift");
  assert.equal(probe.shortCoverageRecordCount, 1, "background-disabled probe must include the strong-border warning variant");
  const pdfPath = resolve(output, probe.pdf.path);
  assert.equal(existsSync(pdfPath), true, `background-disabled probe PDF missing: ${probe.pdf.path}`);
  assert.equal(hash(pdfPath), probe.pdf.sha256, "background-disabled probe PDF hash drift");
  assert.ok(probe.pdf.bytes > 1_000, "background-disabled probe PDF is implausibly small");
  assert.equal(probe.pdf.pages, probe.rasterPages.length, "background-disabled probe PDF/raster page-count mismatch");
  assert.match(probe.pdf.pageSize, /A4|594\.9\d* x 841\.9\d* pts/iu, "background-disabled probe is not A4");
  for (const page of probe.rasterPages) {
    const path = resolve(output, page.path);
    assert.equal(existsSync(path), true, `background-disabled probe raster missing: ${page.path}`);
    assert.equal(hash(path), page.sha256, `background-disabled probe raster hash drift: ${page.path}`);
    assert.ok(page.bytes > 1_000, `background-disabled probe raster is implausibly small: ${page.path}`);
    const decoded = PNG.sync.read(readFileSync(path), { checkCRC: true });
    assert.deepEqual(page.dimensions, { width: decoded.width, height: decoded.height }, `background-disabled raster dimensions drift: ${page.path}`);
  }
  independentlyCheckCoverageBoxClosure(
    {
      cell: "technical/print-background-disabled/insufficient-coverage",
      path: probe.pdf.path,
      boxClosureChecks: probe.boxClosureChecks,
    },
    { pages: probe.rasterPages },
    probe.coverageRecordCount,
  );
}

function assertUtcTimestamp(value, message) {
  assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u, message);
  assert.equal(Number.isNaN(Date.parse(value)), false, message);
}

function assertReviewEnvironment(environment, label) {
  assert.equal(environment?.reviewArtifactContractVersion, REVIEW_ARTIFACT_CONTRACT_VERSION, `${label}: artifact contract drift`);
  assert.equal(environment?.screenPixelContractVersion, SCREEN_PIXEL_CONTRACT_VERSION, `${label}: pixel contract drift`);
  for (const field of ["browser", "platform", "architecture", "platformRelease", "node"]) {
    assert.ok(typeof environment[field] === "string" && environment[field].length > 0, `${label}: ${field} missing`);
  }
  assert.equal(environment.deviceScaleFactor, 1, `${label}: device scale drift`);
  assert.deepEqual(environment.browserRenderArgs, REQUIRED_BROWSER_RENDER_ARGS, `${label}: deterministic browser arguments drift`);
  assert.deepEqual(environment.print?.contentViewportCssPx, { width: 703, height: 1123 }, `${label}: A4 content-width layout probe drift`);
  assert.equal(environment.print?.rasterDpi, 110, `${label}: print raster DPI drift`);
  assert.match(environment.browser, /Chrome[^\n]*\d+\.\d+\.\d+\.\d+/u, `${label}: browser version is not measurable`);
  assert.match(environment.print?.rasterizer ?? "", /^pdftoppm version\s+\S+/u, `${label}: rasterizer version is not measurable`);
}

function assertHumanLedgerRecord(currentInput) {
  assert.equal(ledger.schemaVersion, 4, "human ledger schema drift");
  assertUtcTimestamp(ledger.renderManifestGeneratedAt, "human ledger render timestamp drift");
  assertUtcTimestamp(ledger.reviewedAt, "human ledger review timestamp drift");
  assertReviewEnvironment(ledger.reviewEnvironment, "human review environment");
  assert.match(ledger.reviewInputFingerprint ?? "", /^[a-f0-9]{64}$/u, "human ledger input fingerprint is invalid");
  for (const field of ["screens", "pdfs", "rasterPages"]) {
    assert.ok(Number.isSafeInteger(ledger.physicalArtifactsReviewed?.[field]) && ledger.physicalArtifactsReviewed[field] > 0,
      `human ledger ${field} inventory is invalid`);
  }
  assert.equal(Object.keys(ledger.cells ?? {}).length, 32, "human ledger cell inventory drift");
  assert.ok(Object.values(ledger.cells).every((cell) => cell.status === "pass"), "human ledger contains a non-pass cell");
  assert.match(ledger.reviewer ?? "", /^@(Brand|Neo|Founder)(?:\s*\+\s*@(Brand|Neo|Founder))*$/u, "human ledger reviewer drift");
  return ledger.reviewInputFingerprint === currentInput.fingerprint;
}

function runScreenPixelMutationControl(artifact, currentInput) {
  const path = resolve(output, artifact.path);
  const original = independentlyNormalizeScreenPixels(readFileSync(path));
  const mutatedRgba = Buffer.from(original.rgba);
  let changedOffset = -1;
  for (let offset = 0; offset < mutatedRgba.length; offset += 4) {
    if (mutatedRgba[offset + 3] !== 0) {
      mutatedRgba[offset] ^= 1;
      changedOffset = offset;
      break;
    }
  }
  assert.notEqual(changedOffset, -1, `${artifact.cell}: no visible pixel available for mutation control`);
  const mutatedPng = new PNG({ width: original.decoded.width, height: original.decoded.height });
  mutatedPng.data = mutatedRgba;
  const roundTripped = independentlyNormalizeScreenPixels(PNG.sync.write(mutatedPng, { colorType: 6 }));
  assert.notEqual(
    roundTripped.contract.normalizedRgbaSha256,
    original.contract.normalizedRgbaSha256,
    `${artifact.cell}: visible RGBA mutation escaped the normalized pixel hash`,
  );
  const originalFingerprint = independentlyComputeArtifactFingerprint(
    currentInput.fingerprint,
    manifest.reviewEnvironment,
    artifact.cell,
    { dimensions: artifact.dimensions, semantics: artifact.semantics, pixels: original.contract },
  );
  const mutatedFingerprint = independentlyComputeArtifactFingerprint(
    currentInput.fingerprint,
    manifest.reviewEnvironment,
    artifact.cell,
    { dimensions: artifact.dimensions, semantics: artifact.semantics, pixels: roundTripped.contract },
  );
  assert.equal(originalFingerprint, artifact.reviewArtifactFingerprint, `${artifact.cell}: mutation control baseline drift`);
  assert.notEqual(mutatedFingerprint, originalFingerprint, `${artifact.cell}: visible pixel mutation left human fingerprint green`);
  return { cell: artifact.cell, changedOffset, before: original.contract.normalizedRgbaSha256, after: roundTripped.contract.normalizedRgbaSha256 };
}

assert.equal(manifest.schemaVersion, 4);
assertUtcTimestamp(manifest.generatedAt, "render manifest generatedAt is not an exact UTC timestamp");
assertReviewEnvironment(manifest.reviewEnvironment, "current render environment");
const currentReviewInput = assertCurrentReviewInput(manifest.reviewInputFingerprint, reviewInputRoot, "render manifest review input");
const technicalLedgerCurrent = mode === "technical" ? assertHumanLedgerRecord(currentReviewInput) : null;
verifyBackgroundDisabledProbe();
assert.deepEqual(manifest.reviewInputs, currentReviewInput.files, "render manifest input inventory does not match an independent current-worktree reconstruction");
if (mode !== "technical") {
  assert.equal(ledger.schemaVersion, 4);
  assertUtcTimestamp(ledger.renderManifestGeneratedAt, "ledger renderManifestGeneratedAt is not historical UTC audit metadata");
  assertReviewEnvironment(ledger.reviewEnvironment, "human review environment");
  assert.equal(ledger.reviewInputFingerprint, currentReviewInput.fingerprint, "human review ledger is bound to a different source/input revision");
  if (mode === "local") {
    assert.deepEqual(ledger.reviewEnvironment, manifest.reviewEnvironment, "strict local human review cannot transfer to a different browser/platform/render environment");
  }
}
runReviewInputMutationControl(manifest.reviewInputFingerprint, reviewInputRoot);
assert.equal(manifest.artifacts.length, 32, "the surface matrix must contain exactly 32 review cells");
assert.equal(new Set(manifest.artifacts.map((artifact) => artifact.cell)).size, 32, "duplicate render cell");
if (mode !== "technical") {
  assert.deepEqual([...Object.keys(ledger.cells)].sort(), manifest.artifacts.map((artifact) => artifact.cell).sort(), "the human review ledger and current render matrix disagree");
}

let pixelMutationControl = null;
for (const artifact of manifest.artifacts) {
  const state = artifact.cell.split("/")[1];
  let visibleContract;
  if (artifact.kind === "screen") {
    const path = resolve(output, artifact.path);
    assert.equal(existsSync(path), true, `${artifact.cell}: missing ${artifact.path}`);
    const independentlyDecoded = independentlyNormalizeScreenPixels(readFileSync(path));
    assert.deepEqual(artifact.pixels, independentlyDecoded.contract, `${artifact.cell}: decoded RGBA contract drift`);
    assert.deepEqual(artifact.dimensions, { width: independentlyDecoded.contract.width, height: independentlyDecoded.contract.height }, `${artifact.cell}: PNG dimensions disagree with decoded pixels`);
    visibleContract = { dimensions: artifact.dimensions, semantics: artifact.semantics, pixels: independentlyDecoded.contract };
  } else {
    visibleContract = printVisibleContract(state);
  }
  assert.equal(
    artifact.reviewArtifactFingerprint,
    independentlyComputeArtifactFingerprint(currentReviewInput.fingerprint, manifest.reviewEnvironment, artifact.cell, visibleContract),
    `${artifact.cell}: manifest stable review fingerprint failed independent reconstruction`,
  );
  if (artifact.kind === "raster-set") {
    assert.ok(artifact.pages.length > 0, `${artifact.cell}: no rasterized PDF pages`);
    for (const page of artifact.pages) {
      const path = resolve(output, page.path);
      assert.equal(existsSync(path), true, `${artifact.cell}: missing ${page.path}`);
      assert.ok(page.bytes > 1_000, `${artifact.cell}: implausibly small ${page.path}`);
      assert.equal(hash(path), page.sha256, `${artifact.cell}: hash drift in ${page.path}`);
      assert.ok(page.dimensions.width > 500 && page.dimensions.height > 700, `${artifact.cell}: unreadable raster geometry`);
    }
    continue;
  }
  const path = resolve(output, artifact.path);
  assert.equal(existsSync(path), true, `${artifact.cell}: missing ${artifact.path}`);
  assert.ok(artifact.bytes > 1_000, `${artifact.cell}: implausibly small artifact`);
  assert.equal(hash(path), artifact.sha256, `${artifact.cell}: hash drift`);
  if (artifact.kind === "screen") {
    assert.equal(artifact.semantics.mainCount, 1);
    assert.equal(artifact.semantics.h1Count, 1);
    assert.ok(artifact.semantics.bodyFontPx >= 16);
    assert.equal(artifact.semantics.horizontalOverflowPx, 0);
    assert.deepEqual(artifact.semantics.overflowingFindings, []);
    assert.deepEqual(artifact.semantics.externalResources, []);
    assert.ok(artifact.semantics.contrast.minimum >= 4.5, `${artifact.cell}: WCAG AA contrast failed`);
    assert.ok(artifact.dimensions.width >= 390 && artifact.dimensions.height >= 844);
    pixelMutationControl ??= runScreenPixelMutationControl(artifact, currentReviewInput);
  } else {
    assert.ok(artifact.pages >= 1);
    assert.match(artifact.pageSize, /A4|594\.9\d* x 841\.9\d* pts/iu);
    assert.ok(artifact.contrast.minimum >= 4.5, `${artifact.cell}: print contrast failed`);
  }
}
assert.ok(pixelMutationControl, "screen pixel mutation control did not run");

assert.deepEqual(manifest.physicalArtifacts, { screens: 24, pdfs: 4, rasterPages: 31 }, "the final inventory must be exactly 24 screens, 4 PDFs and 31 PDF page rasters");

if (mode !== "technical") {
  const pending = [];
  for (const artifact of manifest.artifacts) {
    const review = ledger.cells[artifact.cell];
    if (review.status !== "pass") {
      pending.push(artifact.cell);
      continue;
    }
    assert.match(review.reviewArtifactFingerprint ?? "", /^[a-f0-9]{64}$/u, `${artifact.cell}: stable review fingerprint missing`);
    if (mode === "local") {
      assert.equal(review.reviewArtifactFingerprint, artifact.reviewArtifactFingerprint, `${artifact.cell}: strict local human review is bound to a different rendered artifact`);
    }
    assert.match(review.reviewer ?? "", /^@(Brand|Neo|Founder)(?:\s*\+\s*@(Brand|Neo|Founder))*$/u, `${artifact.cell}: reviewer is absent or not an actual review role`);
    assertUtcTimestamp(review.reviewedAt, `${artifact.cell}: reviewedAt is not an exact UTC timestamp`);
    assert.ok(typeof review.note === "string" && review.note.trim().length >= 12, `${artifact.cell}: review note is missing`);
    if (artifact.kind === "screen") {
      assert.match(review.reviewedRawSha256 ?? "", /^[a-f0-9]{64}$/u, `${artifact.cell}: reviewed raw PNG SHA-256 audit trail missing`);
      assert.match(review.reviewedNormalizedRgbaSha256 ?? "", /^[a-f0-9]{64}$/u, `${artifact.cell}: reviewed RGBA SHA-256 missing`);
      if (mode === "local") {
        assert.equal(review.reviewedNormalizedRgbaSha256, artifact.pixels.normalizedRgbaSha256, `${artifact.cell}: strict local human review is bound to different visible screen pixels`);
      }
      assert.deepEqual(review.reviewedArtifacts, [artifact.path], `${artifact.cell}: reviewed screen is not named exactly`);
    } else if (artifact.kind === "pdf") {
      assert.match(review.reviewedRawSha256 ?? "", /^[a-f0-9]{64}$/u, `${artifact.cell}: reviewed raw PDF SHA-256 audit trail missing`);
      assert.deepEqual(review.reviewedPages, Array.from({ length: artifact.pages }, (_, index) => index + 1), `${artifact.cell}: PDF page review is incomplete`);
      assert.deepEqual(review.reviewedArtifacts, [artifact.path], `${artifact.cell}: reviewed PDF is not named exactly`);
    } else {
      assert.equal(review.reviewedRawSha256?.length, artifact.pages.length, `${artifact.cell}: reviewed raster SHA-256 audit trail is incomplete`);
      for (const reviewedHash of review.reviewedRawSha256) assert.match(reviewedHash, /^[a-f0-9]{64}$/u, `${artifact.cell}: invalid reviewed raster SHA-256`);
      assert.deepEqual(review.reviewedPages, Array.from({ length: artifact.pages.length }, (_, index) => index + 1), `${artifact.cell}: raster page review is incomplete`);
      assert.deepEqual(review.reviewedArtifacts, artifact.pages.map((page) => page.path), `${artifact.cell}: raster artifacts do not match the matrix contract`);
    }
  }
  assert.deepEqual(pending, [], `visual review remains pending for ${pending.length}/32 cells: ${pending.join(", ")}`);
  assertUtcTimestamp(ledger.reviewedAt, "ledger reviewedAt is not an exact UTC timestamp");
  assert.match(ledger.reviewer ?? "", /^@(Brand|Neo|Founder)(?:\s*\+\s*@(Brand|Neo|Founder))*$/u, "ledger reviewer is absent or not an actual review role");
  assert.deepEqual(ledger.physicalArtifactsReviewed, manifest.physicalArtifacts, "human ledger does not attest the complete physical artifact inventory");
}

if (mode === "technical") {
  process.stdout.write(
    `report surfaces: technical gate passed 32/32 current cells and 59 physical artifacts; ` +
      `no human-review claim is made; the separate human ledger ${technicalLedgerCurrent ? "matches" : "differs from"} ` +
      `current inputs (${manifest.reviewInputFingerprint}; pixel mutation rejected)\n`,
  );
} else {
  process.stdout.write(
    `report surfaces: strict local exact-environment human gate passed 32/32 cells ` +
      `(${ledger.reviewedAt}; ${manifest.reviewInputFingerprint}; pixel mutation rejected)\n`,
  );
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import {
  REVIEW_ARTIFACT_CONTRACT_VERSION,
  SCREEN_PIXEL_CONTRACT_VERSION,
  assertCurrentReviewInput,
  assertObservedEnvironment,
  assertReviewEnvironment,
  assessHumanGate,
  describeLatestRound,
  runReviewInputMutationControl,
  validateReviewLedger,
} from "./report-surface-contract.mjs";

const output = resolve(
  process.env.BREAKLINT_SURFACE_DIR ?? fileURLToPath(new URL("../../.artifacts/report-surfaces", import.meta.url)),
);
const manifestPath = resolve(output, "manifest.json");
const ledgerPath = new URL("../golden/report-surfaces/review-ledger.json", import.meta.url);
const reviewInputRoot = resolve(process.env.BREAKLINT_REVIEW_INPUT_ROOT ?? fileURLToPath(new URL("../..", import.meta.url)));

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

const COVERAGE_ROW_LINE = /^\s*([a-z0-9]+\/[a-z0-9-]+)\s+\d+\s+\d+\s+\d+\s+(?:\d+(?:\.\d+)?%|n\/a)\s+\d+(?:\.\d+)?%\s+(?:Coverage met|Below floor)\s*$/u;

/**
 * Independent of the renderer's DOM geometry and of its PDF word anchors: rows are read from the
 * `-layout` text (a rule id followed by five values and a result on one line), the table extent is
 * the projected A4 content box, and each row's closing rule is looked for in the raster between the
 * row's own text and the next row's. The renderer's report is then cross-checked against this.
 */
function independentlyCheckCoverageRows(pdfPath, rasterPages, expectedRows, reported, label) {
  const rasterDpi = manifest.reviewEnvironment.print.rasterDpi;
  const contentWidthCssPx = manifest.reviewEnvironment.print.contentViewportCssPx.width;
  const minimumEdgeCoverage = 0.98;
  const maximumEdgeGapPx = 2;
  const pages = rasterPages.map((pageArtifact, pageIndex) => {
    const page = pageIndex + 1;
    const layout = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]).split("\n");
    const rowIds = layout.map((line) => COVERAGE_ROW_LINE.exec(line)?.[1]).filter(Boolean);
    const firstRowLine = layout.findIndex((line) => COVERAGE_ROW_LINE.test(line));
    const header = firstRowLine > 0 && layout.slice(0, firstRowLine).some((line) => /^\s*RULE\b.*\bRESULT\s*$/u.test(line));
    const caption = layout.some((line) => /Document verdict:/u.test(line));
    const xml = run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdfPath, "-"]);
    const words = [...xml.matchAll(/<word xMin="[0-9.]+" yMin="([0-9.]+)" xMax="[0-9.]+" yMax="([0-9.]+)">([^<]+)<\/word>/gu)]
      .map((match) => ({ yMin: Number(match[1]), yMax: Number(match[2]), text: match[3] }));
    const decoded = PNG.sync.read(readFileSync(resolve(output, pageArtifact.path)), { checkCRC: true });
    const contentWidthRasterPx = contentWidthCssPx * rasterDpi / 96;
    const left = Math.round((decoded.width - contentWidthRasterPx) / 2);
    const right = Math.round(decoded.width - (decoded.width - contentWidthRasterPx) / 2 - 1);
    const middle = Math.round((left + right) / 2);
    const isDark = (x, y) => {
      if (y < 0 || y >= decoded.height) return false;
      const offset = (y * decoded.width + x) * 4;
      return decoded.data[offset] < 180 && decoded.data[offset + 1] < 180 && decoded.data[offset + 2] < 180 && decoded.data[offset + 3] > 0;
    };
    const rowCoverage = (y) => {
      let hits = 0;
      for (let x = left; x <= right; x += 1) if (isDark(x, y)) hits += 1;
      return hits / (right - left + 1);
    };
    const half = (y, from, to) => {
      let hits = 0;
      let gap = 0;
      let maximumGapPx = 0;
      for (let x = from; x <= to; x += 1) {
        if (isDark(x, y - 1) || isDark(x, y) || isDark(x, y + 1)) {
          hits += 1;
          gap = 0;
        } else {
          maximumGapPx = Math.max(maximumGapPx, ++gap);
        }
      }
      return { coverage: Math.round(hits / (to - from + 1) * 1_000) / 1_000, maximumGapPx };
    };
    const used = new Set();
    const anchors = rowIds.map((id) => {
      const word = words.find((candidate, index) => candidate.text === id && !used.has(index) && used.add(index));
      assert.ok(word, `${label}: page ${page} row ${id} has no positioned word`);
      return { id, top: Math.ceil(word.yMax * rasterDpi / 72), start: Math.floor(word.yMin * rasterDpi / 72) };
    }).sort((a, b) => a.top - b.top);
    const rows = anchors.map((anchor, index) => {
      const limit = index + 1 < anchors.length ? anchors[index + 1].start : anchor.top + 30;
      // The first raster row below the row's text that is at least half dark across the table is its
      // rule; if the rule is gone, the darkest row in the band stands in and is judged below.
      let y = anchor.top;
      while (y < limit && rowCoverage(y) < 0.5) y += 1;
      if (y >= limit) {
        let best = anchor.top;
        for (let candidate = anchor.top; candidate < limit; candidate += 1) if (rowCoverage(candidate) > rowCoverage(best)) best = candidate;
        y = best;
      }
      const leftStats = half(y, left, middle - 1);
      const rightStats = half(y, middle, right);
      assert.ok(
        leftStats.coverage >= minimumEdgeCoverage && leftStats.maximumGapPx <= maximumEdgeGapPx &&
        rightStats.coverage >= minimumEdgeCoverage && rightStats.maximumGapPx <= maximumEdgeGapPx,
        `${label}: page ${page} row ${anchor.id} rule is open (left ${leftStats.coverage}/${leftStats.maximumGapPx}px, right ${rightStats.coverage}/${rightStats.maximumGapPx}px)`,
      );
      return { ruleId: anchor.id, ruleY: y, left, right };
    });
    return { page, rows, header, caption };
  });
  const detected = pages.reduce((sum, page) => sum + page.rows.length, 0);
  assert.equal(detected, expectedRows, `${label}: coverage row text inventory drift: detected ${detected}/${expectedRows}`);
  for (const page of pages.filter((candidate) => candidate.rows.length > 0)) {
    assert.ok(page.header, `${label}: page ${page.page} carries coverage rows without the table header`);
    if (!page.caption) assert.ok(page.rows.length >= 2, `${label}: page ${page.page} continues the table with ${page.rows.length} row`);
  }
  assert.equal(reported.detectedRows, expectedRows, `${label}: renderer row inventory drift`);
  assert.equal(reported.minimumEdgeCoverage, minimumEdgeCoverage, `${label}: row rule threshold drift`);
  assert.equal(reported.maximumEdgeGapPx, maximumEdgeGapPx, `${label}: row rule gap threshold drift`);
  for (const page of pages) {
    const other = reported.pages.find((candidate) => candidate.page === page.page);
    assert.ok(other, `${label}: renderer omitted row details for page ${page.page}`);
    assert.deepEqual(other.rows.map((row) => row.ruleId), page.rows.map((row) => row.ruleId), `${label}: renderer/PDF row order drift on page ${page.page}`);
    for (const [index, row] of page.rows.entries()) {
      for (const coordinate of ["ruleY", "left", "right"]) {
        assert.ok(Math.abs(other.rows[index][coordinate] - row[coordinate]) <= 2,
          `${label}: renderer ${coordinate} of row ${row.ruleId} disagrees with the independent raster reading on page ${page.page}`);
      }
      assert.ok(other.rows[index].leftCoverage >= minimumEdgeCoverage && other.rows[index].rightCoverage >= minimumEdgeCoverage,
        `${label}: renderer reported an open row rule`);
    }
  }
  return { pagesWithRows: pages.filter((page) => page.rows.length > 0).map((page) => page.page) };
}

function independentlyCheckPageContent(pdf, raster) {
  const pdfPath = resolve(output, pdf.path);
  const pages = raster.pages.map((pageArtifact, index) => {
    const page = index + 1;
    const pageText = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    return {
      page,
      firstToken: pageText.trim().match(/^\S+/u)?.[0] ?? null,
      nonWhitespaceCharacters: pageText.replace(/\s/gu, "").length,
      ink: independentlyRasterInkBounds(resolve(output, pageArtifact.path)),
    };
  });
  const emptyNonCoverPages = pages.filter((page) => page.page > 1 && page.nonWhitespaceCharacters === 0).map((page) => page.page);
  assert.deepEqual(emptyNonCoverPages, [], `${pdf.cell}: empty non-cover page`);
  return { pages, emptyNonCoverPages };
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

/** The recorded DOM geometry of every coverage table: aligned columns, no overflowing cell. */
function assertRecordedTableGeometry(tables, label) {
  assert.ok(Array.isArray(tables) && tables.length > 0, `${label}: no coverage table geometry recorded`);
  for (const table of tables) {
    for (const column of table.columns) {
      assert.ok(column.spreadPx !== null && column.spreadPx <= 1 && column.headerDeltaPx !== null && column.headerDeltaPx <= 1 && column.bodyAlign.length === 1,
        `${label}: coverage column ${column.column} misaligned`);
    }
    assert.deepEqual(table.overflowingCells, [], `${label}: coverage cell overflows its column`);
  }
}

/**
 * The positive apparatus section is one semantic unit in print. Measured red before this gate:
 * the heading and explanation ended page 1 while the only evidence card started page 2, so the
 * printed proof was orphaned from the label that explained why it was not a failure.
 */
function independentlyCheckPositiveApparatusGrouping(pdf) {
  const pdfPath = resolve(output, pdf.path);
  const headingPages = [];
  const evidencePages = [];
  for (let page = 1; page <= pdf.pages; page += 1) {
    const text = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    if (text.includes("Measurement apparatus")) headingPages.push(page);
    if (text.includes("geometry-cross-check-passed")) evidencePages.push(page);
  }
  assert.deepEqual(headingPages, [evidencePages[0]], `${pdf.cell}: positive apparatus heading and evidence split across pages`);
  assert.deepEqual(evidencePages.length, 1, `${pdf.cell}: expected exactly one positive apparatus evidence card`);
  return { headingPage: headingPages[0], evidencePage: evidencePages[0], samePage: true };
}

/**
 * The declared font expectation, read from the source table by a separate process rather than from
 * the manifest: the renderer's own record is what is being checked.
 */
function readDeclaredFontRoles() {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
    "import { REPORT_FONT_ROLES } from './src/report/html-tokens.ts'; process.stdout.write(JSON.stringify(REPORT_FONT_ROLES));",
  ], { cwd: reviewInputRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `cannot read the declared font roles: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
const DECLARED_FONT_ROLES = readDeclaredFontRoles();

function declaredFamilies(role) {
  const families = DECLARED_FONT_ROLES[role]?.resolvesOn?.[manifest.reviewEnvironment.platform];
  assert.ok(Array.isArray(families) && families.length > 0, `no declared ${role} font expectation for platform ${manifest.reviewEnvironment.platform}`);
  return families;
}

/** A renderer font record: every role measured, and every resolved face inside its declaration. */
function assertRecordedFonts(fonts, label) {
  for (const role of ["display", "body", "mono"]) {
    assert.ok(fonts?.[role]?.probedNodes > 0, `${label}: ${role} font role was not measured`);
    const foreign = fonts[role].families.filter((family) => !declaredFamilies(role).includes(family));
    assert.deepEqual(foreign, [], `${label}: ${role} role resolved outside its declared ${DECLARED_FONT_ROLES[role].generic} faces`);
  }
}

/**
 * Independent of the DOM: which faces the PDF actually embeds. Every embedded face must belong to
 * exactly one declared role, and display, body and mono must each be present — a PDF whose headings
 * fell back to the body face embeds no display face and fails here.
 */
function classifyPdfFonts(listingText, label) {
  const listing = listingText.split("\n").slice(2).filter((line) => line.trim());
  const bases = [...new Set(listing.map((line) => line.trim().split(/\s+/u)[0].replace(/^[A-Z]{6}\+/u, "")))].sort();
  const roles = { display: [], body: [], mono: [] };
  for (const base of bases) {
    const family = base.split("-")[0];
    const owners = Object.keys(roles).filter((role) => declaredFamilies(role).some((declared) => declared.replace(/\s/gu, "") === family));
    assert.equal(owners.length, 1, `${label}: embedded font ${base} belongs to ${owners.length} declared roles`);
    roles[owners[0]].push(base);
  }
  for (const [role, faces] of Object.entries(roles)) {
    assert.ok(faces.length > 0, `${label}: the PDF embeds no declared ${role} (${DECLARED_FONT_ROLES[role].generic}) face; embedded: ${bases.join(", ")}`);
  }
  return roles;
}

let fontMutationControl = null;
function independentlyCheckPdfFonts(pdf) {
  const listing = run("pdffonts", [resolve(output, pdf.path)]);
  const roles = classifyPdfFonts(listing, pdf.cell);
  // Negative control, once: the same listing without its display faces must be rejected. A check
  // that cannot tell a collapsed PDF from a correct one is not a check.
  if (!fontMutationControl) {
    const collapsed = listing.split("\n").filter((line) => !roles.display.some((face) => line.includes(face))).join("\n");
    assert.throws(() => classifyPdfFonts(collapsed, `${pdf.cell} (font control)`), /embeds no declared display/u,
      `${pdf.cell}: removing every display face from the PDF font list did not fail the font check`);
    fontMutationControl = { cell: pdf.cell, removed: roles.display };
  }
  return roles;
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
    .update(`breaklint-stable-review-artifact-v${REVIEW_ARTIFACT_CONTRACT_VERSION}\0`)
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
  assertRecordedFonts(pdf.fonts, `print/${state}`);
  independentlyCheckPdfFonts(pdf);
  assert.equal(pdf.printSemantics.trustLabelLines, 1, `print/${state}: Coverage Trust label split across lines`);
  assert.equal(pdf.printSemantics.trustValueOverflowPx, 0, `print/${state}: Coverage Trust verdict is not fully visible inside its card`);
  assert.equal(pdf.printSemantics.trustSiblingOverlapPx, 0, `print/${state}: Coverage Trust verdict overlaps its sibling summary card`);
  assert.equal(pdf.printSemantics.horizontalOverflowPx, 0, `print/${state}: content overflows the A4 content box, so Chrome scales the printed document`);
  assertRecordedTableGeometry(pdf.printSemantics.coverageTables, `print/${state}`);
  assert.ok(pdf.printSemantics.coverageTables.every((table) => table.rowBreakInside.every((value) => ["avoid", "avoid-page"].includes(value))), `print/${state}: coverage row may fragment`);
  assert.ok(pdf.printSemantics.coverageTables.every((table) => table.heightPx <= (297 - 24) / 25.4 * 96 / 2), `print/${state}: coverage table taller than half a page`);
  const pageContent = independentlyCheckPageContent(pdf, raster);
  // Independent expectation: the canonical clean state has no finding; every other state states the
  // untested-advice caveat exactly once, however many findings it has.
  const caveatText = run("pdftotext", [resolve(output, pdf.path), "-"]).replace(/\s+/gu, " ");
  pageContent.untestedCaveatOccurrences = (caveatText.match(/no trigger\/remedied pair in this package/giu) ?? []).length;
  assert.equal(pageContent.untestedCaveatOccurrences, state === "clean" ? 0 : 1, `print/${state}: the untested-advice caveat must appear once per finding-bearing report`);
  assert.deepEqual(pdf.pageContentChecks, pageContent, `print/${state}: page content invariant drift`);
  for (const caveat of [pdf.printSemantics.remediationCaveat]) {
    assert.ok(caveat.markersInBodyTextColour && (caveat.markers === 0 || caveat.smallestMarkerToAdviceRatio >= 1), `print/${state}: untested marker below body-text salience`);
  }
  const rows = independentlyCheckCoverageRows(resolve(output, pdf.path), raster.pages, pdf.printSemantics.coverageRowCount, pdf.rowChecks, `print/${state}`);
  assert.ok(rows.pagesWithRows.length <= 2, `print/${state}: 13 coverage rows span ${rows.pagesWithRows.length} pages`);
  if (state === "clean") independentlyCheckPositiveApparatusGrouping(pdf);
  return {
    pages: pdf.pages,
    pageSize: pdf.pageSize,
    contrast: pdf.contrast,
    fonts: pdf.fonts,
    printSemantics: pdf.printSemantics,
    pageContentChecks: pdf.pageContentChecks,
    rowChecks: pdf.rowChecks,
    rasterPages: raster.pages.map((page) => ({ sha256: page.sha256, dimensions: page.dimensions })),
  };
}

function verifyProbeFiles(probe) {
  const pdfPath = resolve(output, probe.pdf.path);
  assert.equal(existsSync(pdfPath), true, `${probe.id}: probe PDF missing: ${probe.pdf.path}`);
  assert.equal(hash(pdfPath), probe.pdf.sha256, `${probe.id}: probe PDF hash drift`);
  assert.ok(probe.pdf.bytes > 1_000, `${probe.id}: probe PDF is implausibly small`);
  assert.equal(probe.pdf.pages, probe.rasterPages.length, `${probe.id}: probe PDF/raster page-count mismatch`);
  assert.match(probe.pdf.pageSize, /A4|594\.9\d* x 841\.9\d* pts/iu, `${probe.id}: probe is not A4`);
  for (const page of probe.rasterPages) {
    const path = resolve(output, page.path);
    assert.equal(existsSync(path), true, `${probe.id}: probe raster missing: ${page.path}`);
    assert.equal(hash(path), page.sha256, `${probe.id}: probe raster hash drift: ${page.path}`);
    assert.ok(page.bytes > 1_000, `${probe.id}: probe raster is implausibly small: ${page.path}`);
    const decoded = PNG.sync.read(readFileSync(path), { checkCRC: true });
    assert.deepEqual(page.dimensions, { width: decoded.width, height: decoded.height }, `${probe.id}: raster dimensions drift: ${page.path}`);
  }
  return pdfPath;
}

function verifyTechnicalProbes() {
  assert.ok(Array.isArray(manifest.technicalProbes), "technical report-surface probes are missing");
  assert.deepEqual(manifest.technicalProbes.map((probe) => probe.id).sort(),
    ["print-background-disabled/insufficient-coverage", "print-long-coverage-table/clean"], "technical probe inventory drift");
  const background = manifest.technicalProbes.find((probe) => probe.id === "print-background-disabled/insufficient-coverage");
  assert.equal(background.state, "insufficient-coverage");
  assert.equal(background.printBackground, false, "background-disabled probe was rendered with background graphics");
  assert.equal(background.coverageRowCount, 13, "background-disabled probe coverage inventory drift");
  assert.equal(background.shortCoverageRowCount, 1, "background-disabled probe must include the below-floor row");
  const backgroundPdf = verifyProbeFiles(background);
  assert.equal((run("pdftotext", ["-layout", backgroundPdf, "-"]).match(/Below floor/gu) ?? []).length, background.belowFloorWordsInText,
    "background-disabled probe: below-floor wording drift");
  assert.ok(background.belowFloorWordsInText >= 1, "background-disabled probe: the below-floor state is not carried in words");
  independentlyCheckCoverageRows(backgroundPdf, background.rasterPages, background.coverageRowCount, background.rowChecks, background.id);
  const long = manifest.technicalProbes.find((probe) => probe.id === "print-long-coverage-table/clean");
  assert.equal(long.printBackground, true);
  assert.ok(long.coverageRowCount >= 60, "long-table probe no longer carries a long table");
  const longPdf = verifyProbeFiles(long);
  const longRows = independentlyCheckCoverageRows(longPdf, long.rasterPages, long.coverageRowCount, long.rowChecks, long.id);
  assert.ok(longRows.pagesWithRows.length >= 2, "long-table probe does not continue onto a second page, so header repetition is untested");
}

function assertUtcTimestamp(value, message) {
  assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u, message);
  assert.equal(Number.isNaN(Date.parse(value)), false, message);
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

assert.equal(manifest.schemaVersion, 5, "render manifest schema drift: the verifier reads manifest schema 5");
assertUtcTimestamp(manifest.generatedAt, "render manifest generatedAt is not an exact UTC timestamp");
assertReviewEnvironment(manifest.reviewEnvironment, "current render environment");
assertObservedEnvironment(manifest.observedEnvironment, "current render environment");
const currentReviewInput = assertCurrentReviewInput(manifest.reviewInputFingerprint, reviewInputRoot, "render manifest review input");
// Both modes read the ledger structurally first: a malformed historical record is a defect in
// either mode, and a recorded FAIL is valid evidence in both.
validateReviewLedger(ledger);
verifyTechnicalProbes();
assert.deepEqual(manifest.reviewInputs, currentReviewInput.files, "render manifest input inventory does not match an independent current-worktree reconstruction");
runReviewInputMutationControl(manifest.reviewInputFingerprint, reviewInputRoot);
assert.equal(manifest.artifacts.length, 32, "the surface matrix must contain exactly 32 review cells");
assert.equal(new Set(manifest.artifacts.map((artifact) => artifact.cell)).size, 32, "duplicate render cell");

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
    assertRecordedFonts(artifact.semantics.fonts, artifact.cell);
    assertRecordedTableGeometry(artifact.semantics.coverageTables, artifact.cell);
    const caveat = artifact.semantics.remediationCaveat;
    assert.equal(caveat.statements, state === "clean" ? 0 : 1, `${artifact.cell}: untested-advice caveat count`);
    assert.ok(caveat.markersInBodyTextColour && (caveat.markers === 0 || caveat.smallestMarkerToAdviceRatio >= 1), `${artifact.cell}: untested marker below body-text salience`);
    assert.ok(artifact.dimensions.width >= 390 && artifact.dimensions.height >= 844);
    pixelMutationControl ??= runScreenPixelMutationControl(artifact, currentReviewInput);
  } else {
    assert.ok(artifact.pages >= 1);
    assert.match(artifact.pageSize, /A4|594\.9\d* x 841\.9\d* pts/iu);
    assert.ok(artifact.contrast.minimum >= 4.5, `${artifact.cell}: print contrast failed`);
  }
}
assert.ok(pixelMutationControl, "screen pixel mutation control did not run");
assert.ok(fontMutationControl, "PDF font mutation control did not run");

// The printed inventory is pinned rather than derived, so that a report which silently doubles in
// length is a failing gate and not a shrug. History: 32 page rasters; 43 in 0.6.0 when every finding
// gained a remediation box; 31 when coverage became one aligned table instead of thirteen six-label
// cards (measured per state: clean 5 -> 2, findings 12 -> 9, infrastructure 13 -> 10,
// insufficient-coverage 13 -> 10 on Chromium 141 / linux).
assert.deepEqual(manifest.physicalArtifacts, { screens: 24, pdfs: 4, rasterPages: 31 }, "the report-surface inventory must be exactly 24 screens, 4 PDFs and 31 PDF page rasters");

const latestRound = describeLatestRound(ledger, currentReviewInput.fingerprint);
// The human gate's state belongs where a release reader looks, not only in a log line.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Report-surface human review\n\n${latestRound}.\n\n`);
}
if (mode === "local") assessHumanGate(ledger, manifest, currentReviewInput.fingerprint);

if (mode === "technical") {
  process.stdout.write(
    `report surfaces: technical gate passed 32/32 current cells and ${Object.values(manifest.physicalArtifacts).reduce((sum, count) => sum + count, 0)} physical artifacts; ` +
      `no human-review claim is made; ${latestRound} ` +
      `(current inputs ${manifest.reviewInputFingerprint}; pixel and font mutations rejected)\n`,
  );
} else {
  process.stdout.write(
    `report surfaces: strict local exact-environment human gate passed 32/32 cells ` +
      `(${latestRound}; ${manifest.reviewInputFingerprint}; pixel mutation rejected)\n`,
  );
}

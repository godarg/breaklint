#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PNG } from "pngjs";

import {
  REQUIRED_BROWSER_RENDER_ARGS,
  REVIEWER_AUTHENTICATION_NOTE,
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
function independentlyCheckCoverageRows(pdfPath, rasterPages, expectedRows, reported, label, { decodedPages = new Map() } = {}) {
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
    const decoded = decodedPages.get(pageIndex) ?? PNG.sync.read(readFileSync(resolve(output, pageArtifact.path)), { checkCRC: true });
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
      // The rule id of a table row is followed on its line by the candidate count; the same id in a
      // finding head or tail label on the same page is not.
      const word = words.find((candidate, index) => candidate.text === id && !used.has(index) &&
        /^\d+$/u.test(words[index + 1]?.text ?? "") && Math.abs(words[index + 1].yMin - candidate.yMin) < 1 && used.add(index));
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
    // Under the column header there is exactly one rule before the first row's text: the header's
    // own. Collapsed borders painted the previous page's last row rule again under a repeated
    // header — two rules, the second within a few raster rows of the first.
    let headerRules = null;
    let headerRuleEndY = null;
    const headerWord = words.find((word) => word.text === "RESULT" && anchors.length > 0 && word.yMax * rasterDpi / 72 < anchors[0].start);
    // Two rules can also touch: collapsed borders painted the thin row rule through the middle of
    // the strong header rule (rows measured 14 / 114 / 14 mean red). A lighter row between two
    // darker ones inside one band counts as a second rule.
    const meanRed = (y) => {
      let sum = 0;
      for (let x = left; x <= right; x += 1) sum += decoded.data[(y * decoded.width + x) * 4];
      return sum / (right - left + 1);
    };
    if (headerWord && anchors.length > 0) {
      headerRules = 0;
      let inRule = false;
      const from = Math.ceil(headerWord.yMax * rasterDpi / 72);
      for (let y = from; y < anchors[0].start; y += 1) {
        const ruled = rowCoverage(y) >= 0.5;
        if (ruled && !inRule) headerRules += 1;
        if (ruled && inRule && rowCoverage(y + 1) >= 0.5 && meanRed(y) > meanRed(y - 1) + 40 && meanRed(y) > meanRed(y + 1) + 40) headerRules += 1;
        if (!ruled && inRule && headerRuleEndY === null) headerRuleEndY = y;
        inRule = ruled;
      }
    }
    return { page, rows, header, caption, headerRules, headerRuleEndY, firstRowStartY: anchors[0]?.start ?? null };
  });
  const { medianPitchPx, sortedPitches } = assertRowPitch(pages, label);
  if (sortedPitches.length > 0) {
    assert.ok(Math.abs(reported.medianPitchPx - medianPitchPx) <= 2, `${label}: renderer row pitch ${reported.medianPitchPx} px disagrees with the independent ${medianPitchPx} px`);
    assert.equal(reported.maximumPitchDeviation, 0.08, `${label}: row pitch threshold drift`);
  }
  for (const page of pages.filter((candidate) => candidate.headerRules !== null)) {
    assert.equal(page.headerRules, 1, `${label}: page ${page.page} shows ${page.headerRules} rules between the column header and the first row; exactly one, the header's own`);
  }
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
  return { pagesWithRows: pages.filter((page) => page.rows.length > 0).map((page) => page.page), pages };
}

/**
 * Every printed row is one line: consecutive rule positions on a page lie within 8 % of the
 * table's median pitch. A stretched continuation page does not.
 */
function assertRowPitch(pages, label) {
  const pitches = pages.flatMap((page) => page.rows.slice(1).map((row, index) => ({ page: page.page, ruleId: row.ruleId, pitchPx: row.ruleY - page.rows[index].ruleY })));
  const sortedPitches = pitches.map((pitch) => pitch.pitchPx).sort((a, b) => a - b);
  const medianPitchPx = sortedPitches[Math.floor(sortedPitches.length / 2)];
  for (const pitch of pitches) {
    assert.ok(Math.abs(pitch.pitchPx - medianPitchPx) <= 0.08 * medianPitchPx,
      `${label}: page ${pitch.page} row ${pitch.ruleId} pitch ${pitch.pitchPx} px is irregular (median ${medianPitchPx} px)`);
  }
  return { medianPitchPx, sortedPitches };
}

/**
 * Red controls for the row checks, once: the same evidence with one row rule painted out must
 * fail the rule check, and the same row positions with one row pushed down by a fifth of the
 * median pitch must fail the pitch check.
 */
function runRowSelfControls(pdfPath, rasterPages, expectedRows, reported, label, result) {
  if (verifierSelfControls.rowRule) return;
  const pageWithRows = result.pages.find((page) => page.rows.length >= 3);
  if (!pageWithRows) return;
  const row = pageWithRows.rows[1];
  const decoded = PNG.sync.read(readFileSync(resolve(output, rasterPages[pageWithRows.page - 1].path)), { checkCRC: true });
  for (let y = row.ruleY - 2; y <= row.ruleY + 2; y += 1) {
    for (let x = row.left; x <= row.right; x += 1) decoded.data.set([255, 255, 255, 255], (y * decoded.width + x) * 4);
  }
  assert.throws(() => independentlyCheckCoverageRows(pdfPath, rasterPages, expectedRows, reported, `${label} (row-rule control)`,
    { decodedPages: new Map([[pageWithRows.page - 1, decoded]]) }), new RegExp(`row ${row.ruleId.replace("/", "\\/")} rule is open`, "u"),
  `${label}: painting out the rule under ${row.ruleId} did not fail the verifier's row-rule check`);
  const shifted = structuredClone(result.pages);
  const { medianPitchPx } = assertRowPitch(result.pages, label);
  shifted.find((page) => page.page === pageWithRows.page).rows[1].ruleY += Math.ceil(medianPitchPx / 5);
  assert.throws(() => assertRowPitch(shifted, `${label} (pitch control)`), /pitch \d+ px is irregular/u,
    `${label}: a row pushed down by a fifth of the pitch did not fail the verifier's pitch check`);
  // A second rule painted just above the first row's text, under the header, must be rejected.
  const headed = result.pages.find((page) => page.headerRules === 1 && page.rows.length > 0 && page.headerRuleEndY !== null && page.firstRowStartY - page.headerRuleEndY >= 3);
  if (headed) {
    const first = headed.rows[0];
    const doubled = PNG.sync.read(readFileSync(resolve(output, rasterPages[headed.page - 1].path)), { checkCRC: true });
    const y = Math.round((headed.headerRuleEndY + headed.firstRowStartY) / 2);
    for (let x = first.left; x <= first.right; x += 1) doubled.data.set([0, 0, 0, 255], (y * doubled.width + x) * 4);
    assert.throws(() => independentlyCheckCoverageRows(pdfPath, rasterPages, expectedRows, reported, `${label} (header-rule control)`,
      { decodedPages: new Map([[headed.page - 1, doubled]]) }), /shows 2 rules between the column header and the first row/u,
    `${label}: a second rule under the column header did not fail the verifier's header-rule check`);
    // And a thin rule painted through the middle of the strong header rule, as collapsed borders did.
    const through = PNG.sync.read(readFileSync(resolve(output, rasterPages[headed.page - 1].path)), { checkCRC: true });
    for (let x = first.left; x <= first.right; x += 1) through.data.set([114, 114, 107, 255], ((headed.headerRuleEndY - 2) * through.width + x) * 4);
    assert.throws(() => independentlyCheckCoverageRows(pdfPath, rasterPages, expectedRows, reported, `${label} (touching header-rule control)`,
      { decodedPages: new Map([[headed.page - 1, through]]) }), /shows 2 rules between the column header and the first row/u,
    `${label}: a thin rule through the header rule did not fail the verifier's header-rule check`);
    verifierSelfControls.headerRule = { label, page: headed.page };
  }
  verifierSelfControls.rowRule = { label, row: row.ruleId };
  verifierSelfControls.rowPitch = { label, row: row.ruleId };
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

const MINIMUM_PAGE_FILL = 0.6;
const MAXIMUM_UNBREAKABLE_SHARE = 0.4;
const CONTENT_HEIGHT_CSS_PX = (297 - 2 * 12) / 25.4 * 96;

/**
 * Independent of the PDF text layer the renderer reads: the last raster row inside the content box
 * that carries TEXT, as a share of the content-box height. A row carries text when, inside the
 * content box inset by 8 CSS px (which leaves out the column-edge frame borders and accent bars
 * every boxed block shares), its dark pixels (luminance < 100) form at least two separate runs no
 * longer than 36 CSS px each. A horizontal rule is one long run, a vertical border or accent bar is
 * one short run, a tinted background is not dark: none of them is read as a line of text.
 */
function rasterTextDepth(source, rasterDpi) {
  const decoded = typeof source === "string" ? PNG.sync.read(readFileSync(source), { checkCRC: true }) : source;
  const cssToRaster = rasterDpi / 96;
  const marginPx = 12 / 25.4 * rasterDpi;
  const top = Math.ceil(marginPx);
  const bottom = Math.floor(decoded.height - marginPx);
  const left = Math.ceil(marginPx + 8 * cssToRaster);
  const right = Math.floor(decoded.width - marginPx - 8 * cssToRaster);
  const longestGlyphRun = 36 * cssToRaster;
  let last = top;
  for (let y = top; y < bottom; y += 1) {
    let runs = 0;
    let length = 0;
    for (let x = left; x <= right; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      const dark = x < right && 0.2126 * decoded.data[offset] + 0.7152 * decoded.data[offset + 1] + 0.0722 * decoded.data[offset + 2] < 100;
      if (dark) {
        length += 1;
      } else if (length > 0) {
        if (length <= longestGlyphRun) runs += 1;
        length = 0;
      }
    }
    if (runs >= 2) last = y + 1;
  }
  return Math.round((last - top) / (bottom - top) * 1_000) / 1_000;
}

/** The first line of each section's first unit, as documented, per section heading. */
const SECTION_FIRST_UNITS = {
  "Run summary": /^COVERAGE TRUST\b/u,
  "Measurement apparatus": /^These non-fatal diagnostics/u,
  "Checker failure": /^This is not a clean run\./u,
  "Coverage did not meet the contract": /^This is not a clean run\./u,
  Findings: /^(?:\d+ measured findings?|0 findings\.|Partial findings only:)/u,
  "Coverage details": /^Coverage is reported for every rule/u,
};

/**
 * Independent of the renderer's recorded keeps: every documented section heading shares its page
 * with the first line of its first unit, and every coverage caption with the table's first row.
 * Section headings follow the banner: the h1 may wrap so that its first line reads "Findings".
 */
function assertSectionKeeps(lines, label) {
  let inBody = false;
  let checked = 0;
  for (const [pageIndex, pageLines] of lines.entries()) {
    for (const [lineIndex, line] of pageLines.entries()) {
      inBody ||= line === "Run summary";
      const unit = inBody ? SECTION_FIRST_UNITS[line] : undefined;
      if (unit) {
        checked += 1;
        assert.ok(pageLines.slice(lineIndex + 1).some((candidate) => unit.test(candidate)), `${label}: section heading "${line}" is stranded on page ${pageIndex + 1}`);
      }
      if (/Document verdict:/u.test(line)) {
        checked += 1;
        assert.ok(pageLines.slice(lineIndex + 1).some((candidate) => COVERAGE_ROW_LINE.test(candidate)), `${label}: coverage caption is stranded on page ${pageIndex + 1}`);
      }
    }
  }
  assert.ok(checked >= 4, `${label}: only ${checked} section openings were found to check`);
}

/**
 * The verifier's own red controls. Each independent check above is also run once on a copy of
 * real evidence that has been broken in exactly the way the check exists for, and must reject it;
 * a check that accepts the broken copy is not a check (the same reasoning as the pixel and font
 * controls). They run on the first printed state whose evidence allows them.
 */
const verifierSelfControls = {};
/** Every non-final page's text reaches MINIMUM_PAGE_FILL unless a declared forced break follows it. */
function assertPageFill(fill, label) {
  for (const page of fill) {
    assert.ok(page.final || page.forcedBreakFollows || page.contentDepth >= MINIMUM_PAGE_FILL,
      `${label}: page ${page.page} content text depth ${(page.contentDepth * 100).toFixed(1)} % is below ${MINIMUM_PAGE_FILL * 100} %`);
  }
}

/** A page that opens inside a finding opens at its labelled tail, never on a bare fact or tail line. */
const BARE_FINDING_CONTINUATION = /^(?:(?:DOCUMENT|SOURCE|MEASURED|THRESHOLD|CALIBRATION|PROOF SOURCE)\b|Remediation\b|Note:|Evidence:|Ambiguity:)/u;
function assertLabelledContinuations(lines, label) {
  for (const [pageIndex, pageLines] of lines.entries()) {
    if (pageIndex === 0) continue;
    assert.ok(!BARE_FINDING_CONTINUATION.test(pageLines[0] ?? ""),
      `${label}: page ${pageIndex + 1} starts inside a finding without its label: ${JSON.stringify(pageLines[0])}`);
  }
}

function runVerifierSelfControlsOnce(lines, rasterPages, label, fill) {
  const rasterDpi = manifest.reviewEnvironment.print.rasterDpi;
  // Fill application: a non-final page below the bound, with no forced break after it, must fail.
  if (!verifierSelfControls.fillApplication && fill.length > 1) {
    const broken = structuredClone(fill);
    Object.assign(broken[0], { contentDepth: MINIMUM_PAGE_FILL - 0.05, final: false, forcedBreakFollows: false });
    assert.throws(() => assertPageFill(broken, `${label} (fill-application control)`), /page 1 content text depth 55\.0 % is below 60 %/u,
      `${label}: a page at 55 % text depth did not fail the verifier's fill check`);
    verifierSelfControls.fillApplication = { label };
  }
  // Bare continuation: page 2 opening on a bare remediation line must fail.
  if (!verifierSelfControls.bareContinuation && lines.length > 1) {
    const broken = structuredClone(lines);
    broken[1] = ["Remediation untested A block fragments across a page break.", ...broken[1]];
    assert.throws(() => assertLabelledContinuations(broken, `${label} (continuation control)`), /page 2 starts inside a finding without its label/u,
      `${label}: a page opening on a bare remediation line did not fail the verifier's continuation check`);
    verifierSelfControls.bareContinuation = { label };
  }
  // Stranded heading: move everything after the "Findings" heading to the next page.
  if (!verifierSelfControls.strandedHeading) {
    const pageIndex = lines.findIndex((pageLines, index) => index + 1 < lines.length && pageLines.includes("Findings") &&
      lines.slice(0, index + 1).flat().includes("Run summary"));
    if (pageIndex >= 0) {
      const broken = structuredClone(lines);
      const at = broken[pageIndex].lastIndexOf("Findings");
      broken[pageIndex + 1] = [...broken[pageIndex].splice(at + 1), ...broken[pageIndex + 1]];
      assert.throws(() => assertSectionKeeps(broken, `${label} (stranded-heading control)`), /section heading "Findings" is stranded/u,
        `${label}: moving the findings lead to the next page did not fail the verifier's keep check`);
      verifierSelfControls.strandedHeading = { label, page: pageIndex + 1 };
    }
  }
  // Fill: keep the top 45 % of a page's content box and replace the rest with what an empty cloned
  // frame and a box inside it leave: a tinted background, a dark border on both column edges, a
  // 4 px accent bar inside the frame and a rule in two long segments. Ink reaches the bottom; the text reading
  // must not (each part defeats one simplification: no inset, one run is text, no run limit).
  if (!verifierSelfControls.fill && rasterPages.length > 1) {
    const decoded = PNG.sync.read(readFileSync(resolve(output, rasterPages[0].path)), { checkCRC: true });
    const marginPx = 12 / 25.4 * rasterDpi;
    const top = Math.ceil(marginPx);
    const bottom = Math.floor(decoded.height - marginPx);
    const cut = Math.round(top + 0.45 * (bottom - top));
    const left = Math.ceil(marginPx);
    const right = Math.floor(decoded.width - marginPx) - 1;
    for (let y = cut; y < bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const offset = (y * decoded.width + x) * 4;
        const border = x - left < 2 || right - x < 2;
        const accent = x - left >= 18 && x - left < 22;
        // Two long segments with a column gap between them, as a rule under a two-column grid.
        const rule = y === bottom - 20 && x - left >= 30 && right - x >= 30 && Math.abs(x - (left + right) / 2) >= 10;
        decoded.data.set(border || accent || rule ? [14, 14, 15, 255] : [239, 239, 232, 255], offset);
      }
    }
    const depth = rasterTextDepth(decoded, rasterDpi);
    assert.ok(depth < MINIMUM_PAGE_FILL, `${label}: an empty cloned frame below 45 % of the page read as text to ${(depth * 100).toFixed(1)} %`);
    verifierSelfControls.fill = { label, textDepth: depth };
  }
}

/**
 * Independent of the renderer's DOM: fill is re-measured from each raster's content box, and a
 * short page is exempt only when the next page's first content line begins with a forced break the
 * renderer recorded; every documented section heading must share its page with the first line of its
 * first unit, and every coverage caption with the table's first row.
 */
function independentlyCheckPageFlow(pdfPath, rasterPages, recorded, label) {
  const lines = rasterPages.map((_, index) => run("pdftotext", ["-f", String(index + 1), "-l", String(index + 1), "-layout", pdfPath, "-"])
    .split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).filter(Boolean)
    .filter((line) => !/^Page \d+ of \d+$/u.test(line) && !(index > 0 && /^breaklint · /u.test(line))));
  const rasterDpi = manifest.reviewEnvironment.print.rasterDpi;
  const fill = rasterPages.map((pageArtifact, index) => {
    const depth = rasterTextDepth(resolve(output, pageArtifact.path), rasterDpi);
    // Past a repeated coverage header: a forced break inside a continued table lands on the row after it.
    const nextFirst = (lines[index + 1] ?? []).find((line) => !/^RULE\b.*\bRESULT$/u.test(line)) ?? "";
    const exempt = recorded.forcedBreaks.some((text) => text.length > 0 && nextFirst.startsWith(text.slice(0, 16)));
    const final = index === rasterPages.length - 1;
    return { page: index + 1, contentDepth: depth, final, forcedBreakFollows: exempt };
  });
  assertPageFill(fill, label);
  assertLabelledContinuations(lines, label);
  assertSectionKeeps(lines, label);
  runVerifierSelfControlsOnce(lines, rasterPages, label, fill);
  assert.equal(recorded.minimumPageFill, MINIMUM_PAGE_FILL, `${label}: page fill threshold drift`);
  for (const page of fill) {
    const other = recorded.fill.find((candidate) => candidate.page === page.page);
    // The PDF text layer's line box reaches the font's descent; the raster reaches the lowest
    // glyph ink. Measured apart by at most 0.5 % of the content box; 1 % is the tolerance.
    assert.ok(other && Math.abs(other.contentDepth - page.contentDepth) <= 0.01,
      `${label}: renderer text depth of page ${page.page} (${other?.contentDepth}) disagrees with the independent raster text reading (${page.contentDepth})`);
  }
  assert.equal(recorded.maximumUnbreakableShare, MAXIMUM_UNBREAKABLE_SHARE, `${label}: unbreakable-unit bound drift`);
  assert.ok(typeof recorded.largestUnbreakableUnit === "string" && recorded.largestUnbreakableUnit.length > 0, `${label}: the tallest unbreakable unit is not named`);
  assert.ok(recorded.largestUnbreakableUnitPx > 0 && recorded.largestUnbreakableUnitPx <= MAXIMUM_UNBREAKABLE_SHARE * CONTENT_HEIGHT_CSS_PX,
    `${label}: the tallest unbreakable unit, ${recorded.largestUnbreakableUnit}, is ${recorded.largestUnbreakableUnitPx} px, over ${MAXIMUM_UNBREAKABLE_SHARE * 100} % of the content box`);
  assert.ok(recorded.keeps.length >= 4 && recorded.keeps.every((keep) => keep.headingPage !== null && keep.headingPage === keep.unitPage), `${label}: renderer recorded a stranded heading`);
  return fill;
}

/** Recorded boxed-block geometry: one left edge, one right edge, and a real gap between blocks. */
function assertRecordedBoxedBlocks(boxes, label) {
  assert.ok(boxes.blocks >= 6, `${label}: boxed-block inventory is implausibly small`);
  assert.ok(boxes.leftSpreadPx <= 1 && boxes.rightSpreadPx <= 1, `${label}: boxed blocks do not share the column's edges`);
  assert.ok(boxes.smallestGap === null || boxes.smallestGap.gapPx >= 8, `${label}: boxed blocks abut`);
}

/** The verdict headings docs/reporting.md defines, and their exit codes: the running head's text. */
const STATE_HEADINGS = {
  clean: ["Clean run", 0],
  findings: ["Findings block this run", 1],
  infrastructure: ["Checker failed", 3],
  "insufficient-coverage": ["Not enough was measured", 4],
};

/**
 * Independent of the renderer's expectation: the run id is read from page 1's tool line, the title
 * and exit code from the documented verdict table; every page must carry its folio, every page from
 * 2 the running head, and only the final page the end mark, with report content beside it.
 */
function independentlyCheckPageFurniture(pdfPath, pageCount, state, label) {
  const firstPage = run("pdftotext", ["-f", "1", "-l", "1", "-layout", pdfPath, "-"]);
  const runId = /· run (\S+)/u.exec(firstPage)?.[1];
  assert.ok(runId, `${label}: page 1 does not show the run id`);
  const [title, exitCode] = STATE_HEADINGS[state];
  const expected = { runningHead: `breaklint · ${title} · exit ${exitCode}`, runLabel: `run ${runId}` };
  const pages = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const text = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    const normalized = text.replace(/[ \t]+/gu, " ");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    pages.push({
      page,
      folio: normalized.includes(`Page ${page} of ${pageCount}`),
      runningHead: normalized.includes(expected.runningHead) && normalized.includes(expected.runLabel),
      endMark: normalized.includes("End of report."),
      contentLines: lines.filter((line) => !(line.includes(`Page ${page} of ${pageCount}`) || line.includes(expected.runningHead) || line.includes(expected.runLabel)) &&
        !/End of report|JSON remains the canonical report|^Generated by/u.test(line)).length,
    });
  }
  for (const page of pages) {
    assert.ok(page.folio, `${label}: page ${page.page} lacks "Page ${page.page} of ${pageCount}"`);
    if (page.page >= 2) assert.ok(page.runningHead, `${label}: page ${page.page} lacks the running head`);
    assert.equal(page.endMark, page.page === pageCount, `${label}: the end mark belongs on the final page only (page ${page.page})`);
  }
  assert.ok(pages.at(-1).contentLines > 0, `${label}: the final page carries nothing but the end mark`);
  return { expected, pages };
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

/**
 * The 40 % unit bound, measured again here with a different formulation from the renderer's. The
 * renderer builds chains of units; this finds the BREAK OPPORTUNITIES instead: every boundary
 * between two adjacent in-flow block siblings anywhere in the print layout, allowed unless a
 * computed break-after/break-before of avoid sits on either side of it (on the element or down its
 * last/first-child edge), an ancestor has break-inside: avoid, or the two share a grid or flex row.
 * The tallest stretch between consecutive allowed breaks — from the top of the box after one break
 * to the bottom of the box before the next — is what the browser must move whole. It runs in its
 * own browser process over the canonical states' HTML, at the A4 content width in print media,
 * with the declared deterministic launch arguments.
 */
function independentlyMeasureBreakRuns(extraCss = "") {
  const directory = mkdtempSync(resolve(tmpdir(), "breaklint-break-runs-"));
  try {
    const script = resolve(directory, "break-runs.mjs");
    const root = pathToFileURL(`${reviewInputRoot}/`).href;
    writeFileSync(script, `
import puppeteer from ${JSON.stringify(pathToFileURL(createRequire(resolve(reviewInputRoot, "package.json")).resolve("puppeteer-core")).href)};
import { resolveBrowser } from ${JSON.stringify(new URL("src/acquire/browser.ts", root).href)};
import { render } from ${JSON.stringify(new URL("src/report/index.ts", root).href)};
import { canonicalReportStates } from ${JSON.stringify(new URL("tests/fixtures/report-states.ts", root).href)};
const browser = await puppeteer.launch({ executablePath: resolveBrowser().path, headless: true, args: ${JSON.stringify(REQUIRED_BROWSER_RENDER_ARGS)} });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 703, height: 1123, deviceScaleFactor: 1 });
  const result = {};
  for (const [state, report] of Object.entries(canonicalReportStates())) {
    await page.setContent(render(report, "html"), { waitUntil: "load" });
    await page.emulateMediaType("print");
    if (process.argv[2]) await page.addStyleTag({ content: process.argv[2] });
    await page.evaluate(() => document.fonts.ready);
    result[state] = await page.evaluate(() => {
      const avoid = (value) => value === "avoid" || value === "avoid-page";
      const style = (element) => getComputedStyle(element);
      const inFlowBlock = (element) => {
        const s = style(element);
        return s.display !== "none" && !s.display.startsWith("inline") && s.display !== "contents" &&
          s.position !== "absolute" && s.position !== "fixed" && s.float === "none" && element.getClientRects().length > 0;
      };
      const edgeAvoids = (element, property, child) => {
        for (let node = element; node; node = node[child]) if (avoid(style(node)[property])) return true;
        return false;
      };
      const breaks = [];
      for (const parent of document.querySelectorAll("body, body *")) {
        const children = [...parent.children].filter(inFlowBlock);
        for (let index = 1; index < children.length; index += 1) {
          const before = children[index - 1], after = children[index];
          const a = before.getBoundingClientRect(), b = after.getBoundingClientRect();
          if (Math.abs(a.top - b.top) < 1 && ["grid", "flex", "inline-grid", "inline-flex"].includes(style(parent).display)) continue;
          if (edgeAvoids(before, "breakAfter", "lastElementChild") || edgeAvoids(after, "breakBefore", "firstElementChild")) continue;
          let inside = false;
          for (let node = parent; node && node !== document.documentElement; node = node.parentElement) if (avoid(style(node).breakInside)) inside = true;
          if (inside) continue;
          breaks.push({ endY: a.bottom, startY: b.top, after: (after.className || after.tagName).toString().slice(0, 40) });
        }
      }
      breaks.sort((x, y) => x.startY - y.startY);
      const flow = [...document.body.querySelectorAll("*")].filter(inFlowBlock).map((element) => element.getBoundingClientRect());
      const first = Math.min(...flow.map((rect) => rect.top));
      const last = Math.max(...flow.map((rect) => rect.bottom));
      let best = { px: 0, from: "document start", to: null };
      let start = first, from = "document start";
      for (const entry of [...breaks, { endY: last, startY: Infinity, after: "document end" }]) {
        const px = entry.endY - start;
        if (px > best.px) best = { px: Math.round(px * 100) / 100, from, to: entry.after };
        if (entry.startY !== Infinity && entry.startY > start) { start = entry.startY; from = entry.after; }
      }
      return best;
    });
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await browser.close();
}
`);
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, ...(extraCss ? [extraCss] : [])], { cwd: reviewInputRoot, encoding: "utf8", env: process.env, timeout: 300_000 });
    assert.equal(child.status, 0, `independent break-run measurement failed: ${child.stderr}${child.stdout}`);
    return JSON.parse(child.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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

/**
 * Tablet and mobile cells ship viewport-height tiles. Each is re-cut here from the independently
 * decoded full page and must match byte for byte in normalized RGBA: a tile can add no pixel the
 * fingerprinted full page does not already bind.
 */
function independentlyCheckTiles(artifact, decodedFullPage, tilePath = (tile) => resolve(output, tile.path)) {
  const viewport = artifact.cell.split("/")[3];
  const viewportHeight = manifest.reviewEnvironment.viewports[viewport].height;
  const expected = viewport === "desktop" ? 0 : Math.ceil(artifact.dimensions.height / viewportHeight);
  assert.equal(artifact.tiles.length, expected, `${artifact.cell}: expected ${expected} viewport-height tiles`);
  const width = decodedFullPage.decoded.width;
  for (const [index, tile] of artifact.tiles.entries()) {
    const top = index * viewportHeight;
    const height = Math.min(viewportHeight, artifact.dimensions.height - top);
    assert.equal(tile.top, top, `${artifact.cell}: tile ${index + 1} offset drift`);
    assert.equal(tile.height, height, `${artifact.cell}: tile ${index + 1} height drift`);
    const path = tilePath(tile);
    assert.equal(existsSync(path), true, `${artifact.cell}: missing tile ${tile.path}`);
    assert.equal(hash(path), tile.sha256, `${artifact.cell}: tile hash drift ${tile.path}`);
    const recut = createHash("sha256").update(decodedFullPage.rgba.subarray(top * width * 4, (top + height) * width * 4)).digest("hex");
    const tilePixels = independentlyNormalizeScreenPixels(readFileSync(path));
    assert.equal(tilePixels.contract.width, width, `${artifact.cell}: tile ${index + 1} width drift`);
    assert.equal(tilePixels.contract.normalizedRgbaSha256, recut, `${artifact.cell}: tile ${index + 1} is not a crop of the fingerprinted full page`);
    assert.equal(tile.normalizedRgbaSha256, recut, `${artifact.cell}: tile ${index + 1} manifest hash drift`);
  }
}

/**
 * Red control for the tile re-cut, once: one visible pixel of one tile changes, and the manifest
 * entry is rewritten to that tile's new hashes, exactly as an edited tile with a doctored manifest
 * would look (the verifier's round-2 experiment). Only the re-cut from the full page can see it.
 */
let tileMutationControl = null;
function runTileMutationControl(artifact, decodedFullPage) {
  if (tileMutationControl || artifact.tiles.length < 2) return;
  const index = Math.min(5, artifact.tiles.length - 1);
  const tile = artifact.tiles[index];
  const decoded = PNG.sync.read(readFileSync(resolve(output, tile.path)), { checkCRC: true });
  let offset = 0;
  while (offset < decoded.data.length && decoded.data[offset + 3] === 0) offset += 4;
  decoded.data[offset] = decoded.data[offset] === 0 ? 1 : decoded.data[offset] - 1;
  const bytes = PNG.sync.write(decoded);
  const directory = mkdtempSync(resolve(tmpdir(), "breaklint-tile-control-"));
  try {
    const mutatedPath = resolve(directory, "tile.png");
    writeFileSync(mutatedPath, bytes);
    const doctored = structuredClone(artifact);
    doctored.tiles[index].sha256 = createHash("sha256").update(bytes).digest("hex");
    doctored.tiles[index].normalizedRgbaSha256 = independentlyNormalizeScreenPixels(bytes).contract.normalizedRgbaSha256;
    assert.throws(
      () => independentlyCheckTiles(doctored, decodedFullPage, (candidate) => (candidate.path === tile.path ? mutatedPath : resolve(output, candidate.path))),
      new RegExp(`tile ${index + 1} is not a crop of the fingerprinted full page`, "u"),
      `${artifact.cell}: a one-channel edit of tile ${index + 1} with a rewritten manifest hash passed the re-cut check`,
    );
    tileMutationControl = { cell: artifact.cell, tile: index + 1 };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * A recorded path's lines, re-judged here: every break follows a slash or falls strictly inside a
 * segment whose recorded unbroken width exceeds the recorded line width. The segments must spell
 * the path, and each segment's over-long flag must follow from its two recorded widths.
 */
function assertRecordedPathBreaks(identifier, label) {
  assert.equal(identifier.lines.join(""), identifier.text, `${label}: path lines do not spell ${identifier.text}`);
  assert.equal(identifier.segments.map((segment) => segment.text).join(""), identifier.text, `${label}: path segments do not spell ${identifier.text}`);
  for (const segment of identifier.segments) {
    assert.equal(segment.overLong, segment.maxContentPx > identifier.containerPx + 0.5, `${label}: over-long flag of path segment ${segment.text} contradicts its widths`);
  }
  let offset = 0;
  for (const line of identifier.lines.slice(0, -1)) {
    offset += line.length;
    if (line.endsWith("/")) continue;
    let start = 0;
    const inside = identifier.segments.find((segment) => {
      const end = start + segment.text.length;
      const hit = offset > start && offset < end;
      start = end;
      return hit;
    });
    assert.ok(inside?.overLong, `${label}: path ${identifier.text} breaks after "${line}", neither after a slash nor inside an over-long segment`);
  }
}

/** The recorded accessibility contract of a screen cell. */
function assertRecordedAccessibility(accessibility, label) {
  const roles = (wanted) => accessibility.landmarks.filter((landmark) => landmark.role === wanted);
  for (const wanted of ["banner", "main", "contentinfo"]) assert.equal(roles(wanted).length, 1, `${label}: expected one ${wanted} landmark`);
  assert.deepEqual(roles("navigation").map((landmark) => landmark.name), ["Report contents"], `${label}: navigation landmark missing`);
  assert.ok(accessibility.links.length >= 3 && accessibility.links.every((link) => ["h1", "h2", "h3", "main", "section"].includes(link.target ?? "")), `${label}: an in-page link has no target`);
  assert.equal(accessibility.tableRoles.rowheader, accessibility.coverageRows, `${label}: coverage table row headers lost`);
  assert.match(accessibility.firstTabStop.element, /skip-link/u, `${label}: first Tab stop is not the skip link`);
  assert.ok(accessibility.firstTabStop.outlineWidthPx >= 2 && accessibility.firstTabStop.outlineStyle !== "none", `${label}: focus outline below 2 px`);
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
  // Commands and rule ids in the PDF text: none split, and the one canonical command whole.
  const expectedFlags = state === "insufficient-coverage" ? ["--disable layout/widow"] : [];
  const layoutLines = run("pdftotext", ["-layout", resolve(output, pdf.path), "-"]).split("\n");
  pageContent.identifierBreaks = {
    linesEndingInsideAFlag: layoutLines.filter((line) => /(?:^|\s)--(?:[a-z-]*)?\s*$/u.test(line)).length,
    linesEndingInsideARuleId: layoutLines.filter((line) => /\b(?:layout|svg|type|artifact)\/(?:[a-z0-9-]*-)?\s*$/u.test(line)).length,
    flagsWhole: expectedFlags.map((flag) => ({ flag, whole: layoutLines.some((line) => line.includes(flag)) })),
  };
  assert.equal(pageContent.identifierBreaks.linesEndingInsideAFlag, 0, `print/${state}: a PDF line ends inside a command flag`);
  assert.equal(pageContent.identifierBreaks.linesEndingInsideARuleId, 0, `print/${state}: a PDF line ends inside a rule id`);
  assert.ok(pageContent.identifierBreaks.flagsWhole.every((flag) => flag.whole), `print/${state}: a command is not whole on one PDF line`);
  assert.ok(pdf.printSemantics.identifiers.every((identifier) => identifier.kind === "path" || identifier.lines.length === 1), `print/${state}: an identifier is split in the print layout`);
  for (const identifier of pdf.printSemantics.identifiers.filter((candidate) => candidate.kind === "path")) assertRecordedPathBreaks(identifier, `print/${state}`);
  pageContent.furniture = independentlyCheckPageFurniture(resolve(output, pdf.path), pdf.pages, state, `print/${state}`);
  assert.ok(pdf.pageContentChecks.flow, `print/${state}: renderer recorded no page-flow checks`);
  independentlyCheckPageFlow(resolve(output, pdf.path), raster.pages, pdf.pageContentChecks.flow, `print/${state}`);
  pageContent.flow = pdf.pageContentChecks.flow;
  assertRecordedBoxedBlocks(pdf.printSemantics.boxedBlocks, `print/${state}`);
  if (state === "clean") {
    const text = run("pdftotext", ["-layout", resolve(output, pdf.path), "-"]).replace(/\s+/gu, " ");
    pageContent.cleanFindingsStatement = { heading: /\bFindings\b/u.test(text.replace(/Findings \(0\)/gu, "")), zeroFindings: text.includes("0 findings") };
    assert.ok(pageContent.cleanFindingsStatement.heading && pageContent.cleanFindingsStatement.zeroFindings, `print/clean: the printed clean report lacks its findings heading or "0 findings"`);
  }
  assert.deepEqual(pdf.pageContentChecks, pageContent, `print/${state}: page content invariant drift`);
  for (const caveat of [pdf.printSemantics.remediationCaveat]) {
    assert.ok(caveat.markersInBodyTextColour && (caveat.markers === 0 || caveat.smallestMarkerToAdviceRatio >= 1), `print/${state}: untested marker below body-text salience`);
  }
  const rows = independentlyCheckCoverageRows(resolve(output, pdf.path), raster.pages, pdf.printSemantics.coverageRowCount, pdf.rowChecks, `print/${state}`);
  runRowSelfControls(resolve(output, pdf.path), raster.pages, pdf.printSemantics.coverageRowCount, pdf.rowChecks, `print/${state}`, rows);
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
    ["print-background-disabled/insufficient-coverage", "print-hostile-run-id/clean", "print-long-coverage-table/clean", "print-long-document-path/findings"], "technical probe inventory drift");
  // A long document path must wrap, not widen the print: Chrome scales the whole PDF to fit wider
  // content. Independent of the DOM: every word's height in the probe PDF equals the same word's in
  // the canonical findings PDF, which a scaled print cannot satisfy (98.3 % shrinks a 20 pt line
  // by 0.34 pt); and the path's own words stay inside the A4 content box.
  const longPath = manifest.technicalProbes.find((probe) => probe.id === "print-long-document-path/findings");
  assert.equal(longPath.horizontalOverflowPx, 0, "long document path: print content overflows the A4 content box");
  for (const identifier of longPath.pathLines) assertRecordedPathBreaks(identifier, "print/long document path");
  assert.ok(longPath.pathLines.length >= 1 && longPath.pathLines.some((identifier) => identifier.lines.length >= 2), "long document path probe no longer wraps a path");
  const longPathPdf = verifyProbeFiles(longPath);
  const canonicalFindingsPdf = resolve(output, manifest.artifacts.find((artifact) => artifact.cell === "print/findings/pdf").path);
  const wordHeights = (pdfPath) => {
    const xml = run("pdftotext", ["-f", "1", "-l", "1", "-bbox-layout", pdfPath, "-"]);
    const [, width, height] = /<page width="([\d.]+)" height="([\d.]+)"/u.exec(xml).map(Number);
    const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/gu)]
      .map((match) => ({ xMax: Number(match[3]), yMin: Number(match[2]), yMax: Number(match[4]), height: Number(match[4]) - Number(match[2]), text: match[5] }));
    return { width, height, words };
  };
  const probeWords = wordHeights(longPathPdf);
  const canonicalWords = wordHeights(canonicalFindingsPdf);
  const assertSameScale = (probe, canonical, label) => {
    for (const text of ["Findings", "block", "Run", "summary"]) {
      const a = probe.words.find((word) => word.text === text);
      const b = canonical.words.find((word) => word.text === text);
      assert.ok(a && b && Math.abs(a.height - b.height) <= 0.05, `${label}: "${text}" prints at ${a?.height} pt, not ${b?.height} pt as in the canonical PDF; the page was scaled`);
    }
  };
  assertSameScale(probeWords, canonicalWords, "long document path");
  // Red control: the same words at the 98.3 % the trailing caption margin produced must fail.
  const scaled = { ...probeWords, words: probeWords.words.map((word) => ({ ...word, height: word.height * 0.983 })) };
  assert.throws(() => assertSameScale(scaled, canonicalWords, "long document path (scale control)"), /the page was scaled/u,
    "long document path: a page printed at 98.3 % did not fail the verifier's scale check");
  // Page furniture lives in the margin boxes; only the content box's words are compared. A glyph
  // box may overshoot the content edge by a fraction of a point (the canonical run-facts hash
  // reaches 561.57 pt against a 560.94 pt edge), so the bound is the canonical page's own widest word.
  const marginPt = 12 / 25.4 * 72;
  const contentWords = (words) => words.words.filter((word) => word.yMin >= marginPt && word.yMax <= words.height - marginPt);
  const canonicalRight = Math.max(...contentWords(canonicalWords).map((word) => word.xMax));
  const probeRight = Math.max(...contentWords(probeWords).map((word) => word.xMax));
  assert.ok(canonicalRight <= probeWords.width - marginPt + 1, "canonical findings PDF prints past the A4 content box");
  assert.ok(probeRight <= canonicalRight + 0.5, `long document path: page 1 content reaches ${probeRight} pt, past the canonical ${canonicalRight} pt`);
  const hostile = manifest.technicalProbes.find((probe) => probe.id === "print-hostile-run-id/clean");
  assert.match(hostile.runId, /";.*\}.*<\/style>/u, "hostile run-id probe no longer carries a hostile run id");
  const hostilePdf = verifyProbeFiles(hostile);
  const cleanPdf = manifest.artifacts.find((artifact) => artifact.cell === "print/clean/pdf");
  assert.equal(hostile.pdf.pages, cleanPdf.pages, "hostile run id changed the report's pagination");
  assert.match(run("pdftotext", ["-f", "1", "-l", "1", "-layout", hostilePdf, "-"]), /Clean run/u, "hostile run id blanked the report");
  const hostileHead = run("pdftotext", ["-f", "2", "-l", "2", "-layout", hostilePdf, "-"]);
  assert.ok(hostileHead.includes(`run ${hostile.runId.slice(0, 40)}`), "hostile run id does not print as literal text in the running head");
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
    independentlyCheckTiles(artifact, independentlyDecoded);
    runTileMutationControl(artifact, independentlyDecoded);
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
    assertRecordedAccessibility(artifact.semantics.accessibility, artifact.cell);
    assertRecordedBoxedBlocks(artifact.semantics.boxedBlocks, artifact.cell);
    for (const identifier of artifact.semantics.identifiers) {
      if (identifier.kind === "path") assertRecordedPathBreaks(identifier, artifact.cell);
      else assert.ok(identifier.lines.length === 1 || (identifier.lines.length === 2 && identifier.lines[0].endsWith("/")), `${artifact.cell}: an identifier breaks outside its namespace slash`);
    }
    assert.ok(artifact.semantics.identifiers.some((identifier) => identifier.kind === "path"), `${artifact.cell}: no path was measured`);
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
const breakRunLimitPx = MAXIMUM_UNBREAKABLE_SHARE * CONTENT_HEIGHT_CSS_PX;
function assertBreakRuns(runs, label) {
  for (const pdf of manifest.artifacts.filter((artifact) => artifact.kind === "pdf")) {
    const state = pdf.cell.split("/")[1];
    const own = runs[state];
    const recorded = pdf.pageContentChecks.flow;
    assert.ok(own && own.px > 0 && own.px <= breakRunLimitPx,
      `${label}/${state}: the tallest stretch between allowed breaks, measured independently, is ${own?.px} px (from ${own?.from} to ${own?.to}), over ${MAXIMUM_UNBREAKABLE_SHARE * 100} % of the content box`);
    // The stretch between two allowed breaks contains every chain the renderer can form, so the
    // renderer's tallest unit cannot exceed it; a larger renderer figure means one of the two is wrong.
    assert.ok(recorded.largestUnbreakableUnitPx <= own.px + 1,
      `${label}/${state}: the renderer's tallest unit (${recorded.largestUnbreakableUnitPx} px) exceeds the independent break-to-break stretch (${own.px} px)`);
  }
}
const breakRuns = independentlyMeasureBreakRuns();
assertBreakRuns(breakRuns, "print");
// Red control, once: every fact keeps with the next unit, so head, facts and tail become one run
// the height of a finding. The independent measurement must reject it.
assert.throws(() => assertBreakRuns(independentlyMeasureBreakRuns(".finding-facts > div, .finding-facts { break-after: avoid !important; }"), "break-run control"),
  /break-run control\/[a-z-]+: the tallest stretch between allowed breaks, measured independently, is \d+(?:\.\d+)? px/u,
  "gluing every fact to the next unit did not fail the independent break-run measurement");
verifierSelfControls.breakRuns = Object.fromEntries(Object.entries(breakRuns).map(([state, run]) => [state, run.px]));
{
  // The gallery is what a reviewer opens: it must present every screen, tile and printed page.
  const galleryPath = resolve(output, manifest.reviewGallery ?? "");
  assert.equal(existsSync(galleryPath), true, "review gallery missing");
  const gallery = readFileSync(galleryPath, "utf8");
  const presented = manifest.artifacts.flatMap((artifact) => artifact.kind === "screen"
    ? [artifact.path, ...artifact.tiles.map((tile) => tile.path)]
    : artifact.kind === "raster-set" ? artifact.pages.map((page) => page.path) : [artifact.path]);
  const galleryOmissions = (html) => presented.filter((path) => !html.includes(`"${path}"`));
  assert.deepEqual(galleryOmissions(gallery), [], "review gallery omits artifacts");
  // Red control: the same gallery without one tile must be rejected, naming that tile.
  const droppedTile = manifest.artifacts.find((artifact) => artifact.kind === "screen" && artifact.tiles.length > 0).tiles.at(-1).path;
  assert.deepEqual(galleryOmissions(gallery.replaceAll(`"${droppedTile}"`, `""`)), [droppedTile],
    `review gallery completeness control: dropping ${droppedTile} was not detected`);
  verifierSelfControls.gallery = { dropped: droppedTile };
}
assert.ok(tileMutationControl, "tile re-cut mutation control did not run");
assert.ok(verifierSelfControls.strandedHeading, "verifier stranded-heading control did not run");
assert.ok(verifierSelfControls.fill, "verifier text-depth control did not run");
for (const control of ["rowRule", "rowPitch", "headerRule", "fillApplication", "bareContinuation"]) {
  assert.ok(verifierSelfControls[control], `verifier ${control} control did not run`);
}
assert.ok(fontMutationControl, "PDF font mutation control did not run");

// The printed inventory is pinned rather than derived, so that a report which silently doubles in
// length is a failing gate and not a shrug. History: 32 page rasters; 43 in 0.6.0 when every finding
// gained a remediation box; 31 when coverage became one aligned table instead of thirteen six-label
// cards (measured per state: clean 5 -> 2, findings 12 -> 9, infrastructure 13 -> 10,
// insufficient-coverage 13 -> 10 on Chromium 141 / linux); 32 when the clean print kept its findings
// section (clean 2 -> 3); 26 when findings fragment between their units instead of taking one page
// each (findings 9 -> 7, infrastructure 10 -> 8, insufficient-coverage 10 -> 8). Tablet and mobile
// cells also ship viewport-height tiles, pinned the same way: 148, then 152 when two findings
// gained real-shaped evidence names that wrap on a phone (infrastructure and insufficient-coverage
// mobile 14 -> 15 tiles each). 27 page rasters when remediation and note text took the 72ch
// measure (findings 7 -> 8).
assert.deepEqual(manifest.physicalArtifacts, { screens: 24, screenTiles: 152, pdfs: 4, rasterPages: 27 },
  "the report-surface inventory must be exactly 24 screens with 152 viewport tiles, 4 PDFs and 27 PDF page rasters");

const latestRound = describeLatestRound(ledger, manifest, currentReviewInput.fingerprint);
// The review ledger's state belongs where a release reader looks, not only in a log line. The line
// names every reviewer by kind; it says "human review ... PASS" only when a rostered human passed
// every cell of the latest round (describeLatestRound), and never for an agent-recorded round.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Report-surface review ledger\n\n${latestRound}.\n\n${REVIEWER_AUTHENTICATION_NOTE}\n\n`);
}
if (mode === "local") assessHumanGate(ledger, manifest, currentReviewInput.fingerprint);

if (mode === "technical") {
  process.stdout.write(
    `report surfaces: technical gate passed 32/32 current cells and ${Object.values(manifest.physicalArtifacts).reduce((sum, count) => sum + count, 0)} physical artifacts; ` +
      `no human-review claim is made; ${latestRound} ` +
      `(current inputs ${manifest.reviewInputFingerprint}; verifier self-controls rejected: pixel, font, tile re-cut, gallery, stranded heading, text depth, fill application, bare continuation, row rule, header rule, row pitch, break runs)\n`,
  );
} else {
  process.stdout.write(
    `report surfaces: strict local exact-environment human gate passed 32/32 cells ` +
      `(${latestRound}; ${manifest.reviewInputFingerprint}; pixel mutation rejected)\n`,
  );
}

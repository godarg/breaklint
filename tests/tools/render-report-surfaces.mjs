#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";

import { resolveBrowser } from "../../src/acquire/browser.ts";
import { render } from "../../src/report/index.ts";
import { canonicalReportStates } from "../fixtures/report-states.ts";
import { computeReviewInput } from "./report-surface-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = resolve(process.env.BREAKLINT_SURFACE_DIR ?? join(ROOT, ".artifacts/report-surfaces"));
const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const THEMES = ["light", "dark"];
const PRINT_CONTENT_VIEWPORT = { width: 703, height: 1123 };
const REVIEW_ARTIFACT_CONTRACT_VERSION = 3;
const SCREEN_PIXEL_CONTRACT_VERSION = 1;
const PRINT_MUTATION_CONTROL = process.env.BREAKLINT_SURFACE_PRINT_CONTROL ?? "none";
const BROWSER_RENDER_ARGS = [
  "--deterministic-mode",
  "--disable-gpu",
  "--disable-lcd-text",
  "--disable-skia-runtime-opts",
  "--font-render-hinting=none",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
];
if (!["none", "broken-coverage", "broken-trust-geometry", "broken-terminal-density", "broken-box-closure", "broken-partial-box-closure"].includes(PRINT_MUTATION_CONTROL)) {
  throw new Error(`unknown BREAKLINT_SURFACE_PRINT_CONTROL=${PRINT_MUTATION_CONTROL}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function stableReviewArtifactFingerprint(reviewInputFingerprint, reviewEnvironment, cell, visibleContract) {
  return createHash("sha256")
    .update("breaklint-stable-review-artifact-v3\0")
    .update(JSON.stringify(canonical({
      reviewInputFingerprint,
      reviewEnvironment,
      cell,
      visibleContract,
    })))
    .digest("hex");
}

function normalizedScreenPixels(path) {
  const decoded = PNG.sync.read(readFileSync(path), { checkCRC: true });
  const rgba = Buffer.from(decoded.data);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) {
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
    }
  }
  return {
    contractVersion: SCREEN_PIXEL_CONTRACT_VERSION,
    format: "decoded 8-bit straight RGBA; transparent RGB canonicalized to zero",
    width: decoded.width,
    height: decoded.height,
    rgbaBytes: rgba.length,
    normalizedRgbaSha256: createHash("sha256").update(rgba).digest("hex"),
  };
}

function pngDimensions(path) {
  const pixels = normalizedScreenPixels(path);
  return { width: pixels.width, height: pixels.height };
}

function contrastRatio(first, second) {
  const luminance = (value) => {
    const channels = /^#[0-9a-f]{6}$/iu.test(value)
      ? [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
      : value.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) throw new Error(`unsupported computed colour: ${value}`);
    const linear = channels.map((channel) => {
      const ratio = channel / 255;
      return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function measuredContrast(page) {
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries([
      "bg-primary", "paper", "fg-primary", "fg-muted", "accent-warn", "accent-info",
    ].map((name) => [name, style.getPropertyValue(`--ds-color-${name}`).trim()]));
  });
  const pairs = {
    "fg-primary/bg-primary": contrastRatio(tokens["fg-primary"], tokens["bg-primary"]),
    "fg-primary/paper": contrastRatio(tokens["fg-primary"], tokens.paper),
    "fg-muted/bg-primary": contrastRatio(tokens["fg-muted"], tokens["bg-primary"]),
    "fg-muted/paper": contrastRatio(tokens["fg-muted"], tokens.paper),
    "accent-warn/paper": contrastRatio(tokens["accent-warn"], tokens.paper),
    "accent-info/paper": contrastRatio(tokens["accent-info"], tokens.paper),
  };
  const minimum = Math.min(...Object.values(pairs));
  if (minimum < 4.5) throw new Error(`WCAG AA contrast failed: ${JSON.stringify(pairs)}`);
  return { minimum, pairs };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function longestDarkHorizontalRun(path, maxY = 120) {
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

function coveragePageStartChecks(pdfPath, rasterPages) {
  return rasterPages.map((raster, index) => {
    const page = index + 1;
    const firstToken = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"])
      .trim()
      .match(/^\S+/u)?.[0] ?? null;
    const border = longestDarkHorizontalRun(join(OUTPUT, raster.path));
    const beginsWithCoverageRecord = firstToken === "RULE";
    const beginsWithCoverageFragment = firstToken !== null && firstToken !== "RULE" && firstToken.includes("/");
    if (beginsWithCoverageFragment) {
      throw new Error(`${raster.path}: page begins inside a coverage record at ${firstToken}`);
    }
    if (beginsWithCoverageRecord && border.pixels < border.required) {
      throw new Error(`${raster.path}: coverage record begins at page top without its complete top border (${border.pixels}/${border.required}px)`);
    }
    return { page, firstToken, beginsWithCoverageRecord, beginsWithCoverageFragment, topHorizontalBorderPx: border.pixels, requiredBorderPx: border.required };
  });
}

function coverageBoxClosureChecks(rasterPages, expectedRecords) {
  const minimumEdgeCoverage = 0.98;
  const maximumEdgeGapPx = 2;
  const pages = rasterPages.map((raster, pageIndex) => {
    const decoded = PNG.sync.read(readFileSync(join(OUTPUT, raster.path)), { checkCRC: true });
    const dark = (x, y) => {
      const offset = (y * decoded.width + x) * 4;
      return decoded.data[offset] < 180 && decoded.data[offset + 1] < 180 &&
        decoded.data[offset + 2] < 180 && decoded.data[offset + 3] > 0;
    };
    const rawRuns = [];
    for (let y = 0; y < decoded.height; y += 1) {
      let best = null;
      let start = -1;
      for (let x = 0; x <= decoded.width; x += 1) {
        const on = x < decoded.width && dark(x, y);
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          const run = { y, left: start, right: x - 1, length: x - start };
          if (!best || run.length > best.length) best = run;
          start = -1;
        }
      }
      if (best && best.length >= Math.ceil(decoded.width * 0.72)) rawRuns.push(best);
    }
    const strokes = [];
    for (const run of rawRuns) {
      const previous = strokes.at(-1);
      if (
        previous && run.y <= previous.bottom + 1 &&
        Math.abs(run.left - previous.left) <= 2 && Math.abs(run.right - previous.right) <= 2
      ) {
        previous.bottom = run.y;
        if (run.length > previous.length) Object.assign(previous, { left: run.left, right: run.right, length: run.length });
      } else {
        strokes.push({ top: run.y, bottom: run.y, left: run.left, right: run.right, length: run.length });
      }
    }
    const edgeStats = (x, top, bottom) => {
      let rows = 0;
      let hits = 0;
      let currentGapPx = 0;
      let maximumGapPx = 0;
      for (let y = top; y <= bottom; y += 1) {
        rows += 1;
        const hit = [x - 1, x, x + 1]
          .some((candidate) => candidate >= 0 && candidate < decoded.width && dark(candidate, y));
        if (hit) {
          hits += 1;
          currentGapPx = 0;
        } else {
          currentGapPx += 1;
          maximumGapPx = Math.max(maximumGapPx, currentGapPx);
        }
      }
      return { coverage: hits / rows, maximumGapPx };
    };
    const boxes = [];
    for (let index = 0; index < strokes.length;) {
      const top = strokes[index];
      let matchIndex = -1;
      let box = null;
      for (let candidateIndex = index + 1; candidateIndex < strokes.length; candidateIndex += 1) {
        const bottom = strokes[candidateIndex];
        const height = Math.round((bottom.top + bottom.bottom - top.top - top.bottom) / 2);
        if (height > 320) break;
        if (
          height < 180 || Math.abs(top.left - bottom.left) > 2 ||
          Math.abs(top.right - bottom.right) > 2
        ) continue;
        const left = Math.round((top.left + bottom.left) / 2);
        const right = Math.round((top.right + bottom.right) / 2);
        const leftStats = edgeStats(left, top.bottom, bottom.top);
        if (leftStats.coverage < 0.8) continue;
        const rightStats = edgeStats(right, top.bottom, bottom.top);
        box = {
          top: top.top,
          bottom: bottom.bottom,
          left,
          right,
          leftCoverage: Math.round(leftStats.coverage * 1_000) / 1_000,
          leftMaximumGapPx: leftStats.maximumGapPx,
          rightCoverage: Math.round(rightStats.coverage * 1_000) / 1_000,
          rightMaximumGapPx: rightStats.maximumGapPx,
        };
        matchIndex = candidateIndex;
        break;
      }
      if (box) {
        boxes.push(box);
        index = matchIndex + 1;
      } else {
        index += 1;
      }
    }
    return { page: pageIndex + 1, path: raster.path, boxes };
  });
  const boxes = pages.flatMap((page) => page.boxes.map((box) => ({ page: page.page, path: page.path, ...box })));
  if (boxes.length !== expectedRecords) {
    throw new Error(`coverage box raster inventory drift: detected ${boxes.length}/${expectedRecords}`);
  }
  const open = boxes.filter((box) =>
    box.leftCoverage < minimumEdgeCoverage || box.leftMaximumGapPx > maximumEdgeGapPx ||
    box.rightCoverage < minimumEdgeCoverage || box.rightMaximumGapPx > maximumEdgeGapPx
  );
  if (open.length > 0) {
    throw new Error(`coverage boxes have an open physical edge: ${JSON.stringify(open)}`);
  }
  return { expectedRecords, detectedRecords: boxes.length, minimumEdgeCoverage, maximumEdgeGapPx, pages };
}

function rasterInkBounds(path) {
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

function terminalPageContentChecks(pdfPath, rasterPages) {
  const pages = rasterPages.map((raster, index) => {
    const page = index + 1;
    const text = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    return {
      page,
      firstToken: text.trim().match(/^\S+/u)?.[0] ?? null,
      nonWhitespaceCharacters: text.replace(/\s/gu, "").length,
      coverageRecords: (text.match(/^\s*RULE\s*$/gmu) ?? []).length,
      ink: rasterInkBounds(join(OUTPUT, raster.path)),
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
  const terminalCoverage = {
    continuesCoverage,
    previousCoverageRecords: previous?.coverageRecords ?? 0,
    terminalCoverageRecords: terminal?.coverageRecords ?? 0,
    minimumTerminalCoverageRecords,
    terminalInkBottomPx: terminal?.ink.bottomPx ?? 0,
    expectedMinimumInkBottomPx,
    underfilledCoverageContinuation,
  };
  if (emptyNonCoverPages.length > 0) throw new Error(`${pdfPath}: empty non-cover pages ${emptyNonCoverPages.join(", ")}`);
  if (underfilledCoverageContinuation) throw new Error(`${pdfPath}: underfilled terminal coverage continuation: ${JSON.stringify(terminalCoverage)}`);
  return { pages, emptyNonCoverPages, terminalCoverage };
}

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

const browserResolution = resolveBrowser();
if (!browserResolution.path) {
  throw new Error(`no browser for report-surface rendering; searched: ${browserResolution.searched.join(", ")}`);
}
const reviewInput = computeReviewInput(ROOT);
const browserVersionResult = spawnSync(browserResolution.path, ["--version"], { encoding: "utf8" });
const popplerVersionResult = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
const reviewEnvironment = {
  reviewArtifactContractVersion: REVIEW_ARTIFACT_CONTRACT_VERSION,
  screenPixelContractVersion: SCREEN_PIXEL_CONTRACT_VERSION,
  browser: browserVersionResult.status === 0 ? browserVersionResult.stdout.trim() : browserResolution.path,
  platform: platform(),
  architecture: arch(),
  platformRelease: release(),
  node: process.version,
  deviceScaleFactor: 1,
  browserRenderArgs: BROWSER_RENDER_ARGS,
  viewports: VIEWPORTS,
  themes: THEMES,
  print: {
    media: "print",
    format: "A4 from CSS @page",
    rasterDpi: 110,
    rasterizer: (popplerVersionResult.stderr || popplerVersionResult.stdout).trim().split("\n")[0] || "pdftoppm",
    contentViewportCssPx: PRINT_CONTENT_VIEWPORT,
  },
};
const browser = await puppeteer.launch({ executablePath: browserResolution.path, headless: true, args: BROWSER_RENDER_ARGS });
const artifacts = [];
try {
  for (const [state, report] of Object.entries(canonicalReportStates())) {
    const page = await browser.newPage();
    try {
      const html = render(report, "html");
      for (const theme of THEMES) {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
        for (const [viewport, dimensions] of Object.entries(VIEWPORTS)) {
          await page.setViewport({ ...dimensions, deviceScaleFactor: 1 });
          await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
          await page.evaluate(() => document.fonts.ready);
          const semantics = await page.evaluate(() => {
            const findings = [...document.querySelectorAll("article.finding")];
            const externalResources = performance.getEntriesByType("resource")
              .map((entry) => entry.name)
              .filter((name) => !name.startsWith("data:"));
            return {
              mainCount: document.querySelectorAll("main").length,
              h1Count: document.querySelectorAll("h1").length,
              bodyFontPx: Number.parseFloat(getComputedStyle(document.body).fontSize),
              horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
              overflowingFindings: findings
                .filter((finding) => finding.scrollWidth > finding.clientWidth)
                .map((finding) => finding.id),
              externalResources,
            };
          });
          semantics.contrast = await measuredContrast(page);
          if (
            semantics.mainCount !== 1 || semantics.h1Count !== 1 || semantics.bodyFontPx < 16 ||
            semantics.horizontalOverflowPx !== 0 || semantics.overflowingFindings.length !== 0 ||
            semantics.externalResources.length !== 0
          ) {
            throw new Error(`${state}/${theme}/${viewport}: ${JSON.stringify(semantics)}`);
          }
          const name = `${state}--${theme}--${viewport}.png`;
          const path = join(OUTPUT, name);
          await page.screenshot({ path, fullPage: true, type: "png" });
          const artifactSha256 = sha256(path);
          const pixels = normalizedScreenPixels(path);
          const screenshotDimensions = { width: pixels.width, height: pixels.height };
          const cell = `screen/${state}/${theme}/${viewport}`;
          artifacts.push({
            cell,
            kind: "screen",
            path: name,
            bytes: readFileSync(path).length,
            sha256: artifactSha256,
            reviewArtifactFingerprint: stableReviewArtifactFingerprint(
              reviewInput.fingerprint,
              reviewEnvironment,
              cell,
              { dimensions: screenshotDimensions, semantics, pixels },
            ),
            dimensions: screenshotDimensions,
            pixels,
            semantics,
          });
        }
      }

      await page.setViewport({ ...PRINT_CONTENT_VIEWPORT, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
      await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMediaType("print");
      if (PRINT_MUTATION_CONTROL === "broken-coverage") {
        await page.addStyleTag({ content: `@media print {
          .summary-grid > div:first-child dd { overflow-wrap: anywhere !important; font-size: var(--ds-font-size-xl) !important; white-space: normal !important; }
          .coverage-list { display: grid !important; }
          .coverage-record { display: grid !important; grid-template-columns: minmax(11rem, 2fr) repeat(5, minmax(0, 1fr)) !important; break-inside: auto !important; page-break-inside: auto !important; }
          .coverage-record > div:first-child { grid-column: auto !important; }
        }` });
      }
      if (PRINT_MUTATION_CONTROL === "broken-trust-geometry") {
        await page.addStyleTag({ content: `@media print {
          .report-header.state-insufficient-coverage + section .summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
        }` });
      }
      if (PRINT_MUTATION_CONTROL === "broken-terminal-density") {
        await page.addStyleTag({ content: `@media print {
          .report-header.state-clean ~ .findings-empty { display: block !important; }
        }` });
      }
      if (PRINT_MUTATION_CONTROL === "broken-box-closure") {
        await page.addStyleTag({ content: `@media print {
          .coverage-record::after { content: none !important; }
        }` });
      }
      if (PRINT_MUTATION_CONTROL === "broken-partial-box-closure") {
        await page.addStyleTag({ content: `@media print {
          .coverage-record::after { inset-block-end: auto !important; block-size: 80% !important; }
        }` });
      }
      const printContrast = await measuredContrast(page);
      const printSemantics = await page.evaluate(() => {
        const trustValue = document.querySelector(".summary-grid > div:first-child dd");
        const trustText = trustValue
          ? [...trustValue.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
          : null;
        const trustRange = trustText ? document.createRange() : null;
        if (trustText && trustRange) trustRange.selectNodeContents(trustText);
        const trustLabelLines = trustRange
          ? new Set([...trustRange.getClientRects()].map((rect) => Math.round(rect.top * 100) / 100)).size
          : 0;
        const trustRects = trustRange ? [...trustRange.getClientRects()] : [];
        const trustCell = trustValue?.parentElement ?? null;
        const trustSibling = trustCell?.nextElementSibling ?? null;
        const trustValueRect = trustValue?.getBoundingClientRect() ?? null;
        const siblingRect = trustSibling?.getBoundingClientRect() ?? null;
        const trustValueOverflowPx = trustValueRect
          ? Math.max(0, ...trustRects.map((rect) => Math.max(trustValueRect.left - rect.left, rect.right - trustValueRect.right)))
          : -1;
        const trustSiblingOverlapPx = siblingRect
          ? Math.max(0, ...trustRects.map((rect) => {
            const verticalOverlap = Math.min(rect.bottom, siblingRect.bottom) - Math.max(rect.top, siblingRect.top);
            return verticalOverlap > 0
              ? Math.min(rect.right, siblingRect.right) - Math.max(rect.left, siblingRect.left)
              : 0;
          }))
          : -1;
        const records = [...document.querySelectorAll(".coverage-record")];
        return {
          trustLabelLines,
          trustValueOverflowPx: Math.round(trustValueOverflowPx * 100) / 100,
          trustSiblingOverlapPx: Math.round(Math.max(0, trustSiblingOverlapPx) * 100) / 100,
          coverageListDisplay: getComputedStyle(document.querySelector(".coverage-list")).display,
          coverageRecordDisplay: records.map((record) => getComputedStyle(record).display),
          coverageMaxCellsPerRow: records.map((record) => {
            const rows = new Map();
            for (const cell of record.children) {
              const top = Math.round(cell.getBoundingClientRect().top * 100) / 100;
              rows.set(top, (rows.get(top) ?? 0) + 1);
            }
            return Math.max(0, ...rows.values());
          }),
          coverageRecordBreakInside: records.map((record) => getComputedStyle(record).breakInside),
          coverageRecordCount: records.length,
          overflowingCoverageCells: records.flatMap((record) => [...record.children]
            .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
            .map((cell) => record.id)),
        };
      });
      if (
        printSemantics.trustLabelLines !== 1 ||
        printSemantics.trustValueOverflowPx !== 0 ||
        printSemantics.trustSiblingOverlapPx !== 0 ||
        printSemantics.coverageListDisplay !== "block" ||
        printSemantics.coverageRecordDisplay.some((value) => value !== "flow-root") ||
        printSemantics.coverageMaxCellsPerRow.some((count) => count > 2) ||
        printSemantics.coverageRecordBreakInside.some((value) => !["avoid", "avoid-page"].includes(value)) ||
        printSemantics.overflowingCoverageCells.length > 0
      ) {
        throw new Error(`${state}: print reflow contract failed: ${JSON.stringify(printSemantics)}`);
      }
      const pdfName = `${state}--a4.pdf`;
      const pdfPath = join(OUTPUT, pdfName);
      writeFileSync(pdfPath, await page.pdf({ printBackground: true, preferCSSPageSize: true }));
      const pdfInfo = run("pdfinfo", [pdfPath]);
      const pages = Number(/^Pages:\s+(\d+)$/mu.exec(pdfInfo)?.[1] ?? "0");
      const pageSize = /^Page size:\s+(.+)$/mu.exec(pdfInfo)?.[1] ?? "unknown";
      if (pages < 1 || !/A4|594\.9\d* x 841\.9\d* pts/iu.test(pageSize)) {
        throw new Error(`${state}: unexpected PDF geometry: ${pages} pages, ${pageSize}`);
      }
      const rasterPrefix = join(OUTPUT, `${state}--a4-page`);
      run("pdftoppm", ["-png", "-r", "110", pdfPath, rasterPrefix]);
      const rasterPaths = readdirSync(OUTPUT)
        .filter((name) => name.startsWith(`${state}--a4-page-`) && name.endsWith(".png"))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      if (rasterPaths.length !== pages) throw new Error(`${state}: rasterized ${rasterPaths.length}/${pages} PDF pages`);
      const rasterPages = rasterPaths.map((name) => {
        const path = join(OUTPUT, name);
        return {
          path: name,
          bytes: readFileSync(path).length,
          sha256: sha256(path),
          dimensions: pngDimensions(path),
        };
      });
      const pageStartChecks = coveragePageStartChecks(pdfPath, rasterPages);
      const pageContentChecks = terminalPageContentChecks(pdfPath, rasterPages);
      const boxClosureChecks = coverageBoxClosureChecks(rasterPages, printSemantics.coverageRecordCount);
      const visiblePrintContract = {
        pages,
        pageSize,
        contrast: printContrast,
        printSemantics,
        pageStartChecks,
        pageContentChecks,
        boxClosureChecks,
        rasterPages: rasterPages.map((page) => ({ sha256: page.sha256, dimensions: page.dimensions })),
      };
      const pdfCell = `print/${state}/pdf`;
      const rasterCell = `print/${state}/raster-set`;
      const pdfSha256 = sha256(pdfPath);
      artifacts.push({
        cell: pdfCell,
        kind: "pdf",
        path: pdfName,
        bytes: readFileSync(pdfPath).length,
        sha256: pdfSha256,
        reviewArtifactFingerprint: stableReviewArtifactFingerprint(
          reviewInput.fingerprint,
          reviewEnvironment,
          pdfCell,
          visiblePrintContract,
        ),
        pages,
        pageSize,
        contrast: printContrast,
        printSemantics,
        pageStartChecks,
        pageContentChecks,
        boxClosureChecks,
        rasterPageVisualHashes: rasterPages.map((page) => page.sha256),
      });
      artifacts.push({
        cell: rasterCell,
        kind: "raster-set",
        reviewArtifactFingerprint: stableReviewArtifactFingerprint(
          reviewInput.fingerprint,
          reviewEnvironment,
          rasterCell,
          visiblePrintContract,
        ),
        pages: rasterPages,
      });
      await page.emulateMediaType("screen");
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const manifest = {
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  reviewInputContractVersion: 1,
  reviewInputFingerprint: reviewInput.fingerprint,
  reviewInputs: reviewInput.files,
  reviewEnvironment,
  matrix: "4 states × (2 themes × 3 screen viewports + A4 PDF + A4 raster set) = 32 review cells",
  physicalArtifacts: {
    screens: artifacts.filter((artifact) => artifact.kind === "screen").length,
    pdfs: artifacts.filter((artifact) => artifact.kind === "pdf").length,
    rasterPages: artifacts
      .filter((artifact) => artifact.kind === "raster-set")
      .reduce((sum, artifact) => sum + artifact.pages.length, 0),
  },
  artifacts,
};
writeFileSync(join(OUTPUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`report surfaces: rendered ${artifacts.length} cells to ${OUTPUT}\n`);

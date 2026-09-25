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
import { REPORT_FONT_ROLES, REPORT_TEXT_CONTRAST_PAIRS, TOKEN_PREFIX } from "../../src/report/html-tokens.ts";
import { canonicalReportStates, longCoverageReportState } from "../fixtures/report-states.ts";
import {
  REQUIRED_BROWSER_RENDER_ARGS,
  REVIEW_ARTIFACT_CONTRACT_VERSION,
  SCREEN_PIXEL_CONTRACT_VERSION,
  assertObservedEnvironment,
  assertReviewEnvironment,
  computeReviewInput,
} from "./report-surface-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = resolve(process.env.BREAKLINT_SURFACE_DIR ?? join(ROOT, ".artifacts/report-surfaces"));
const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const THEMES = ["light", "dark"];
const PRINT_CONTENT_VIEWPORT = { width: 703, height: 1123 };
const PRINT_RASTER_DPI = 110;
const REPORT_STATES = ["clean", "findings", "infrastructure", "insufficient-coverage"];
/** Closes the CSS string, the rule and the style element, and injects markup, if not escaped. */
const HOSTILE_RUN_ID = `"; } body { display: none } /* </style><script>alert(1)</script> \\ ü`;
const BROWSER_RENDER_ARGS = [...REQUIRED_BROWSER_RENDER_ARGS];

/**
 * Every negative control the renderer knows, as the stylesheet it injects into screen cells, print,
 * or both. tests/tools/report-surface-mutations.mjs reads this list through `--list-controls` and
 * holds it against its own expectations, so a control nobody runs cannot exist here unnoticed.
 */
const SURFACE_CONTROLS = {
  // The trust verdict wraps and the coverage table is forced into fixed columns too narrow for
  // its rule ids: both must fail the print reflow contract.
  "broken-coverage": { print: `@media print {
    .summary-grid > div:first-child dd { overflow-wrap: anywhere !important; font-size: var(--bl-font-size-xl) !important; white-space: normal !important; }
    .coverage-table { table-layout: fixed !important; }
    .coverage-table .rule { width: 4rem !important; }
  }` },
  "broken-trust-geometry": { print: `@media print {
    .summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
  }` },
  // Replaces the card-era phase control: releases the two-row tail bracket and forces the last row
  // onto a page of its own, whatever the content above it does — a continuation with one row.
  "broken-tail-cohesion": { print: `@media print {
    .coverage-tail { break-inside: auto !important; page-break-inside: auto !important; }
    .coverage-tail > tr:last-child { break-before: page !important; }
  }` },
  // Four physical controls on the printed row rules, replacing the four card-edge controls: a whole
  // rule gone, the rule under the last column gone (right half open), under the first column gone
  // (left half open), and both. Each must cross the 98 % / 2 px thresholds on the named side.
  "broken-row-rule": { print: `@media print {
    .coverage-table tbody tr:nth-child(5) > * { border-block-end-color: transparent !important; }
  }` },
  "broken-right-row-rule": { print: `@media print {
    .coverage-table tbody tr > :last-child { border-block-end-color: transparent !important; }
  }` },
  "broken-left-row-rule": { print: `@media print {
    .coverage-table tbody tr > :first-child { border-block-end-color: transparent !important; }
  }` },
  "broken-both-row-rule": { print: `@media print {
    .coverage-table tbody tr > :first-child, .coverage-table tbody tr > :last-child { border-block-end-color: transparent !important; }
  }` },
  // One numeric column loses its end alignment. The canonical counts are single digits, so only
  // the header comparison can see it.
  "broken-column-alignment": {
    screen: `.coverage-table td:nth-child(3) { text-align: start !important; }`,
    print: `.coverage-table td:nth-child(3) { text-align: start !important; }`,
  },
  // Forces a break inside the one printed command, whatever today's text length is.
  "broken-flag-wrap": { print: `@media print {
    .cli-flag, .cli-flag > span { white-space: normal !important; }
    .coverage-shortfall-item li { max-inline-size: 6ch !important; }
  }` },
  // Rule ids may break at a hyphen inside the name again.
  "broken-rule-id-wrap": { screen: `.rule-id > span { white-space: normal !important; } .finding h3 { max-inline-size: 12ch !important; }` },
  // Page fill, alignment and keep-with-next controls.
  // Page-atomic findings, each well under half a page, with a gap after each that the next one
  // cannot fit beside: one finding per page, text to about 40 % of the content box. (Page-atomic
  // full findings alone measured 55.5 %, too close to the 60 % bound to prove much.)
  "broken-page-fill": { print: `@media print {
    .finding, .finding-list > li { break-inside: avoid-page !important; }
    .finding-facts { display: none !important; }
    .finding-list > li + li { margin-block-start: 640px !important; }
  }` },
  // One remediation grows to about 55 % of a page (the verifier's x-longer-remediation experiment):
  // the tail cannot break, moves whole to the next page and leaves the cloned frame of finding 01
  // empty below its facts. Ink depth read that frame as a full page; text depth and the unit bound
  // must both reject it.
  "broken-long-remediation": { print: `@media print { .finding-list > li:first-child .finding-remediation p::after { content: "${" Check the block in its own context and compare the measured value with the threshold before changing layout rules.".repeat(12)}"; } }` },
  // Every fact keeps with the next unit: no element grows, but head, facts and tail become one
  // keep-with-next chain as tall as the whole finding. Only a chain-aware unit bound sees it.
  // The long remediation again, with the tail's label hidden: page 3 opens on a bare remediation
  // box in a cloned frame (the verifier's round-2 finding L1).
  "broken-continued-label": { print: `@media print { .finding-continued { display: none !important; } .finding-list > li:first-child .finding-remediation p::after { content: "${" Check the block in its own context and compare the measured value with the threshold before changing layout rules.".repeat(12)}"; } }` },
  "broken-keep-chain": { print: `@media print { .finding-facts > div { break-after: avoid !important; } }` },
  "broken-alert-width": {
    screen: `.state-alert { max-width: 72ch !important; }`,
    print: `.state-alert { max-width: 72ch !important; }`,
  },
  "broken-alert-gap": {
    screen: `.state-alert { margin-block-end: 0 !important; }`,
    print: `.state-alert { margin-block-end: 0 !important; }`,
  },
  "broken-heading-keep": { print: `@media print { .coverage-table tbody:first-of-type > tr:first-child { break-before: page !important; } }` },
  // Page furniture controls: the folio, the running head, the clean findings statement and the end mark.
  "broken-folio": { print: `@page { @bottom-right { content: none !important; } }` },
  "broken-running-head": { print: `@page { @top-right { content: none !important; } }` },
  "broken-clean-findings": { print: `@media print { .findings-empty { display: none !important; } }` },
  "broken-end-mark": { print: `@media print { .report-footer { display: none !important; } }` },
  // The contents navigation disappears.
  "broken-landmarks": { screen: `nav[aria-label="Report contents"] { display: none !important; }` },
  // The skip link leaves the keyboard order.
  "broken-skip-link": { screen: `.skip-link { display: none !important; }` },
  // The per-finding sentence comes back: seven repetitions of one caveat in small print.
  "broken-untested-repeat": { print: `@media print { .finding-remediation::after { content: "Untested: no trigger/remedied pair in this package shows this advice removing this finding."; display: block; } }` },
  // The marker falls back to muted small print.
  "broken-untested-marker": {
    screen: `.untested-marker { color: var(--bl-color-fg-muted) !important; }`,
    print: `.untested-marker { color: var(--bl-color-fg-muted) !important; }`,
  },
  // The column header stops repeating on a continuation page (long-table probe).
  "broken-header-repeat": { print: `@media print { .coverage-table thead { display: table-row-group !important; } }` },
  // Text on the soft background (alert, remediation box, frequency note) was not measured before
  // the token table named the pair. Darken only soft in print: every other pair stays AA.
  "broken-soft-contrast": { print: `@media print { :root { --bl-color-soft: #8C8C86 !important; } }` },
  // Display falls back to the body face: the collapse the 2026-09-18 review found on Linux.
  "collapsed-display-font": {
    screen: `h1, h2 { font-family: var(--bl-font-body) !important; }`,
    print: `h1, h2 { font-family: var(--bl-font-body) !important; }`,
  },
  // Display falls back to a sans that is NOT the body face. "display differs from body" would pass
  // this; the declared expectation must not.
  "accidental-display-font": {
    screen: `h1, h2 { font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif !important; }`,
    print: `h1, h2 { font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif !important; }`,
  },
};
if (process.argv.includes("--list-controls")) {
  process.stdout.write(`${JSON.stringify(Object.keys(SURFACE_CONTROLS))}\n`);
  process.exit(0);
}
const SURFACE_CONTROL = process.env.BREAKLINT_SURFACE_CONTROL ?? "none";
const STATE_FILTER = process.env.BREAKLINT_SURFACE_STATE ?? null;
if (SURFACE_CONTROL !== "none" && !Object.hasOwn(SURFACE_CONTROLS, SURFACE_CONTROL)) {
  throw new Error(`unknown BREAKLINT_SURFACE_CONTROL=${SURFACE_CONTROL}`);
}
const ACTIVE_CONTROL = SURFACE_CONTROL === "none" ? {} : SURFACE_CONTROLS[SURFACE_CONTROL];
if (STATE_FILTER !== null && !REPORT_STATES.includes(STATE_FILTER)) {
  throw new Error(`unknown BREAKLINT_SURFACE_STATE=${STATE_FILTER}`);
}
if (STATE_FILTER !== null && SURFACE_CONTROL === "none") {
  throw new Error("BREAKLINT_SURFACE_STATE is reserved for negative mutation controls");
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
    .update(`breaklint-stable-review-artifact-v${REVIEW_ARTIFACT_CONTRACT_VERSION}\0`)
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
  const names = [...new Set(REPORT_TEXT_CONTRAST_PAIRS.flat())];
  const tokens = await page.evaluate((tokenNames, prefix) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(tokenNames.map((name) => [name, style.getPropertyValue(`${prefix}color-${name}`).trim()]));
  }, names, TOKEN_PREFIX);
  const pairs = Object.fromEntries(REPORT_TEXT_CONTRAST_PAIRS.map(([foreground, background]) => [
    `${foreground}/${background}`,
    contrastRatio(tokens[foreground], tokens[background]),
  ]));
  const minimum = Math.min(...Object.values(pairs));
  if (minimum < 4.5) throw new Error(`WCAG AA contrast failed: ${JSON.stringify(pairs)}`);
  return { minimum, pairs };
}

/**
 * Which elements carry each font role. Every matching element is probed (bounded per selector), so
 * a role that falls back on one heading but not another is still seen.
 */
const FONT_ROLE_PROBES = {
  display: ["h1", "h2"],
  body: [".status-sentence", ".section-lead", ".run-facts dd:not(.mono)", "h3:not(.mono)", ".finding-message", ".state-alert p"],
  mono: ["code", ".summary-grid dd", ".mono"],
};
const FONT_PROBE_LIMIT = 12;

/**
 * The resolved platform font of every role, read from the browser's own layout (CDP
 * CSS.getPlatformFontsForNode), compared with the DECLARED expectation for this platform in
 * REPORT_FONT_ROLES. Not "display differs from body": a display role that falls back to a sans
 * other than the body's is just as collapsed, and that comparison would pass it.
 *
 * CDP reports the fonts of an element's inline descendants too, so only elements whose descendants
 * all share their computed font-family are probed: a body paragraph containing inline code would
 * otherwise report the mono face as body. The probe marks those elements with a data attribute no
 * stylesheet reads, and removes it again.
 */
async function resolvedRoleFonts(page, cdp, label) {
  const eligible = await page.evaluate((probes, limit) => {
    const counts = {};
    for (const [role, selectors] of Object.entries(probes)) {
      counts[role] = 0;
      for (const selector of selectors) {
        let taken = 0;
        for (const element of document.querySelectorAll(selector)) {
          if (taken >= limit) break;
          const family = getComputedStyle(element).fontFamily;
          const uniform = [...element.querySelectorAll("*")].every((child) => getComputedStyle(child).fontFamily === family);
          const visible = element.getClientRects().length > 0 && element.textContent.trim().length > 0;
          if (!uniform || !visible || element.hasAttribute("data-bl-font-probe")) continue;
          element.setAttribute("data-bl-font-probe", role);
          taken += 1;
          counts[role] += 1;
        }
      }
    }
    return counts;
  }, FONT_ROLE_PROBES, FONT_PROBE_LIMIT);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const roles = {};
    for (const role of Object.keys(FONT_ROLE_PROBES)) {
      const families = new Set();
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: `[data-bl-font-probe="${role}"]` });
      for (const nodeId of nodeIds) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        for (const font of fonts) families.add(font.familyName);
      }
      roles[role] = { probedNodes: nodeIds.length, families: [...families].sort() };
    }
    const declaredPlatform = platform();
    for (const [role, measured] of Object.entries(roles)) {
      const declared = REPORT_FONT_ROLES[role];
      const expected = declared.resolvesOn[declaredPlatform];
      if (!expected) throw new Error(`${label}: no declared font expectation for platform ${declaredPlatform}`);
      if (measured.probedNodes === 0 || measured.probedNodes !== eligible[role]) {
        throw new Error(`${label}: ${role} role has no measurable rendered text (${measured.probedNodes}/${eligible[role]})`);
      }
      const foreign = measured.families.filter((family) => !expected.includes(family));
      if (foreign.length > 0) {
        throw new Error(`${label}: ${role} role resolved to ${foreign.join(", ")}, not a declared ${declared.generic} face on ${declaredPlatform} (${expected.join(", ")})`);
      }
    }
    return roles;
  } finally {
    await page.evaluate(() => { for (const element of document.querySelectorAll("[data-bl-font-probe]")) element.removeAttribute("data-bl-font-probe"); });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

/** Millimetres of the A4 @page margin; the content box starts this far in on every side. */
const PRINT_MARGIN_MM = 12;
const PRINT_MARGIN_RASTER_PX = PRINT_MARGIN_MM / 25.4 * PRINT_RASTER_DPI;
const PT_TO_RASTER = PRINT_RASTER_DPI / 72;
const CSS_TO_RASTER = PRINT_RASTER_DPI / 96;

/**
 * Evaluated in the page for every screen cell and for print: the geometry of every coverage table.
 * A column is aligned when every body cell's text edge — the end edge for a right-aligned column,
 * the start edge otherwise — lies within 1 px of the others AND of its header's. The header
 * comparison matters: the canonical counts are all single digits, so a body-only spread could not
 * tell a numeric column that lost its alignment from one that kept it.
 */
function coverageTableGeometryInPage() {
  const round = (value) => Math.round(value * 100) / 100;
  const textEdge = (cell, side) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return null;
    return side === "end" ? Math.max(...rects.map((rect) => rect.right)) : Math.min(...rects.map((rect) => rect.left));
  };
  return [...document.querySelectorAll(".coverage-table")].map((table) => {
    const header = [...(table.tHead?.rows[0]?.cells ?? [])];
    const rows = [...table.tBodies].flatMap((body) => [...body.rows]);
    const columns = header.map((th, index) => {
      const align = /^(?:end|right)$/u.test(getComputedStyle(th).textAlign) ? "end" : "start";
      const edges = rows.map((row) => textEdge(row.cells[index], align)).filter((edge) => edge !== null);
      const headerEdge = textEdge(th, align);
      return {
        column: index + 1,
        align,
        bodyAlign: [...new Set(rows.map((row) => getComputedStyle(row.cells[index]).textAlign))],
        spreadPx: edges.length ? round(Math.max(...edges) - Math.min(...edges)) : null,
        headerDeltaPx: edges.length && headerEdge !== null ? round(Math.max(...edges.map((edge) => Math.abs(edge - headerEdge)))) : null,
      };
    });
    const rect = table.getBoundingClientRect();
    return {
      id: table.id,
      rows: rows.length,
      shortRows: rows.filter((row) => row.classList.contains("short")).length,
      columns,
      overflowingCells: rows.flatMap((row) => [...row.cells]
        .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
        .map((cell) => `${row.id}:${cell.cellIndex + 1}`)),
      rowBreakInside: [...new Set(rows.map((row) => getComputedStyle(row).breakInside))],
      heightPx: round(rect.height),
      leftPx: round(rect.left),
      rightPx: round(rect.right),
    };
  });
}

/**
 * Evaluated in the page: the untested-advice caveat is stated once per report and each finding
 * carries a compact marker in body-text colour at least as large as the advice it marks.
 */
function remediationCaveatInPage() {
  const probe = document.createElement("span");
  probe.style.color = "var(--bl-color-fg-primary)";
  document.body.append(probe);
  const bodyText = getComputedStyle(probe).color;
  probe.remove();
  const markers = [...document.querySelectorAll(".finding .untested-marker")];
  return {
    statements: document.querySelectorAll(".remediation-caveat").length,
    markers: markers.length,
    markersInBodyTextColour: markers.every((marker) => getComputedStyle(marker).color === bodyText),
    smallestMarkerToAdviceRatio: markers.length === 0 ? null : Math.min(...markers.map((marker) =>
      Number.parseFloat(getComputedStyle(marker).fontSize) / Number.parseFloat(getComputedStyle(marker.parentElement).fontSize))),
  };
}

function assertRemediationCaveat(caveat, label) {
  if (caveat.statements !== (caveat.markers > 0 ? 1 : 0)) {
    throw new Error(`${label}: the untested-advice caveat must be stated once per report with markers, found ${caveat.statements} statements for ${caveat.markers} markers`);
  }
  if (!caveat.markersInBodyTextColour) throw new Error(`${label}: untested marker is not set in body-text colour`);
  if (caveat.markers > 0 && caveat.smallestMarkerToAdviceRatio < 1) throw new Error(`${label}: untested marker is smaller than the advice it marks`);
}

/** The long caveat sentence, counted in a PDF's text with line breaks normalised away. */
function untestedCaveatOccurrences(pdfPath) {
  const text = run("pdftotext", [pdfPath, "-"]).replace(/\s+/gu, " ");
  return (text.match(/no trigger\/remedied pair in this package/giu) ?? []).length;
}

/**
 * Evaluated in the page: how every command (`.cli-flag`) and rule id (`.rule-id`) is broken into
 * rendered lines, measured per character, so a break is seen wherever it falls.
 */
function identifierLinesInPage() {
  return [...document.querySelectorAll(".cli-flag, .rule-id")].flatMap((element) => {
    if (element.parentElement?.closest(".cli-flag, .rule-id")) return [];
    const lines = [];
    let currentTop = null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let index = 0; index < node.textContent.length; index += 1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (currentTop === null || rect.top > currentTop + rect.height / 2) {
          lines.push("");
          currentTop = rect.top;
        }
        lines[lines.length - 1] += node.textContent[index];
      }
    }
    return lines.length === 0 ? [] : [{ kind: element.classList.contains("cli-flag") ? "flag" : "rule-id", text: element.textContent, lines }];
  });
}

/**
 * A command or rule id may break only after its namespace slash, and only on screen: print keeps
 * every one on a single line, because a line break in a PDF is a newline in the copied command.
 */
function assertIdentifierLines(identifiers, label, { print }) {
  for (const identifier of identifiers) {
    const permitted = print ? identifier.lines.length === 1
      : identifier.lines.length === 1 || (identifier.lines.length === 2 && identifier.lines[0].endsWith("/"));
    if (!permitted) {
      const what = identifier.kind === "flag" ? `flag ${identifier.text}` : `rule id ${identifier.text}`;
      throw new Error(`${label}: ${what} split across ${identifier.lines.length} lines (${JSON.stringify(identifier.lines)}); ${identifier.kind === "flag" ? "a flag" : "a rule id"} may break only after its namespace slash, and never in print`);
    }
  }
}

/** Independent of the DOM: in the PDF's text no command or rule id is split across lines. */
function pdfIdentifierBreaks(pdfPath, flags) {
  const text = run("pdftotext", ["-layout", pdfPath, "-"]);
  const lines = text.split("\n");
  return {
    linesEndingInsideAFlag: lines.filter((line) => /(?:^|\s)--(?:[a-z-]*)?\s*$/u.test(line)).length,
    linesEndingInsideARuleId: lines.filter((line) => /\b(?:layout|svg|type|artifact)\/(?:[a-z0-9-]*-)?\s*$/u.test(line)).length,
    flagsWhole: flags.map((flag) => ({ flag, whole: lines.some((line) => line.includes(flag)) })),
  };
}

const LANDMARK_ROLES = ["banner", "navigation", "main", "contentinfo", "complementary", "search", "form", "region"];

/**
 * The report as assistive technology receives it (CDP accessibility tree) plus the first keyboard
 * stop, per screen cell. Run after the screenshot: it moves focus, which draws a focus ring.
 */
async function accessibilitySemantics(page, cdp, label) {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const live = nodes.filter((node) => !node.ignored);
  const role = (node) => node.role?.value ?? "";
  const landmarks = live.filter((node) => LANDMARK_ROLES.includes(role(node))).map((node) => ({ role: role(node), name: node.name?.value ?? "" }));
  const count = (wanted) => live.filter((node) => role(node) === wanted).length;
  const tableRoles = { table: count("table"), rowheader: count("rowheader"), columnheader: count("columnheader") };
  const dom = await page.evaluate(() => ({
    links: [...document.querySelectorAll('a[href^="#"]')].map((link) => {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      return { href: link.getAttribute("href"), target: target ? target.tagName.toLowerCase() : null };
    }),
    coverageTables: document.querySelectorAll(".coverage-table").length,
    coverageRows: document.querySelectorAll(".coverage-table tbody tr").length,
  }));
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.keyboard.press("Tab");
  const firstTabStop = await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      element: `${element.tagName.toLowerCase()}.${element.className}`,
      href: element.getAttribute("href"),
      outlineStyle: style.outlineStyle,
      outlineWidthPx: Number.parseFloat(style.outlineWidth),
      widthPx: Math.round(rect.width),
      heightPx: Math.round(rect.height),
    };
  });
  const semantics = { landmarks, tableRoles, links: dom.links, firstTabStop, coverageTables: dom.coverageTables, coverageRows: dom.coverageRows };
  const roles = (wanted) => landmarks.filter((landmark) => landmark.role === wanted);
  const problems = [];
  for (const wanted of ["banner", "main", "contentinfo"]) if (roles(wanted).length !== 1) problems.push(`${roles(wanted).length} ${wanted} landmarks`);
  if (roles("navigation").length !== 1 || roles("navigation")[0].name !== "Report contents") problems.push("navigation landmark missing or not named \"Report contents\"");
  const broken = dom.links.filter((link) => !["h1", "h2", "h3", "main", "section"].includes(link.target ?? ""));
  if (broken.length > 0) problems.push(`in-page links without a heading or section target: ${JSON.stringify(broken)}`);
  if (tableRoles.table !== dom.coverageTables || tableRoles.rowheader !== dom.coverageRows) problems.push(`coverage table semantics lost: ${JSON.stringify(tableRoles)} for ${dom.coverageTables} tables, ${dom.coverageRows} rows`);
  if (!firstTabStop.element.includes("skip-link") || firstTabStop.href !== "#report") problems.push(`first Tab stop is not the skip link: ${firstTabStop.element}`);
  if (firstTabStop.outlineStyle === "none" || firstTabStop.outlineWidthPx < 2) problems.push(`focused skip link has no visible outline: ${JSON.stringify(firstTabStop)}`);
  if (firstTabStop.widthPx < 40 || firstTabStop.heightPx < 16) problems.push(`focused skip link is not visible: ${JSON.stringify(firstTabStop)}`);
  if (problems.length > 0) throw new Error(`${label}: accessibility contract failed: ${problems.join("; ")}`);
  return semantics;
}

/**
 * Viewport-height tiles cut from the SAME decoded pixels as the fingerprinted full-page PNG, so a
 * reviewer can judge a phone or tablet cell screen by screen without any unbound pixel.
 */
function writeViewportTiles(fullPagePath, baseName, viewportHeight) {
  const decoded = PNG.sync.read(readFileSync(fullPagePath), { checkCRC: true });
  const tiles = [];
  for (let index = 0, top = 0; top < decoded.height; index += 1, top += viewportHeight) {
    const height = Math.min(viewportHeight, decoded.height - top);
    const tile = new PNG({ width: decoded.width, height });
    decoded.data.copy(tile.data, 0, top * decoded.width * 4, (top + height) * decoded.width * 4);
    const name = `${baseName}--tile-${String(index + 1).padStart(2, "0")}.png`;
    const path = join(OUTPUT, name);
    writeFileSync(path, PNG.sync.write(tile, { colorType: 6 }));
    tiles.push({ path: name, index: index + 1, top, height, sha256: sha256(path), normalizedRgbaSha256: normalizedScreenPixels(path).normalizedRgbaSha256 });
  }
  return tiles;
}

function writeReviewGallery(artifacts) {
  const escape = (value) => String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/"/gu, "&quot;");
  const sections = REPORT_STATES.filter((state) => artifacts.some((artifact) => artifact.cell.split("/")[1] === state)).map((state) => {
    const screens = artifacts.filter((artifact) => artifact.kind === "screen" && artifact.cell.split("/")[1] === state);
    const raster = artifacts.find((artifact) => artifact.cell === `print/${state}/raster-set`);
    const screenBlocks = screens.map((artifact) => {
      const images = (artifact.tiles.length > 0 ? artifact.tiles : [{ path: artifact.path, index: "full page" }])
        .map((tile) => `<figure><a href="${escape(tile.path)}"><img src="${escape(tile.path)}" alt="${escape(artifact.cell)} ${escape(tile.index)}" loading="lazy"></a><figcaption>${escape(tile.index)}</figcaption></figure>`).join("");
      return `<section class="cell"><h3>${escape(artifact.cell)} <a href="${escape(artifact.path)}">full page</a> <code>${artifact.pixels.normalizedRgbaSha256.slice(0, 12)}</code></h3><div class="strip ${artifact.cell.split("/")[3]}">${images}</div></section>`;
    }).join("\n");
    const pages = raster ? raster.pages.map((page, index) => `<figure><a href="${escape(page.path)}"><img src="${escape(page.path)}" alt="${state} page ${index + 1}" loading="lazy"></a><figcaption>page ${index + 1}</figcaption></figure>`).join("") : "";
    return `<section class="state"><h2>${escape(state)}</h2>${screenBlocks}<section class="cell"><h3>print/${escape(state)} <a href="${escape(`${state}--a4.pdf`)}">PDF</a></h3><div class="strip print">${pages}</div></section></section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>breaklint report-surface review gallery</title>
<style>body{margin:0;padding:1rem 1.5rem;font:14px/1.4 system-ui,sans-serif;background:#ddd;color:#111}h2{margin:2rem 0 .5rem;font-size:1.4rem}h3{font-size:.9rem;margin:1rem 0 .4rem}
.strip{display:flex;gap:.75rem;overflow-x:auto;align-items:flex-start;padding-bottom:.5rem}figure{margin:0;flex:none}figcaption{font-size:.75rem;color:#444}
img{display:block;border:1px solid #999;background:#fff}.desktop img{width:720px}.tablet img{width:384px}.mobile img{width:390px}.print img{width:300px}</style></head>
<body><h1>Report-surface review gallery</h1><p>Every screen cell as viewport-height tiles (tablet and mobile) or its full page (desktop), and every printed page. Tiles are cut from the same decoded pixels as the fingerprinted full-page PNG. Open an image for its natural size; the manifest binds every file.</p>
${sections}</body></html>
`;
  writeFileSync(join(OUTPUT, "review-gallery.html"), html);
  return "review-gallery.html";
}

function assertCoverageTableGeometry(tables, label) {
  if (tables.length === 0) throw new Error(`${label}: no coverage table rendered`);
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.spreadPx === null || column.headerDeltaPx === null || column.spreadPx > 1 || column.headerDeltaPx > 1 ||
        column.bodyAlign.length !== 1) {
        throw new Error(`${label}: coverage column ${column.column} misaligned: ${JSON.stringify(column)}`);
      }
    }
    if (table.overflowingCells.length > 0) throw new Error(`${label}: coverage cells overflow: ${table.overflowingCells.join(", ")}`);
  }
}

function pdfPageWords(pdfPath, page) {
  const xml = run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdfPath, "-"]);
  return [...xml.matchAll(/<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]+)<\/word>/gu)]
    .map((match) => ({ xMin: Number(match[1]), yMin: Number(match[2]), xMax: Number(match[3]), yMax: Number(match[4]), text: match[5] }));
}

/**
 * A printed coverage row, read from the PDF text: a rule id with its result ("… met" or
 * "… floor") on the same baseline. That signature excludes rule ids in finding headings and in the
 * coverage alert, which carry no result on their line.
 */
function coverageRowAnchors(words) {
  return words
    // A rule id is namespace/name, each at least two characters: "n/a" in a value column is not.
    .filter((word) => /^[a-z][a-z0-9]+\/[a-z][a-z0-9-]+$/u.test(word.text))
    .filter((id) => words.some((word) => /^(?:met|floor)$/u.test(word.text) && Math.abs(word.yMin - id.yMin) < 2 && word.xMin > id.xMax))
    .sort((a, b) => a.yMin - b.yMin);
}

/**
 * Outcome-level coverage print checks over the rasterized PDF pages, one pass per page:
 * - every table row is found, and no more (rows cannot silently split or vanish);
 * - every row is closed by its rule: the horizontal rule below the row covers ≥ 98 % of each half of
 *   the table width with no gap longer than two raster rows. This replaced the per-card closed-edge
 *   oracle; a table whose rules drop out in print is as unreadable as a card without its side;
 * - every page carrying rows shows the column header above its first row (a continuation repeats
 *   it), and a continuation — a page with rows but no table caption — carries at least two rows.
 */
function coverageRowChecks(pdfPath, rasterPages, expectedRows, tableEdgesCssPx, label) {
  const minimumEdgeCoverage = 0.98;
  const maximumEdgeGapPx = 2;
  const left = Math.round(PRINT_MARGIN_RASTER_PX + tableEdgesCssPx.left * CSS_TO_RASTER);
  const right = Math.round(PRINT_MARGIN_RASTER_PX + tableEdgesCssPx.right * CSS_TO_RASTER) - 1;
  const middle = Math.round((left + right) / 2);
  const pages = rasterPages.map((raster, pageIndex) => {
    const page = pageIndex + 1;
    const words = pdfPageWords(pdfPath, page);
    const anchors = coverageRowAnchors(words);
    const header = words.some((word) => word.text === "RULE" && words.some((other) => other.text === "RESULT" && Math.abs(other.yMin - word.yMin) < 2 &&
      anchors.length > 0 && word.yMax < anchors[0].yMin));
    const caption = words.some((word) => word.text === "verdict:");
    const decoded = PNG.sync.read(readFileSync(join(OUTPUT, raster.path)), { checkCRC: true });
    const dark = (x, y) => {
      if (y < 0 || y >= decoded.height) return false;
      const offset = (y * decoded.width + x) * 4;
      return decoded.data[offset] < 180 && decoded.data[offset + 1] < 180 && decoded.data[offset + 2] < 180 && decoded.data[offset + 3] > 0;
    };
    const halfStats = (y, from, to) => {
      let hits = 0;
      let gap = 0;
      let maximumGapPx = 0;
      for (let x = from; x <= to; x += 1) {
        if (dark(x, y - 1) || dark(x, y) || dark(x, y + 1)) {
          hits += 1;
          gap = 0;
        } else {
          gap += 1;
          maximumGapPx = Math.max(maximumGapPx, gap);
        }
      }
      return { coverage: Math.round(hits / (to - from + 1) * 1_000) / 1_000, maximumGapPx };
    };
    const rows = anchors.map((anchor, index) => {
      const top = Math.ceil(anchor.yMax * PT_TO_RASTER);
      const bottom = index + 1 < anchors.length ? Math.floor(anchors[index + 1].yMin * PT_TO_RASTER) : top + 30;
      let ruleY = top;
      let best = -1;
      for (let y = top; y < Math.min(bottom, decoded.height); y += 1) {
        let count = 0;
        for (let x = left; x <= right; x += 1) if (dark(x, y)) count += 1;
        if (count > best) {
          best = count;
          ruleY = y;
        }
      }
      const leftStats = halfStats(ruleY, left, middle - 1);
      const rightStats = halfStats(ruleY, middle, right);
      return {
        ruleId: anchor.text,
        ruleY,
        left,
        right,
        leftCoverage: leftStats.coverage,
        leftMaximumGapPx: leftStats.maximumGapPx,
        rightCoverage: rightStats.coverage,
        rightMaximumGapPx: rightStats.maximumGapPx,
      };
    });
    return { page, path: raster.path, rows, header, caption };
  });
  const rows = pages.flatMap((page) => page.rows.map((row) => ({ page: page.page, ...row })));
  // Structure first, then the physical rules: a control that breaks the page structure must fail
  // for that reason, not for the distorted rows a forced break can leave behind.
  if (rows.length !== expectedRows) throw new Error(`${label}: coverage row PDF inventory drift: detected ${rows.length}/${expectedRows}`);
  const withRows = pages.filter((page) => page.rows.length > 0);
  const headerless = withRows.filter((page) => !page.header).map((page) => page.page);
  if (headerless.length > 0) throw new Error(`${label}: continuation page lacks the table header: pages ${headerless.join(", ")}`);
  const continuations = withRows.filter((page) => !page.caption).map((page) => ({ page: page.page, rows: page.rows.length }));
  const underfilled = continuations.filter((continuation) => continuation.rows < 2);
  if (underfilled.length > 0) throw new Error(`${label}: underfilled terminal coverage continuation: ${JSON.stringify(underfilled)}`);
  const open = rows.filter((row) =>
    row.leftCoverage < minimumEdgeCoverage || row.leftMaximumGapPx > maximumEdgeGapPx ||
    row.rightCoverage < minimumEdgeCoverage || row.rightMaximumGapPx > maximumEdgeGapPx);
  if (open.length > 0) throw new Error(`${label}: coverage row rule is open: ${JSON.stringify(open)}`);
  return {
    expectedRows,
    detectedRows: rows.length,
    minimumEdgeCoverage,
    maximumEdgeGapPx,
    pagesWithRows: withRows.map((page) => page.page),
    continuations,
    pages,
  };
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

/** Fill threshold for every non-final printed page, as a share of the A4 content box's height. */
const MINIMUM_PAGE_FILL = 0.6;
/**
 * The tallest unit that may not break, as a share of the content box. The two bounds belong
 * together: when nothing that must stay in one piece is taller than 40 % of a page, a page can end
 * at most 40 % short, so every non-final page fills to 60 %. A unit taller than this leaves a hole
 * the fill gate has to catch after the fact; this names the cause.
 */
const MAXIMUM_UNBREAKABLE_SHARE = 0.4;
const CONTENT_HEIGHT_CSS_PX = (297 - 2 * PRINT_MARGIN_MM) / 25.4 * 96;

/**
 * Fill is measured to the last line of TEXT inside the content box, read from the PDF's own text
 * layer (pdftotext -bbox-layout, in PDF points): the bottom of the lowest text line whose box lies
 * between the 12 mm top and bottom margins, as a share of the content-box height. A split finding
 * repeats its frame (box-decoration-break: clone) and Blink stretches a fragment that breaks to the
 * end of its page, so frame borders and backgrounds reach the page bottom however little text sits
 * inside them; measuring ink counted that empty frame as content (a 44 % hole measured 99.9 %
 * full). The running head and folio live in the margins and are outside the measured band.
 */
function contentBoxTextDepth(pdfPath, page) {
  const xml = run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdfPath, "-"]);
  const height = Number(/<page width="[\d.]+" height="([\d.]+)"/u.exec(xml)?.[1]);
  if (!Number.isFinite(height)) throw new Error(`${pdfPath}: page ${page} has no measurable text layer`);
  const top = PRINT_MARGIN_MM / 25.4 * 72;
  const bottom = height - top;
  let last = top;
  for (const [, yMin, yMax] of xml.matchAll(/<line xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">/gu)) {
    if (Number(yMin) >= top - 1 && Number(yMax) <= bottom + 1) last = Math.max(last, Number(yMax));
  }
  return Math.round((last - top) / (bottom - top) * 1_000) / 1_000;
}

/**
 * Ink depth inside the content box, frames and backgrounds included: recorded beside the text
 * depth so a reader can see how far a stretched frame reaches past its last line. Not a gate.
 */
function contentBoxInkDepth(path) {
  const decoded = PNG.sync.read(readFileSync(path), { checkCRC: true });
  const top = Math.ceil(PRINT_MARGIN_RASTER_PX);
  const bottom = Math.floor(decoded.height - PRINT_MARGIN_RASTER_PX);
  let last = top;
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      if (decoded.data[offset] < 248 || decoded.data[offset + 1] < 248 || decoded.data[offset + 2] < 248) {
        last = y + 1;
        break;
      }
    }
  }
  return Math.round((last - top) / (bottom - top) * 1_000) / 1_000;
}

/**
 * Evaluated in print: the geometry the fill, alignment and keep-with-next checks need.
 * - boxed blocks of the main column (header, contents, summary grid, run facts, alert, checker
 *   card, empty state, finding, coverage table, footer) must share one left and one right edge
 *   within 1 px, and each must be separated from the next by a real gap;
 * - declared forced breaks (a computed break-before of page/left/right/recto/verso) are the only
 *   "deliberate section boundary" a short page may end at, recorded with their first text;
 * - every section heading and table caption is paired with the first text of the unit it
 *   introduces;
 * - the tallest run of content that may not break. A unit is every outermost element whose
 *   computed break-inside is avoid, and every heading outside one; units that share a row (grid
 *   cells) are one unit; and consecutive units glued by a computed break-after: avoid on the first
 *   (or an ancestor it ends) or break-before: avoid on the second (or an ancestor it starts) are
 *   ONE unit, because the browser has to move them together: a section heading, a finding's head
 *   and its first row of facts leave the same hole as one element of their combined height.
 */
function printLayoutInPage() {
  const round = (value) => Math.round(value * 100) / 100;
  const visible = (element) => getComputedStyle(element).display !== "none" && element.getClientRects().length > 0;
  // The first rendered line of an element: innerText separates block-level boxes with newlines,
  // so this is what pdftotext will find on one line.
  const firstText = (element) => ((element?.innerText ?? "").split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).find(Boolean) ?? "").slice(0, 32);
  const forcedBreaks = [...document.querySelectorAll("body *")]
    .filter((element) => ["page", "left", "right", "recto", "verso"].includes(getComputedStyle(element).breakBefore) && visible(element))
    .map((element) => firstText(element));
  const keeps = [];
  for (const heading of document.querySelectorAll("main h2")) {
    if (!visible(heading)) continue;
    let group = heading.closest(".section-heading") ?? heading;
    let next = group.nextElementSibling;
    // A heading group may be wrapped (the findings intro): what it introduces follows the wrapper.
    while (!next && group.parentElement && !group.parentElement.matches("section, main")) {
      group = group.parentElement;
      next = group.nextElementSibling;
    }
    while (next && (!visible(next) || firstText(next) === "")) next = next.nextElementSibling;
    if (next) keeps.push({ heading: heading.textContent.trim(), unit: firstText(next.matches(".coverage-documents") ? next.querySelector("caption") : next) });
  }
  for (const caption of document.querySelectorAll(".coverage-table caption")) {
    const row = caption.closest("table").querySelector("tbody th[scope=row]");
    if (row) keeps.push({ heading: caption.innerText.replace(/\s+/gu, " ").trim(), unit: firstText(row) });
  }

  const avoid = (value) => value === "avoid" || value === "avoid-page";
  const candidates = [...document.querySelectorAll("body *")].filter((element) => visible(element) &&
    (avoid(getComputedStyle(element).breakInside) || /^H[1-3]$/u.test(element.tagName)));
  const units = candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
  const findingNumber = (element) => {
    const item = element.closest(".finding-list > li");
    return item ? String([...item.parentElement.children].indexOf(item) + 1).padStart(2, "0") : "??";
  };
  const name = (element) => {
    const text = (selector) => (element.querySelector(selector)?.textContent ?? "").replace(/\s+/gu, " ").trim();
    if (element.matches(".report-header")) return "report header";
    if (element.matches(".section-heading")) return `section heading "${text("h2")}"`;
    if (element.matches(".findings-intro")) return `findings intro "${text("h2")}"`;
    if (element.matches(".apparatus-section")) return `apparatus section "${text("h2")}"`;
    if (element.matches(".finding-head")) return `finding ${findingNumber(element)} head`;
    if (element.matches(".finding-facts > div")) return `finding ${findingNumber(element)} fact "${text("dt")}"`;
    if (element.matches(".finding-facts")) return `finding ${findingNumber(element)} facts`;
    if (element.matches(".finding-tail")) return `finding ${findingNumber(element)} tail`;
    if (element.matches(".coverage-tail")) return `coverage table tail (${[...element.querySelectorAll("th[scope=row]")].map((cell) => cell.textContent.trim()).join(", ")})`;
    if (element.matches("thead tr")) return "coverage header row";
    if (element.matches("tr")) return `coverage row ${text("th[scope=row]")}`;
    if (element.matches(".summary-grid > div")) return `summary "${text("dt")}"`;
    if (element.matches(".report-footer")) return "report footer";
    if (element.matches(".remediation-caveat")) return "untested-advice caveat";
    if (/^H[1-3]$/u.test(element.tagName)) return `heading "${element.textContent.replace(/\s+/gu, " ").trim().slice(0, 40)}"`;
    return element.classList[0] ?? element.tagName.toLowerCase();
  };
  // A break-after on a box's last child propagates to the box's own end, and a break-before on
  // its first child to its start (CSS Fragmentation 3, 3.1): look down the edge as well as up.
  const gluedAfter = (first, second) => {
    for (let element = first; element && !element.contains(second); element = element.parentElement) {
      if (avoid(getComputedStyle(element).breakAfter)) return true;
    }
    for (let element = first.lastElementChild; element; element = element.lastElementChild) {
      if (avoid(getComputedStyle(element).breakAfter)) return true;
    }
    for (let element = second; element && !element.contains(first); element = element.parentElement) {
      if (avoid(getComputedStyle(element).breakBefore)) return true;
    }
    for (let element = second.firstElementChild; element; element = element.firstElementChild) {
      if (avoid(getComputedStyle(element).breakBefore)) return true;
    }
    return false;
  };
  const chains = [];
  for (const unit of units) {
    const rect = unit.getBoundingClientRect();
    const previous = chains.at(-1);
    const last = previous?.members.at(-1);
    const sameRow = last && Math.abs(last.getBoundingClientRect().top - rect.top) < 1;
    if (previous && (sameRow || gluedAfter(last, unit))) {
      previous.members.push(unit);
      previous.bottom = Math.max(previous.bottom, rect.bottom);
      if (!sameRow) previous.names.push(name(unit));
    } else {
      chains.push({ members: [unit], names: [name(unit)], top: rect.top, bottom: rect.bottom });
    }
  }
  const largest = chains.reduce((best, chain) => (chain.bottom - chain.top > (best ? best.bottom - best.top : -1) ? chain : best), null);
  return {
    forcedBreaks,
    keeps,
    largestUnbreakableUnitPx: round(largest ? largest.bottom - largest.top : 0),
    largestUnbreakableUnit: largest ? largest.names.join(" + ") : null,
  };
}

function boxedBlocksInPage() {
  const round = (value) => Math.round(value * 100) / 100;
  const blocks = [...document.querySelectorAll(".report-header, .report-contents, .summary-grid, .run-facts, .state-alert, .checker-event, .empty-state, .finding, .coverage-table, .report-footer")]
    .filter((element) => getComputedStyle(element).display !== "none" && element.getClientRects().length > 0)
    .map((element) => ({ block: element.classList[0] ?? element.tagName.toLowerCase(), rect: element.getBoundingClientRect() }));
  const lefts = blocks.map((block) => block.rect.left);
  const rights = blocks.map((block) => block.rect.right);
  const gaps = blocks.slice(1).map((block, index) => ({
    after: blocks[index].block,
    before: block.block,
    gapPx: round(block.rect.top - blocks[index].rect.bottom),
  }));
  return {
    blocks: blocks.length,
    leftSpreadPx: round(Math.max(...lefts) - Math.min(...lefts)),
    rightSpreadPx: round(Math.max(...rights) - Math.min(...rights)),
    narrowest: blocks.reduce((best, block) => (block.rect.right < (best?.right ?? Infinity) ? { block: block.block, right: round(block.rect.right) } : best), null),
    smallestGap: gaps.reduce((best, gap) => (gap.gapPx < (best?.gapPx ?? Infinity) ? gap : best), null),
  };
}

const MINIMUM_BLOCK_GAP_PX = 8;

function assertBoxedBlocks(boxes, label) {
  if (boxes.leftSpreadPx > 1 || boxes.rightSpreadPx > 1) {
    throw new Error(`${label}: boxed blocks do not share the column's edges (left spread ${boxes.leftSpreadPx} px, right spread ${boxes.rightSpreadPx} px; narrowest ${JSON.stringify(boxes.narrowest)})`);
  }
  if (boxes.smallestGap && boxes.smallestGap.gapPx < MINIMUM_BLOCK_GAP_PX) {
    throw new Error(`${label}: boxed blocks abut: ${JSON.stringify(boxes.smallestGap)} (minimum gap ${MINIMUM_BLOCK_GAP_PX} px)`);
  }
}

/** The first PDF text line of a finding fragment that does not say which finding it belongs to. */
const BARE_FINDING_CONTINUATION = /^(?:(?:DOCUMENT|SOURCE|MEASURED|THRESHOLD|CALIBRATION|PROOF SOURCE)\b|Remediation\b|Note:|Evidence:|Ambiguity:)/u;

/**
 * Page fill, keep-with-next and unit height, read from the PDF, its rasters and the print layout.
 * - no heading or caption ends up on a different page from the first text of what it introduces;
 * - every non-final page's text reaches MINIMUM_PAGE_FILL of the content box (contentBoxTextDepth),
 *   unless the page after it begins with a declared forced break;
 * - the tallest unbreakable unit, keep-with-next chains included, is at most
 *   MAXIMUM_UNBREAKABLE_SHARE of the content box, and the failure names it.
 * All three are evaluated before anything is thrown, so a red run states every broken bound.
 */
function pageFlowChecks(pdfPath, rasterPages, layout, label) {
  const pageLines = rasterPages.map((_, index) => run("pdftotext", ["-f", String(index + 1), "-l", String(index + 1), "-layout", pdfPath, "-"])
    .split("\n").map((line) => line.replace(/\s+/gu, " ").trim()).filter(Boolean));
  const contentLines = pageLines.map((lines, index) => lines.filter((line) =>
    !/^Page \d+ of \d+$/u.test(line) && !(index > 0 && /^breaklint · /u.test(line))));
  const fill = rasterPages.map((raster, index) => {
    const nextFirst = contentLines[index + 1]?.[0] ?? "";
    const forcedBreakFollows = layout.forcedBreaks.some((text) => text.length > 0 && nextFirst.replace(/\s+/gu, " ").startsWith(text.slice(0, 16)));
    return {
      page: index + 1,
      contentDepth: contentBoxTextDepth(pdfPath, index + 1),
      inkDepth: contentBoxInkDepth(join(OUTPUT, raster.path)),
      final: index === rasterPages.length - 1,
      forcedBreakFollows,
    };
  });
  const locate = (text, from) => {
    for (let page = from.page; page < contentLines.length; page += 1) {
      const start = page === from.page ? from.line + 1 : 0;
      const hit = contentLines[page].findIndex((line, index) => index >= start && line.replace(/\s+/gu, " ").includes(text));
      if (hit >= 0) return { page, line: hit };
    }
    return null;
  };
  // Section headings follow the banner, whose h1 may wrap so that a line reads just "Findings":
  // a heading is searched for from the "Run summary" heading on.
  const bodyStartPage = Math.max(0, contentLines.findIndex((lines) => lines.includes("Run summary")));
  const bodyStartLine = Math.max(0, contentLines[bodyStartPage]?.indexOf("Run summary") ?? 0);
  const keeps = layout.keeps.map((keep) => {
    let heading = null;
    for (let page = bodyStartPage; page < contentLines.length && !heading; page += 1) {
      const line = contentLines[page].findIndex((candidate, index) => (page > bodyStartPage || index >= bodyStartLine) && candidate === keep.heading);
      if (line >= 0) heading = { page, line };
    }
    const unit = heading ? locate(keep.unit.slice(0, 24), heading) : null;
    return { heading: keep.heading, unit: keep.unit, headingPage: heading ? heading.page + 1 : null, unitPage: unit ? unit.page + 1 : null };
  });
  const failures = [];
  // A page that opens inside a finding opens at its tail, and the tail names the finding. A bare
  // fact label or tail line at the top of a page is a fragment nobody can attribute.
  const bareContinuations = contentLines.flatMap((lines, index) =>
    index > 0 && BARE_FINDING_CONTINUATION.test(lines[0] ?? "") ? [{ page: index + 1, firstLine: lines[0] }] : []);
  if (bareContinuations.length > 0) {
    failures.push(`page ${bareContinuations[0].page} starts inside a finding without its "Finding NN" label: ${JSON.stringify(bareContinuations)}`);
  }
  const stranded = keeps.filter((keep) => keep.headingPage === null || keep.unitPage === null || keep.headingPage !== keep.unitPage);
  if (stranded.length > 0) failures.push(`heading stranded from what it introduces: ${JSON.stringify(stranded)}`);
  // Shortest first: the message names the worst page, the list carries every short one.
  const short = fill.filter((page) => !page.final && !page.forcedBreakFollows && page.contentDepth < MINIMUM_PAGE_FILL)
    .sort((left, right) => left.contentDepth - right.contentDepth || left.page - right.page);
  if (short.length > 0) {
    failures.push(`page ${short[0].page} content text depth ${(short[0].contentDepth * 100).toFixed(1)} % is below ${MINIMUM_PAGE_FILL * 100} % ` +
      `(ink incl. frames ${(short[0].inkDepth * 100).toFixed(1)} %): ${JSON.stringify(short)}`);
  }
  const unitLimitPx = Math.round(MAXIMUM_UNBREAKABLE_SHARE * CONTENT_HEIGHT_CSS_PX * 100) / 100;
  if (!(layout.largestUnbreakableUnitPx > 0) || layout.largestUnbreakableUnitPx > unitLimitPx) {
    failures.push(`the tallest unbreakable unit, ${layout.largestUnbreakableUnit}, is ${layout.largestUnbreakableUnitPx} px ` +
      `(${(layout.largestUnbreakableUnitPx / CONTENT_HEIGHT_CSS_PX * 100).toFixed(1)} % of the content box; at most ${MAXIMUM_UNBREAKABLE_SHARE * 100} %, ${unitLimitPx} px)`);
  }
  if (failures.length > 0) throw new Error(`${label}: ${failures.join("; ")}`);
  return {
    minimumPageFill: MINIMUM_PAGE_FILL,
    fill,
    keeps,
    forcedBreaks: layout.forcedBreaks,
    maximumUnbreakableShare: MAXIMUM_UNBREAKABLE_SHARE,
    largestUnbreakableUnitPx: layout.largestUnbreakableUnitPx,
    largestUnbreakableUnit: layout.largestUnbreakableUnit,
  };
}

function pageContentChecks(pdfPath, rasterPages) {
  const pages = rasterPages.map((raster, index) => {
    const page = index + 1;
    const text = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    return {
      page,
      firstToken: text.trim().match(/^\S+/u)?.[0] ?? null,
      nonWhitespaceCharacters: text.replace(/\s/gu, "").length,
      ink: rasterInkBounds(join(OUTPUT, raster.path)),
    };
  });
  const emptyNonCoverPages = pages.filter((page) => page.page > 1 && page.nonWhitespaceCharacters === 0).map((page) => page.page);
  if (emptyNonCoverPages.length > 0) throw new Error(`${pdfPath}: empty non-cover pages ${emptyNonCoverPages.join(", ")}`);
  return { pages, emptyNonCoverPages };
}

/**
 * Page furniture read back from the PDF text: "Page p of N" on every page; from page 2 the running
 * head with the verdict title, exit code and the report's run id; the end mark on the final page,
 * which must also carry at least one line of report content besides the furniture and the end mark.
 */
function pageFurnitureChecks(pdfPath, pageCount, expected, label) {
  const pages = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const text = run("pdftotext", ["-f", String(page), "-l", String(page), "-layout", pdfPath, "-"]);
    const normalized = text.replace(/[ \t]+/gu, " ");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const furniture = (line) => line.includes(`Page ${page} of ${pageCount}`) || line.includes(expected.runningHead) || line.includes(expected.runLabel);
    const endMark = (line) => /End of report|JSON remains the canonical report|^Generated by/u.test(line);
    pages.push({
      page,
      folio: normalized.includes(`Page ${page} of ${pageCount}`),
      runningHead: normalized.includes(expected.runningHead) && normalized.includes(expected.runLabel),
      endMark: normalized.includes("End of report."),
      contentLines: lines.filter((line) => !furniture(line) && !endMark(line)).length,
    });
  }
  const missingFolio = pages.filter((page) => !page.folio).map((page) => page.page);
  if (missingFolio.length > 0) throw new Error(`${label}: page ${missingFolio[0]} lacks "Page ${missingFolio[0]} of ${pageCount}"`);
  const missingHead = pages.filter((page) => page.page >= 2 && !page.runningHead).map((page) => page.page);
  if (missingHead.length > 0) throw new Error(`${label}: page ${missingHead[0]} lacks the running head "${expected.runningHead}" / "${expected.runLabel}"`);
  const final = pages.at(-1);
  if (!final.endMark) throw new Error(`${label}: the final page lacks the end mark`);
  if (pages.slice(0, -1).some((page) => page.endMark)) throw new Error(`${label}: the end mark is not on the final page`);
  if (final.contentLines === 0) throw new Error(`${label}: the final page carries nothing but the end mark`);
  return { expected, pages };
}

async function writePrintArtifacts(page, pdfRelativePath, rasterPrefixRelative, printBackground, label) {
  const pdfPath = join(OUTPUT, pdfRelativePath);
  mkdirSync(dirname(pdfPath), { recursive: true });
  writeFileSync(pdfPath, await page.pdf({ printBackground, preferCSSPageSize: true }));
  const pdfInfo = run("pdfinfo", [pdfPath]);
  const pages = Number(/^Pages:\s+(\d+)$/mu.exec(pdfInfo)?.[1] ?? "0");
  const pageSize = /^Page size:\s+(.+)$/mu.exec(pdfInfo)?.[1] ?? "unknown";
  if (pages < 1 || !/A4|594\.9\d* x 841\.9\d* pts/iu.test(pageSize)) {
    throw new Error(`${label}: unexpected PDF geometry: ${pages} pages, ${pageSize}`);
  }
  run("pdftoppm", ["-png", "-r", String(PRINT_RASTER_DPI), pdfPath, join(OUTPUT, rasterPrefixRelative)]);
  const directory = dirname(join(OUTPUT, rasterPrefixRelative));
  const prefix = `${rasterPrefixRelative.split("/").at(-1)}-`;
  const rasterPaths = readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (rasterPaths.length !== pages) throw new Error(`${label}: rasterized ${rasterPaths.length}/${pages} PDF pages`);
  const rasterPages = rasterPaths.map((name) => {
    const relativePath = join(dirname(rasterPrefixRelative), name).replace(/^\.\//u, "");
    const path = join(OUTPUT, relativePath);
    return { path: relativePath, bytes: readFileSync(path).length, sha256: sha256(path), dimensions: pngDimensions(path) };
  });
  return {
    pdf: { path: pdfRelativePath, bytes: readFileSync(pdfPath).length, sha256: sha256(pdfPath), pages, pageSize },
    pdfPath,
    rasterPages,
  };
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
if (browserVersionResult.status !== 0 || browserVersionResult.stdout.trim().length === 0) {
  throw new Error(`browser version probe failed (${browserVersionResult.status}): ${browserVersionResult.stderr}`);
}
const rasterizerVersion = (popplerVersionResult.stderr || popplerVersionResult.stdout).trim().split("\n")[0];
if (popplerVersionResult.status !== 0 || !/^pdftoppm version\s+\S+/u.test(rasterizerVersion)) {
  throw new Error(`pdftoppm version probe failed (${popplerVersionResult.status}): ${popplerVersionResult.stdout}${popplerVersionResult.stderr}`);
}
// The declared environment binds what decides the pixels; the kernel release and the exact Node
// version are observations recorded beside it (see DECLARED_ENVIRONMENT_FIELDS).
const reviewEnvironment = {
  reviewArtifactContractVersion: REVIEW_ARTIFACT_CONTRACT_VERSION,
  screenPixelContractVersion: SCREEN_PIXEL_CONTRACT_VERSION,
  browser: browserVersionResult.stdout.trim(),
  platform: platform(),
  architecture: arch(),
  nodeMajor: process.versions.node.split(".")[0],
  deviceScaleFactor: 1,
  browserRenderArgs: BROWSER_RENDER_ARGS,
  viewports: VIEWPORTS,
  themes: THEMES,
  print: {
    media: "print",
    format: "A4 from CSS @page",
    rasterDpi: PRINT_RASTER_DPI,
    rasterizer: rasterizerVersion,
    contentViewportCssPx: PRINT_CONTENT_VIEWPORT,
  },
};
const observedEnvironment = { platformRelease: release(), node: process.version };
// Fail before rendering, not after: an unmeasurable environment cannot bind any artifact.
assertReviewEnvironment(reviewEnvironment, "current render environment");
assertObservedEnvironment(observedEnvironment, "current render environment");
const browser = await puppeteer.launch({ executablePath: browserResolution.path, headless: true, args: BROWSER_RENDER_ARGS });
const artifacts = [];
const technicalProbes = [];
try {
  for (const [state, report] of Object.entries(canonicalReportStates())) {
    if (STATE_FILTER !== null && state !== STATE_FILTER) continue;
    const page = await browser.newPage();
    // One CDP session for the page's lifetime: detaching a session resets the page's emulated
    // media (measured: print -> screen), which would silently turn the print checks into screen checks.
    const cdp = await page.createCDPSession();
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    try {
      const html = render(report, "html");
      for (const theme of THEMES) {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
        for (const [viewport, dimensions] of Object.entries(VIEWPORTS)) {
          await page.setViewport({ ...dimensions, deviceScaleFactor: 1 });
          await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
          if (ACTIVE_CONTROL.screen) await page.addStyleTag({ content: ACTIVE_CONTROL.screen });
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
          semantics.coverageTables = await page.evaluate(coverageTableGeometryInPage);
          assertCoverageTableGeometry(semantics.coverageTables, `${state}/${theme}/${viewport}`);
          semantics.identifiers = await page.evaluate(identifierLinesInPage);
          assertIdentifierLines(semantics.identifiers, `${state}/${theme}/${viewport}`, { print: false });
          semantics.boxedBlocks = await page.evaluate(boxedBlocksInPage);
          assertBoxedBlocks(semantics.boxedBlocks, `${state}/${theme}/${viewport}`);
          semantics.remediationCaveat = await page.evaluate(remediationCaveatInPage);
          assertRemediationCaveat(semantics.remediationCaveat, `${state}/${theme}/${viewport}`);
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
          // After the screenshot: the probes touch the DOM (a data attribute, keyboard focus), never
          // the pixels.
          semantics.fonts = await resolvedRoleFonts(page, cdp, `${state}/${theme}/${viewport}`);
          semantics.accessibility = await accessibilitySemantics(page, cdp, `${state}/${theme}/${viewport}`);
          const tiles = viewport === "desktop" ? [] : writeViewportTiles(path, `${state}--${theme}--${viewport}`, dimensions.height);
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
            tiles,
          });
        }
      }

      await page.setViewport({ ...PRINT_CONTENT_VIEWPORT, deviceScaleFactor: 1 });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
      await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMediaType("print");
      if (ACTIVE_CONTROL.print) await page.addStyleTag({ content: ACTIVE_CONTROL.print });
      const printContrast = await measuredContrast(page);
      const printFonts = await resolvedRoleFonts(page, cdp, `print/${state}`);
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
        return {
          trustLabelLines,
          trustValueOverflowPx: Math.round(trustValueOverflowPx * 100) / 100,
          trustSiblingOverlapPx: Math.round(Math.max(0, trustSiblingOverlapPx) * 100) / 100,
          // Content wider than the A4 content box makes Chrome scale the WHOLE printed document
          // down to fit, silently: every page and every measurement below would shrink with it.
          horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        };
      });
      printSemantics.identifiers = await page.evaluate(identifierLinesInPage);
      assertIdentifierLines(printSemantics.identifiers, `print/${state}`, { print: true });
      printSemantics.remediationCaveat = await page.evaluate(remediationCaveatInPage);
      assertRemediationCaveat(printSemantics.remediationCaveat, `print/${state}`);
      printSemantics.layout = await page.evaluate(printLayoutInPage);
      printSemantics.boxedBlocks = await page.evaluate(boxedBlocksInPage);
      assertBoxedBlocks(printSemantics.boxedBlocks, `print/${state}`);
      printSemantics.coverageTables = await page.evaluate(coverageTableGeometryInPage);
      printSemantics.coverageRowCount = printSemantics.coverageTables.reduce((sum, table) => sum + table.rows, 0);
      if (
        printSemantics.trustLabelLines !== 1 ||
        printSemantics.trustValueOverflowPx !== 0 ||
        printSemantics.trustSiblingOverlapPx !== 0 ||
        printSemantics.horizontalOverflowPx !== 0 ||
        printSemantics.coverageTables.some((table) => table.rowBreakInside.some((value) => !["avoid", "avoid-page"].includes(value)))
      ) {
        throw new Error(`${state}: print reflow contract failed: ${JSON.stringify(printSemantics)}`);
      }
      try {
        assertCoverageTableGeometry(printSemantics.coverageTables, `print/${state}`);
      } catch (error) {
        throw new Error(`${state}: print reflow contract failed: ${error.message}`);
      }
      // 13 rules in one table: at most half an A4 content box (1032 CSS px). The cards it replaced
      // took 3.19 content boxes.
      if (printSemantics.coverageTables.some((table) => table.heightPx > CONTENT_HEIGHT_CSS_PX / 2)) {
        throw new Error(`${state}: coverage table taller than half a page: ${JSON.stringify(printSemantics.coverageTables.map((table) => table.heightPx))}`);
      }
      const tableEdges = { left: printSemantics.coverageTables[0].leftPx, right: printSemantics.coverageTables[0].rightPx };
      const printed = await writePrintArtifacts(page, `${state}--a4.pdf`, `${state}--a4-page`, true, state);
      const { pdfPath, rasterPages } = printed;
      const { pages, pageSize } = printed.pdf;
      const pageContent = pageContentChecks(pdfPath, rasterPages);
      pageContent.flow = pageFlowChecks(pdfPath, rasterPages, printSemantics.layout, state);
      const reportTitle = await page.evaluate(() => document.querySelector("h1")?.textContent ?? "");
      pageContent.furniture = pageFurnitureChecks(pdfPath, pages, {
        runningHead: `breaklint · ${reportTitle} · exit ${report.exitCode}`,
        runLabel: `run ${report.runId}`,
      }, state);
      if (state === "clean") {
        // A printed clean report keeps its findings heading and says "0 findings" in words.
        const text = run("pdftotext", ["-layout", pdfPath, "-"]).replace(/\s+/gu, " ");
        pageContent.cleanFindingsStatement = { heading: /\bFindings\b/u.test(text.replace(/Findings \(0\)/gu, "")), zeroFindings: text.includes("0 findings") };
        if (!pageContent.cleanFindingsStatement.heading || !pageContent.cleanFindingsStatement.zeroFindings) {
          throw new Error(`clean: the printed clean report lacks its findings heading or "0 findings": ${JSON.stringify(pageContent.cleanFindingsStatement)}`);
        }
      }
      pageContent.untestedCaveatOccurrences = untestedCaveatOccurrences(pdfPath);
      pageContent.identifierBreaks = pdfIdentifierBreaks(pdfPath, printSemantics.identifiers.filter((identifier) => identifier.kind === "flag").map((identifier) => identifier.text));
      if (pageContent.identifierBreaks.linesEndingInsideAFlag > 0 || pageContent.identifierBreaks.linesEndingInsideARuleId > 0 ||
        pageContent.identifierBreaks.flagsWhole.some((flag) => !flag.whole)) {
        throw new Error(`${state}: the PDF text splits a flag or rule id across lines: ${JSON.stringify(pageContent.identifierBreaks)}`);
      }
      if (pageContent.untestedCaveatOccurrences !== printSemantics.remediationCaveat.statements) {
        throw new Error(`${state}: untested-advice caveat appears ${pageContent.untestedCaveatOccurrences} times in the PDF; it is stated once per report`);
      }
      const rowChecks = coverageRowChecks(pdfPath, rasterPages, printSemantics.coverageRowCount, tableEdges, state);
      if (rowChecks.pagesWithRows.length > 2) {
        throw new Error(`${state}: the coverage table spans ${rowChecks.pagesWithRows.length} pages; 13 rules must fit on at most two`);
      }
      if (state === "insufficient-coverage") {
        // Colour must not be the only carrier of state: with background graphics off the table must
        // still close every row and say "Below floor" in words.
        const probe = await writePrintArtifacts(page, `.technical/${state}--no-background.pdf`, `.technical/${state}--no-background-page`, false, `${state} (no background)`);
        const text = run("pdftotext", ["-layout", probe.pdfPath, "-"]);
        technicalProbes.push({
          id: "print-background-disabled/insufficient-coverage",
          state,
          printBackground: false,
          pdf: probe.pdf,
          rasterPages: probe.rasterPages,
          coverageRowCount: printSemantics.coverageRowCount,
          shortCoverageRowCount: printSemantics.coverageTables.reduce((sum, table) => sum + table.shortRows, 0),
          belowFloorWordsInText: (text.match(/Below floor/gu) ?? []).length,
          rowChecks: coverageRowChecks(probe.pdfPath, probe.rasterPages, printSemantics.coverageRowCount, tableEdges, `${state} (no background)`),
        });
      }
      if (state === "clean") {
        // Thirteen rows fit on one page, so no canonical state has to repeat the header. This probe
        // does: one document with a long coverage table, printed, must repeat the column header on
        // every page that carries rows.
        await page.setContent(render(longCoverageReportState(), "html"), { waitUntil: "load", timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        if (ACTIVE_CONTROL.print) await page.addStyleTag({ content: ACTIVE_CONTROL.print });
        const longTables = await page.evaluate(coverageTableGeometryInPage);
        assertCoverageTableGeometry(longTables, "print/long-coverage-table");
        const longRows = longTables.reduce((sum, table) => sum + table.rows, 0);
        const probe = await writePrintArtifacts(page, ".technical/long-coverage-table.pdf", ".technical/long-coverage-table-page", true, "long coverage table");
        const longChecks = coverageRowChecks(probe.pdfPath, probe.rasterPages, longRows, { left: longTables[0].leftPx, right: longTables[0].rightPx }, "long coverage table");
        if (longChecks.continuations.length === 0) throw new Error("long coverage table: the probe no longer continues onto a second page");
        technicalProbes.push({
          id: "print-long-coverage-table/clean",
          state,
          printBackground: true,
          pdf: probe.pdf,
          rasterPages: probe.rasterPages,
          coverageRowCount: longRows,
          rowChecks: longChecks,
        });
        // The run id reaches a CSS string in the running head, and it is caller-supplied through
        // the API. A hostile one must print as literal text and leave the stylesheet intact.
        const hostile = HOSTILE_RUN_ID;
        const hostileReport = { ...report, runId: hostile };
        await page.setContent(render(hostileReport, "html"), { waitUntil: "load", timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        if (ACTIVE_CONTROL.print) await page.addStyleTag({ content: ACTIVE_CONTROL.print });
        const hostileProbe = await writePrintArtifacts(page, ".technical/hostile-run-id.pdf", ".technical/hostile-run-id-page", true, "hostile run id");
        const shown = [...`run ${hostile}`];
        const expectedLabel = shown.length > 52 ? `${shown.slice(0, 51).join("")}…` : shown.join("");
        const hostileFurniture = pageFurnitureChecks(hostileProbe.pdfPath, hostileProbe.pdf.pages, {
          runningHead: `breaklint · ${await page.evaluate(() => document.querySelector("h1")?.textContent ?? "")} · exit ${report.exitCode}`,
          runLabel: expectedLabel,
        }, "hostile run id");
        if (hostileProbe.pdf.pages !== pages) throw new Error(`hostile run id: the report paginated to ${hostileProbe.pdf.pages} pages instead of ${pages}; the run id altered the layout`);
        technicalProbes.push({
          id: "print-hostile-run-id/clean",
          state,
          printBackground: true,
          runId: hostile,
          expectedRunLabel: expectedLabel,
          pdf: hostileProbe.pdf,
          rasterPages: hostileProbe.rasterPages,
          furniture: hostileFurniture,
        });
        await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      }
      const visiblePrintContract = {
        pages,
        pageSize,
        contrast: printContrast,
        fonts: printFonts,
        printSemantics,
        pageContentChecks: pageContent,
        rowChecks,
        rasterPages: rasterPages.map((page) => ({ sha256: page.sha256, dimensions: page.dimensions })),
      };
      const pdfCell = `print/${state}/pdf`;
      const rasterCell = `print/${state}/raster-set`;
      artifacts.push({
        cell: pdfCell,
        kind: "pdf",
        path: printed.pdf.path,
        bytes: printed.pdf.bytes,
        sha256: printed.pdf.sha256,
        reviewArtifactFingerprint: stableReviewArtifactFingerprint(
          reviewInput.fingerprint,
          reviewEnvironment,
          pdfCell,
          visiblePrintContract,
        ),
        pages,
        pageSize,
        contrast: printContrast,
        fonts: printFonts,
        printSemantics,
        pageContentChecks: pageContent,
        rowChecks,
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
  // The report-surface render manifest carries its own version, independent of the canonical
  // report schema: it moves only when THIS artifact's structure changes. 4 -> 5 because the
  // environment is split into the declared, bound `reviewEnvironment` and the
  // `observedEnvironment` recorded beside it; the verifier pins 5 and rejects a 4 manifest.
  schemaVersion: 5,
  generatedAt: new Date().toISOString(),
  reviewInputContractVersion: 1,
  reviewInputFingerprint: reviewInput.fingerprint,
  reviewInputs: reviewInput.files,
  reviewEnvironment,
  observedEnvironment,
  matrix: "4 states × (2 themes × 3 screen viewports + A4 PDF + A4 raster set) = 32 review cells",
  reviewGallery: writeReviewGallery(artifacts),
  physicalArtifacts: {
    screens: artifacts.filter((artifact) => artifact.kind === "screen").length,
    screenTiles: artifacts.filter((artifact) => artifact.kind === "screen").reduce((sum, artifact) => sum + artifact.tiles.length, 0),
    pdfs: artifacts.filter((artifact) => artifact.kind === "pdf").length,
    rasterPages: artifacts
      .filter((artifact) => artifact.kind === "raster-set")
      .reduce((sum, artifact) => sum + artifact.pages.length, 0),
  },
  // What each font role actually resolved to across every cell of this render, for the reviewer
  // and the ledger: the design a reviewer judges is the one these faces draw, not the CSS stack.
  resolvedFonts: Object.fromEntries(Object.keys(FONT_ROLE_PROBES).map((role) => [
    role,
    [...new Set(artifacts.flatMap((artifact) => (artifact.semantics?.fonts ?? artifact.fonts)?.[role]?.families ?? []))].sort(),
  ])),
  technicalProbes,
  artifacts,
};
writeFileSync(join(OUTPUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`report surfaces: rendered ${artifacts.length} cells to ${OUTPUT}\n`);

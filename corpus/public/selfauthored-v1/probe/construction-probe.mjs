#!/usr/bin/env node
// Independent construction probe for corpus/public/selfauthored-v1.
//
// Purpose: verify the construction facts written into expected/*.expected.json (page counts,
// block heights and fragment counts, heading positions, SVG label insets) in plain Chrome with
// Paged.js alone. It deliberately imports NOTHING from this repository's src/: no collector, no
// rule, no engine, no report code. It uses only puppeteer-core, the pinned Paged.js UMD bundle,
// pngjs for pixel scans and Node built-ins. Its output is evidence about the documents, not
// about breaklint, and it must stay that way: if this file ever imports from ../../../../src,
// the ground truth is no longer independent of the tool.
//
// Usage (Chrome must run as an unprivileged user with its sandbox ON):
//   node construction-probe.mjs --chrome <path-to-chrome> --out <dir> <doc.html> [...]
//
// What it measures, per document:
//   1. natural (unpaginated) heights of every element carrying an `id`, laid out at the width
//      of the page content box the element was paginated into;
//   2. the Paged.js 0.4.3 pagination: pages, page and content boxes, named pages, margin-box
//      text, and every fragment of every `id` element (fragments share a data-probe-id that is
//      stamped onto the source before pagination and survives Paged.js cloning);
//   3. for every SVG <text> with an id: the getBBox() cell box normalised through getScreenCTM()
//      (four corners), the SVG viewport rectangle, the insets on all four edges, the stroke
//      width, and an INK box measured from pixels of an isolated replica of the label;
//   4. headings: space left under them on their page, and whether anything follows them there;
//   5. content that Paged.js left in the overflow column (right of the content box);
//   6. platform fonts actually used for a few representative nodes (CDP, informational);
//   7. the PDF page count and per-page sizes from pdfinfo (poppler), informational.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const { PNG } = require("pngjs");

const args = process.argv.slice(2);
function option(name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
}
const chromePath = option("--chrome");
const outDir = resolve(option("--out") ?? ".");
const inkScale = Number(option("--ink-scale") ?? 2);
const keepPdf = args.includes("--keep-pdf");
if (keepPdf) args.splice(args.indexOf("--keep-pdf"), 1);
const docs = args.map((p) => resolve(p));
if (!chromePath || docs.length === 0) {
  process.stderr.write("usage: construction-probe.mjs --chrome <chrome> --out <dir> <doc.html>...\n");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// The package's "exports" map hides dist/ and package.json; its CommonJS entry is lib/index.cjs.
const pagedRoot = dirname(dirname(require.resolve("pagedjs")));
const pagedPath = join(pagedRoot, "dist", "paged.js");
const pagedSource = readFileSync(pagedPath, "utf8");
const pagedVersion = JSON.parse(readFileSync(join(pagedRoot, "package.json"), "utf8")).version;

// A loopback server that serves exactly one directory tree and nothing else.
function serve(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = readFileSync(file);
      const type = { ".html": "text/html; charset=utf-8", ".css": "text/css" }[extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// ---------------------------------------------------------------------------------------------
// In-page functions (serialised into the page; they must not close over Node scope).

// The clipping viewport of an <svg>. For an outermost inline <svg> that is its border box. For a
// NESTED <svg>, getBoundingClientRect() is not the viewport: measured on Chromium 141 it returns
// the union of the viewport and the content that overflows it. The viewport is the element's
// x / y / width / height in its parent's user space, mapped to the screen by the parent's CTM.
function svgViewport(svg) {
  const parent = svg.parentElement && svg.parentElement.closest("svg");
  if (!parent) {
    const r = svg.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, nested: false };
  }
  const m = svg.parentElement.getScreenCTM();
  const x = svg.x.baseVal.value, y = svg.y.baseVal.value, w = svg.width.baseVal.value, h = svg.height.baseVal.value;
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => ({ x: m.a * px + m.c * py + m.e, y: m.b * px + m.d * py + m.f }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const r = { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  return { ...r, width: r.right - r.x, height: r.bottom - r.y, nested: true };
}

function stampIds() {
  let n = 0;
  for (const el of document.querySelectorAll("[id]")) { el.setAttribute("data-probe-id", el.id); n++; }
  return n;
}

function naturalHeights(width) {
  // Lay the unpaginated document out at `width` CSS px and report border-box heights.
  document.documentElement.style.setProperty("width", width + "px");
  document.body.style.setProperty("width", width + "px");
  document.body.style.setProperty("margin", "0");
  document.body.style.setProperty("padding", "0");
  const out = {};
  for (const el of document.querySelectorAll("[id]")) {
    const r = el.getBoundingClientRect();
    out[el.id] = { width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
  }
  return out;
}

function measurePaginated() {
  const svgViewport = SVG_VIEWPORT_FN;
  const round = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }; };
  const pageEls = [...document.querySelectorAll(".pagedjs_page")];
  const pages = pageEls.map((page, i) => {
    const content = page.querySelector(".pagedjs_page_content");
    const margins = [...page.querySelectorAll(".pagedjs_margin")]
      .map((m) => ({ box: [...m.classList].find((c) => c.startsWith("pagedjs_margin-")) ?? "", text: m.textContent.replace(/\s+/g, " ").trim(), rect: rect(m) }))
      .filter((m) => m.text.length > 0);
    // Pseudo-element content (string-set, counters) is not in textContent; read ::after too.
    const marginPseudo = [...page.querySelectorAll(".pagedjs_margin-content")].map((m) => {
      const after = getComputedStyle(m, "::after").content;
      const before = getComputedStyle(m, "::before").content;
      return { box: [...m.parentElement.classList].find((c) => c.startsWith("pagedjs_margin-")) ?? "", before, after };
    }).filter((m) => (m.after && m.after !== "none" && m.after !== "normal") || (m.before && m.before !== "none" && m.before !== "normal"));
    return {
      pageNumber: i + 1,
      classes: [...page.classList].filter((c) => /named|_page$|left|right|first|blank/.test(c)),
      pageBox: rect(page),
      contentBox: content ? rect(content) : null,
      margins,
      marginPseudo,
    };
  });
  const pageOf = (el) => pageEls.indexOf(el.closest(".pagedjs_page")) + 1;
  const cbOf = (p) => pages[p - 1]?.contentBox;

  // Fragments of every stamped element.
  const byId = {};
  for (const el of document.querySelectorAll("[data-probe-id]")) {
    const id = el.getAttribute("data-probe-id");
    const page = pageOf(el);
    const cs = getComputedStyle(el);
    const r = rect(el);
    const cb = cbOf(page);
    const inMargin = !!el.closest(".pagedjs_margin");
    const entry = byId[id] ?? (byId[id] = {
      tag: el.tagName.toLowerCase(),
      style: {
        breakInside: cs.breakInside, breakBefore: cs.breakBefore, breakAfter: cs.breakAfter,
        columnCount: cs.columnCount, writingMode: cs.writingMode, widows: cs.widows, orphans: cs.orphans,
        lineHeight: cs.lineHeight, fontSize: cs.fontSize, fontFamily: cs.fontFamily, textAlign: cs.textAlign,
        position: cs.position, display: cs.display, overflow: cs.overflow,
        marginLeft: cs.marginLeft, marginRight: cs.marginRight,
      },
      fragments: [],
    });
    entry.fragments.push({
      page,
      inMarginBox: inMargin,
      display: cs.display,
      splitFrom: el.hasAttribute("data-split-from"),
      splitTo: el.hasAttribute("data-split-to"),
      rect: r,
      topInContent: cb ? round(r.y - cb.y) : null,
      bottomGapToContentEnd: cb ? round(cb.y + cb.height - (r.y + r.height)) : null,
      leftInset: cb ? round(r.x - cb.x) : null,
      rightInset: cb ? round(cb.x + cb.width - (r.x + r.width)) : null,
      startsInsideContentBox: cb ? (r.y >= cb.y - 1 && r.y <= cb.y + cb.height + 1 && r.x >= cb.x - 1 && r.x <= cb.x + cb.width + 1) : null,
      classes: [...el.classList].filter((c) => c.startsWith("pagedjs")),
    });
  }
  for (const entry of Object.values(byId)) {
    const flow = entry.fragments.filter((f) => !f.inMarginBox && f.display !== "none");
    entry.flowFragments = flow.length;
    entry.flowHeightSum = round(flow.reduce((s, f) => s + f.rect.height, 0));
    entry.marginBoxCopies = entry.fragments.filter((f) => f.inMarginBox).length;
    entry.pages = [...new Set(flow.map((f) => f.page))];
  }

  // Line boxes of every paragraph fragment with an id, from text-node ranges grouped by top edge:
  // the number of lines, and the width of the last line against the paragraph width.
  for (const el of document.querySelectorAll(".pagedjs_page_content p[data-probe-id]")) {
    const groups = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        const g = groups.find((x) => Math.abs(x.top - r.top) <= 0.5);
        if (g) { g.left = Math.min(g.left, r.left); g.right = Math.max(g.right, r.right); }
        else groups.push({ top: r.top, left: r.left, right: r.right });
      }
    }
    groups.sort((a, b) => a.top - b.top);
    const id = el.getAttribute("data-probe-id");
    const entry = byId[id];
    const frag = entry && entry.fragments.find((f) => f.rect.y === round(el.getBoundingClientRect().y) && !f.inMarginBox);
    if (frag && groups.length) {
      const last = groups[groups.length - 1];
      frag.lines = { count: groups.length, lastLineWidth: round(last.right - last.left), fontSizePx: parseFloat(getComputedStyle(el).fontSize) };
    }
  }

  // Headings: remaining space and following content on the same page.
  const headings = {};
  for (const h of document.querySelectorAll(".pagedjs_page_content :is(h1,h2,h3,h4,h5,h6)[data-probe-id]")) {
    const id = h.getAttribute("data-probe-id");
    if (h.hasAttribute("data-split-from")) continue;
    const page = pageOf(h);
    const cb = cbOf(page);
    const hr = h.getBoundingClientRect();
    const cs = getComputedStyle(h);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const content = h.closest(".pagedjs_page_content");
    let following = 0; const followingSample = [];
    for (const el of content.querySelectorAll("[data-ref]")) {
      if (el === h || el.contains(h) || h.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.y >= hr.bottom - 0.5) { following++; if (followingSample.length < 3) followingSample.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")); }
    }
    headings[id] = {
      page, bottom: round(hr.bottom), contentBottom: cb ? round(cb.y + cb.height) : null,
      remainingPx: cb ? round(cb.y + cb.height - hr.bottom) : null, lineHeightPx: round(lh),
      remainingLineHeights: cb ? round((cb.y + cb.height - hr.bottom) / lh) : null,
      followingOnPage: following, followingSample,
    };
  }

  // SVG text geometry: cell box through getScreenCTM (4 corners) against the SVG viewport.
  const svgTexts = [];
  for (const t of document.querySelectorAll("svg text")) {
    const svg = t.parentElement.closest("svg");
    if (!svg) continue;
    const page = pageOf(t);
    const vp = svgViewport(svg);
    let box = null;
    try {
      const b = t.getBBox();
      const m = t.getScreenCTM();
      const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      box = { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys), scale: Math.hypot(m.a, m.b) };
    } catch { box = null; }
    const cs = getComputedStyle(t);
    const svgCs = getComputedStyle(svg);
    const sw = parseFloat(cs.strokeWidth) || 0;
    const strokeVisible = cs.stroke !== "none" && sw > 0 && parseFloat(cs.strokeOpacity || "1") > 0;
    const insets = box ? {
      left: round(box.x - vp.x), top: round(box.y - vp.y),
      right: round(vp.right - box.right), bottom: round(vp.bottom - box.bottom),
    } : null;
    svgTexts.push({
      id: t.id || null,
      svgId: svg.id || null,
      page,
      inMarginBox: !!t.closest(".pagedjs_margin"),
      text: t.textContent.replace(/\s+/g, " ").trim(),
      viewport: { x: round(vp.x), y: round(vp.y), width: round(vp.width), height: round(vp.height), nested: vp.nested },
      svgOverflow: svgCs.overflow,
      cellBox: box ? { x: round(box.x), y: round(box.y), width: round(box.right - box.x), height: round(box.bottom - box.y) } : null,
      cellInsets: insets,
      cellMinInset: insets ? Math.min(insets.left, insets.top, insets.right, insets.bottom) : null,
      stroke: strokeVisible ? { color: cs.stroke, widthUser: sw, widthScreen: round(sw * (box?.scale ?? 1)), paintOrder: cs.paintOrder } : null,
      fontFamily: cs.fontFamily, fontSize: cs.fontSize,
    });
  }

  // <use> instances with an id: their instance tree is closed, so they are measured by the use
  // element's own getBBox() through its CTM.
  const useTargets = [];
  for (const u of document.querySelectorAll(".pagedjs_page_content svg use[id]")) {
    const svg = u.parentElement.closest("svg");
    const vp = svgViewport(svg);
    const b = u.getBBox();
    const m = u.getScreenCTM();
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    useTargets.push({ id: u.id, svgId: svg.id || null, page: pageOf(u), href: u.getAttribute("href") || u.getAttribute("xlink:href"),
      insets: { left: round(Math.min(...xs) - vp.x), top: round(Math.min(...ys) - vp.y), right: round(vp.right - Math.max(...xs)), bottom: round(vp.bottom - Math.max(...ys)) } });
  }

  // Content left in the overflow column (to the right of the content box) of a page. Every client
  // rect of every element and every text-node range is checked, because a box that Paged.js left
  // partly in the overflow column still starts inside the content box.
  const residue = [];
  pageEls.forEach((page, i) => {
    const content = page.querySelector(".pagedjs_page_content");
    if (!content) return;
    const cb = content.getBoundingClientRect();
    const seen = new Set();
    const note = (el, kind, r) => {
      const key = kind + ":" + (el.getAttribute?.("data-probe-id") ?? el.tagName);
      if (seen.has(key)) return;
      seen.add(key);
      residue.push({ page: i + 1, kind, tag: el.tagName?.toLowerCase() ?? "#text", id: el.getAttribute?.("data-probe-id") ?? null, cls: el.getAttribute?.("class") ?? null, text: (el.textContent ?? "").trim().slice(0, 40), left: round(r.left - cb.right), width: round(r.width), height: round(r.height) });
    };
    const inOverflow = (r) => r.width > 0 && r.height > 0 && r.left >= cb.right + 1;
    for (const el of content.querySelectorAll("*")) {
      if (el.parentElement && el.parentElement.closest("svg")) continue; // SVG internals are not flow
      // A box counts only if it is a replaced/table box or carries its own non-blank text in the
      // overflow column; a wrapper whose only overflow fragment is a carried-over margin is noted
      // as "margin-only" so that it cannot be mistaken for content.
      const rects = [...el.getClientRects()].filter(inOverflow);
      if (rects.length === 0) continue;
      const replaced = /^(IMG|SVG|CANVAS|VIDEO|TABLE|TR|TD|TH|IFRAME|OBJECT)$/i.test(el.tagName);
      const childInOverflow = [...el.children].some((c) => [...c.getClientRects()].some(inOverflow));
      if (replaced) note(el, "box", rects[0]);
      else if (!childInOverflow) note(el, "margin-only", rects[0]);
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(t);
      if (![...range.getClientRects()].some(inOverflow)) continue;
      if (t.parentElement && t.parentElement.closest("svg")) continue; // SVG text is measured separately
      let visible = false;
      const text = t.textContent;
      for (let k = 0; k < text.length && !visible; k++) {
        if (/\s/.test(text[k])) continue;
        const cr = document.createRange();
        cr.setStart(t, k); cr.setEnd(t, k + 1);
        visible = [...cr.getClientRects()].some(inOverflow);
      }
      const r = [...range.getClientRects()].find(inOverflow);
      note(t.parentElement, visible ? "text" : "whitespace", r);
    }
  });

  const hyphenated = [...document.querySelectorAll(".pagedjs_hyphen")].map((el) => ({ page: pageOf(el), tag: el.tagName.toLowerCase(), id: el.getAttribute("data-probe-id") }));
  return { pages, elements: byId, headings, svgTexts, useTargets, residue, hyphenated };
}

// Serialise each SVG root with every text-relevant computed property inlined, so that an isolated
// replica renders the same glyphs in a blank page. Returns one record per <svg> in page content.
function svgReplicas() {
  const svgViewport = SVG_VIEWPORT_FN;
  const props = ["font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant",
    "letter-spacing", "word-spacing", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-linejoin", "paint-order", "text-anchor", "dominant-baseline", "alignment-baseline",
    "baseline-shift", "writing-mode", "direction", "opacity", "visibility", "display", "transform"];
  const out = [];
  let index = 0;
  // One replica per <svg>, nested ones included, each rendered as its own root: a label is
  // measured against the viewport of its NEAREST svg, which is the one that clips it.
  for (const svg of document.querySelectorAll(".pagedjs_page_content svg")) {
    const vp = svgViewport(svg);
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll("*")];
    const dst = [clone, ...clone.querySelectorAll("*")];
    src.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const style = props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
      dst[i].setAttribute("style", style);
    });
    // A nested svg keeps its x/y placement attributes; as a root they would be ignored anyway.
    clone.setAttribute("width", String(vp.width));
    clone.setAttribute("height", String(vp.height));
    clone.style.setProperty("overflow", "visible");
    clone.style.setProperty("position", "absolute");
    clone.style.setProperty("display", "block");
    clone.style.removeProperty("transform");
    clone.removeAttribute("class");
    const own = [...svg.querySelectorAll("text")].filter((t) => t.parentElement.closest("svg") === svg).map((t) => t.id).filter(Boolean);
    out.push({ index: index++, svgId: svg.id || null, width: vp.width, height: vp.height, markup: clone.outerHTML, texts: own });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

// In-page functions are serialised; splice the viewport helper into their source.
function withViewport(fn) {
  return `(${fn.toString().replace("SVG_VIEWPORT_FN", svgViewport.toString())})()`;
}

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

async function inkScan(browser, replicas) {
  // Render each SVG replica alone on white, show one label at a time, and take the bounding box
  // of non-white pixels. This is an ink measurement independent of getBBox().
  const M = 160; // free margin around the viewport, CSS px
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1400, deviceScaleFactor: inkScale });
  const result = {};
  for (const rep of replicas) {
    if (rep.texts.length === 0) continue;
    const w = Math.ceil(rep.width + 2 * M), h = Math.ceil(rep.height + 2 * M);
    await page.setViewport({ width: Math.max(w, 200), height: Math.max(h, 200), deviceScaleFactor: inkScale });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:#fff}</style></head><body>${rep.markup}</body></html>`);
    await page.evaluate((m) => { const s = document.querySelector("svg"); s.style.left = m + "px"; s.style.top = m + "px"; }, M);
    for (const id of rep.texts) {
      // Pass 1 measures FILL ink: the label alone, fill forced to black, stroke removed. Pass 2,
      // for a label that paints a stroke (a halo), measures fill plus stroke, both forced black:
      // that is the painted extent a white halo covers on the page.
      const passes = [["fill", false]];
      const stroked = await page.evaluate((target) => {
        const t = document.querySelector("svg").querySelector(`[id="${target}"]`);
        const cs = getComputedStyle(t);
        return cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0;
      }, id);
      if (stroked) passes.push(["painted", true]);
      const record = {};
      for (const [name, withStroke] of passes) {
        await page.evaluate((target, keepStroke) => {
          const s = document.querySelector("svg");
          for (const el of s.querySelectorAll("*")) el.style.setProperty("visibility", "hidden");
          const t = s.querySelector(`[id="${target}"]`);
          for (const el of [t, ...t.querySelectorAll("*")]) {
            el.style.setProperty("visibility", "visible");
            el.style.setProperty("fill", "#000");
            el.style.setProperty("fill-opacity", "1");
            if (keepStroke) { el.style.setProperty("stroke", "#000"); el.style.setProperty("stroke-opacity", "1"); }
            else el.style.setProperty("stroke", "none");
          }
        }, id, withStroke);
        const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h }, omitBackground: false }));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
          const o = (y * png.width + x) * 4;
          if (png.data[o] < 245 || png.data[o + 1] < 245 || png.data[o + 2] < 245) {
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        if (!Number.isFinite(minX)) { record[name] = null; continue; }
        const sc = inkScale;
        const ink = { x: minX / sc - M, y: minY / sc - M, right: (maxX + 1) / sc - M, bottom: (maxY + 1) / sc - M };
        const r2 = (v) => Math.round(v * 100) / 100;
        record[name] = {
          box: { x: r2(ink.x), y: r2(ink.y), width: r2(ink.right - ink.x), height: r2(ink.bottom - ink.y) },
          insets: { left: r2(ink.x), top: r2(ink.y), right: r2(rep.width - ink.right), bottom: r2(rep.height - ink.bottom) },
        };
      }
      result[id] = {
        inkBoxInViewport: record.fill?.box ?? null,
        inkInsets: record.fill?.insets ?? null,
        ...(record.painted ? { paintedInkBoxInViewport: record.painted.box, paintedInkInsets: record.painted.insets } : {}),
      };
    }
  }
  await page.close();
  return result;
}

async function platformFonts(page) {
  const client = await page.createCDPSession();
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument", { depth: -1 });
  const selectors = [".pagedjs_page_content p", ".pagedjs_page_content h1", ".pagedjs_page_content h2",
    ".pagedjs_page_content pre", ".pagedjs_page_content code", ".pagedjs_page_content td",
    ".pagedjs_page_content svg text", ".pagedjs_margin-content"];
  const out = {};
  for (const selector of selectors) {
    try {
      const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (!nodeId) continue;
      const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId });
      out[selector] = fonts.map((f) => `${f.familyName} (${f.isCustomFont ? "custom" : "system"}, ${f.glyphCount} glyphs)`);
    } catch { /* selector absent */ }
  }
  await client.detach();
  return out;
}

function pdfPages(file) {
  const run = spawnSync("pdfinfo", ["-f", "1", "-l", "9999", file], { encoding: "utf8" });
  if (run.status !== 0) return { error: run.stderr.trim() };
  const sizes = [...run.stdout.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)].map((m) => ({ page: +m[1], widthPt: +m[2], heightPt: +m[3] }));
  const count = Number(/^Pages:\s+(\d+)/m.exec(run.stdout)?.[1] ?? NaN);
  return { count, sizes };
}

async function probeDocument(browser, origin, root, file, work) {
  const rel = file.slice(root.length + 1).split(sep).join("/");
  const url = `${origin}/${rel}`;
  const bytes = readFileSync(file);
  const page = await browser.newPage();
  const consoleWarnings = [];
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") consoleWarnings.push(m.text().slice(0, 200)); });
  const blocked = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().startsWith(origin + "/") || req.url().startsWith("data:")) req.continue();
    else { blocked.push(req.url().slice(0, 120)); req.abort(); }
  });
  await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(stampIds);
  await page.addScriptTag({ content: pagedSource });
  const t0 = Date.now();
  const err = await page.evaluate(async () => { try { await new window.Paged.Previewer().preview(); return null; } catch (e) { return String(e); } });
  const paginationMs = Date.now() - t0;
  const measured = await page.evaluate(withViewport(measurePaginated));
  const fonts = await platformFonts(page);
  const replicas = await page.evaluate(withViewport(svgReplicas));
  const pdfFile = join(keepPdf ? outDir : work, basename(file, ".html") + ".pdf");
  writeFileSync(pdfFile, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  const pdf = pdfPages(pdfFile);
  await page.close();

  const ink = await inkScan(browser, replicas);
  for (const t of measured.svgTexts) if (t.id && ink[t.id] && !t.inMarginBox) Object.assign(t, ink[t.id]);

  // Natural heights: reload WITHOUT Paged.js and lay the flow out at each content width in use.
  const widths = new Map();
  for (const [id, entry] of Object.entries(measured.elements)) {
    const f = entry.fragments.find((x) => !x.inMarginBox && x.display !== "none") ?? entry.fragments[0];
    const cb = measured.pages[f.page - 1]?.contentBox;
    if (!cb) continue;
    const key = cb.width;
    if (!widths.has(key)) widths.set(key, []);
    widths.get(key).push(id);
  }
  const natural = {};
  for (const [width, ids] of widths) {
    const p2 = await browser.newPage();
    await p2.setRequestInterception(true);
    p2.on("request", (req) => (req.url().startsWith(origin + "/") ? req.continue() : req.abort()));
    await p2.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
    await p2.goto(url, { waitUntil: "networkidle0" });
    const h = await p2.evaluate(naturalHeights, width);
    for (const id of ids) if (h[id]) natural[id] = { ...h[id], atWidth: width };
    await p2.close();
  }
  for (const [id, entry] of Object.entries(measured.elements)) entry.natural = natural[id] ?? null;

  return {
    document: rel,
    sha256: sha256(bytes),
    byteLength: bytes.length,
    paginationError: err,
    paginationMs,
    pageCount: measured.pages.length,
    pdf,
    blockedRequests: blocked,
    consoleWarnings,
    fonts,
    ...measured,
  };
}

const profile = mkdtempSync(join(tmpdir(), "k1-probe-profile-"));
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  args: ["--no-first-run", "--no-default-browser-check", "--font-render-hinting=none"],
});
const work = mkdtempSync(join(tmpdir(), "k1-probe-work-"));
try {
  const version = await browser.version();
  const root = dirname(docs[0]);
  for (const d of docs) if (dirname(d) !== root) throw new Error("all documents must share one directory");
  const server = await serve(root);
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const file of docs) {
    const result = await probeDocument(browser, origin, root, file, work);
    const record = { probe: "selfauthored-v1/construction-probe", browser: version, pagedjs: pagedVersion, inkScale, measuredAt: new Date().toISOString(), ...result };
    writeFileSync(join(outDir, basename(file, ".html") + ".probe.json"), JSON.stringify(record, null, 2) + "\n");
    process.stdout.write(`${basename(file)}: ${result.pageCount} pages (pdf ${result.pdf.count}); residue ${result.residue.length}; err ${result.paginationError}\n`);
  }
  server.close();
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}

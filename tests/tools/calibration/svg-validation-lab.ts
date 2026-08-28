#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import {
  cleanupBrowserProfile,
  closeBrowserBounded,
} from "../../../src/acquire/render-run.ts";
import {
  launchBrowser,
  resolvePackageRoot,
  type PageLike,
} from "../../../src/acquire/browser.ts";
import type { Rule } from "../../../src/core/rule.ts";
import type { Box, SvgRecord } from "../../../src/core/types.ts";
import { textClipped } from "../../../src/rules/svg/text-clipped.ts";
import { textInkCollision } from "../../../src/rules/svg/text-ink-collision.ts";
import { textOverflowsViewport } from "../../../src/rules/svg/text-overflows-viewport.ts";
import { loadCorpus } from "../../fixtures/corpus.ts";
import {
  CLIP_FIXTURES,
  COLLISION_FIXTURES,
  GRAZING_SAMPLING_FIXTURE,
  VIEWPORT_FIXTURES,
  type ClipFixture,
  type CollisionFixture,
  type ViewportFixture,
} from "../../fixtures/svg-validation/fixtures.ts";
import { NORMATIVE_CLIP_FIXTURE_CONTRACT_V1, NORMATIVE_CLIP_FIXTURE_IDS_V1 } from "../../fixtures/svg-validation/contract-v1.ts";
import {
  canonicalJson,
  contentDerivedRendererId,
  rendererContentHash,
  type DocumentEntry,
} from "./readiness-validator.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEVICE_SCALE_FACTOR = 2;
const CHANNEL_DELTA = 8;
const CONTRACT_CLIP_THRESHOLD = 0.05;
const CONTRACT_COLLISION_THRESHOLD = 8;
const CONTRACT_VIEWPORT_BOUNDARY = 0;
const VIEWPORT_WIDTH = 480;
const VIEWPORT_HEIGHT = 240;

interface ScreenshotPage extends PageLike {
  screenshot(options: { clip: { x: number; y: number; width: number; height: number } }): Promise<Uint8Array>;
  emulateTimezone?(timezone: string): Promise<void>;
  emulateMediaFeatures?(features: { name: string; value: string }[]): Promise<void>;
  setRequestInterception(value: boolean): Promise<void>;
  on(event: "request", listener: (request: { url(): string; continue(): Promise<void>; abort(): Promise<void> }) => void): void;
}

let measuredExternalRequests = 0;

interface InkMask {
  bits: Uint8Array;
  count: number;
  width: number;
  height: number;
  rightEdge: number;
}

interface PassResult {
  png: Buffer;
  sha256: string;
  geometry: string;
}

interface MeasuredPass {
  ink: InkMask;
  sha256: string;
  geometry: string;
}

export interface LabCheck {
  id: string;
  passed: boolean;
  observed: unknown;
  expected: string;
}

export interface SvgValidationLabReport {
  contractVersion: 1;
  reportSchemaVersion: 1;
  status: "pass" | "fail";
  rendererIdentityComplete: boolean;
  renderer: Record<string, unknown>;
  oracleContract: {
    independentGroundTruthSources: string[];
    prohibitedSources: string[];
    productionOutputsUsedForGroundTruth: false;
  };
  layers: string[];
  clipFixtures: unknown[];
  collisionFixtures: unknown[];
  grazingSamplingCounterexample: unknown;
  viewportFixtures: unknown[];
  checks: LabCheck[];
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type RepositorySourceIdentity =
  | { mode: "clean-commit"; commit: string }
  | {
    mode: "dirty-source-bundle";
    baseCommit: string;
    gitDiffSha256: string;
    sourceTreeSha256: string;
    sourceBundleSha256: string;
    sourceScope: {
      inclusion: "git-tracked-and-untracked-nonignored";
      exclusion: "gitignored-and-generated-outputs";
    };
  };

function gitText(repositoryRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
}

export function repositorySourceIdentity(repositoryRoot = ROOT): RepositorySourceIdentity {
  const baseCommit = gitText(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const status = gitText(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length === 0) return { mode: "clean-commit", commit: baseCommit };

  const paths = gitText(repositoryRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
  const entries = paths.map((path) => {
    const absolute = join(repositoryRoot, path);
    if (!existsSync(absolute)) return { path, kind: "deleted", mode: 0, sha256: sha256("deleted"), size: 0 };
    const stat = lstatSync(absolute);
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute), "utf8") : readFileSync(absolute);
    return {
      path,
      kind: stat.isSymbolicLink() ? "symlink" : "file",
      mode: stat.mode & 0o777,
      sha256: sha256(bytes),
      size: bytes.length,
    };
  });
  const untracked = new Set(gitText(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean));
  const untrackedEntries = entries.filter((entry) => untracked.has(entry.path));
  const diff = execFileSync("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], { cwd: repositoryRoot });
  return {
    mode: "dirty-source-bundle",
    baseCommit,
    gitDiffSha256: sha256(Buffer.concat([
      Buffer.from("git-diff-v1\0", "utf8"),
      diff,
      Buffer.from(`\0untracked\0${canonicalJson(untrackedEntries)}`, "utf8"),
    ])),
    sourceTreeSha256: sha256(`source-tree-v1\0${canonicalJson(entries)}`),
    sourceBundleSha256: sha256(`source-bundle-v1\0${canonicalJson(entries.map(({ path, kind, sha256: digest, size }) => ({ path, kind, sha256: digest, size })))}`),
    sourceScope: {
      inclusion: "git-tracked-and-untracked-nonignored",
      exclusion: "gitignored-and-generated-outputs",
    },
  };
}

function packageIdentity(name: string): { version: string; packageJsonSha256: string; root: string } {
  const root = resolvePackageRoot(name, ROOT);
  if (!root) throw new Error(`${name} is not resolvable from the repository`);
  const packageJson = readFileSync(join(root, "package.json"));
  const parsed = JSON.parse(packageJson.toString("utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`${name} has no readable version`);
  }
  return { version: parsed.version, packageJsonSha256: sha256(packageJson), root };
}

function fontIdentity(): { family: string; resolvedId: string; sha256: string } | null {
  try {
    const output = execFileSync("fc-match", ["-f", "%{file}\n%{family}\n", "Arial"], { encoding: "utf8" });
    const [file, family] = output.trim().split("\n");
    if (!file || !family) return null;
    return { family, resolvedId: basename(file), sha256: sha256(readFileSync(file)) };
  } catch {
    return null;
  }
}

async function runGrazingSamplingCounterexample(
  browser: { newPage(): Promise<PageLike> },
  pagedjs: string,
): Promise<unknown> {
  const fixture = GRAZING_SAMPLING_FIXTURE;
  const author = authorDocument(fixture.svg);
  const page = await preparePage(browser, pagedDocument(author, pagedjs));
  try {
    const observation = await page.evaluate<{
      textBox: { x: number; y: number; width: number; height: number };
      strokeWidth: string;
      samples4px: number;
      samples025px: number;
    }>(`(() => {
      const svg = document.querySelector(".pagedjs_page #lab-svg");
      const text = svg.querySelector("#${fixture.targetId}");
      const line = svg.querySelector("#${fixture.shapeId}");
      const box = text.getBBox();
      const point = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p; };
      const count = (step) => {
        let hits = 0;
        for (let x = box.x; x <= box.x + box.width; x += step) {
          for (let y = box.y; y <= box.y + box.height; y += step) {
            if (line.isPointInStroke(point(x, y))) hits += 1;
          }
        }
        return hits;
      };
      return {
        textBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        strokeWidth: getComputedStyle(line).strokeWidth,
        samples4px: count(4),
        samples025px: count(0.25),
      };
    })()`);
    return {
      fixtureId: fixture.id,
      artifact: { sha256: sha256(author), mediaType: "text/html", synthetic: true },
      renderObservation: observation,
      independentGroundTruth: {
        label: "sampling-grid-counterexample",
        evidenceKinds: ["authored-svg-semantics", "independent-render-geometry"],
        rationale: fixture.rationale,
      },
      breaklintMeasurement: null,
      productionDecision: null,
      blindAnnotations: [],
      adjudication: null,
      evaluation: { syntheticOnly: true, eligibleRealDocument: false },
    };
  } finally {
    await page.close();
  }
}

function authorDocument(svg: string, attributes = `width="400" height="140" viewBox="0 0 400 140"`): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page { size: 440px 180px; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
svg { display: block; margin: 0; background: #fff; font-family: Arial, sans-serif; fill: #000; }
</style></head><body><svg id="lab-svg" ${attributes}>${svg}</svg></body></html>`;
}

function pagedDocument(author: string, pagedjs: string): string {
  const insertion = author.lastIndexOf("</body>");
  const harness = `<script>window.PagedConfig={auto:false};</script><script>${pagedjs}</script>`;
  if (insertion < 0) throw new Error("synthetic author document has no body end tag");
  return `${author.slice(0, insertion)}${harness}${author.slice(insertion)}`;
}

function differenceMask(pass: Buffer, empty: Buffer): InkMask {
  const actual = PNG.sync.read(pass);
  const basis = PNG.sync.read(empty);
  if (actual.width !== basis.width || actual.height !== basis.height) {
    throw new Error("pass and empty raster dimensions differ");
  }
  const bits = new Uint8Array(actual.width * actual.height);
  let count = 0;
  let rightEdge = -1;
  for (let pixel = 0; pixel < bits.length; pixel += 1) {
    const offset = pixel * 4;
    const carriesInk = [0, 1, 2].some(
      (channel) => Math.abs(actual.data[offset + channel]! - basis.data[offset + channel]!) > CHANNEL_DELTA,
    );
    if (!carriesInk) continue;
    bits[pixel] = 1;
    count += 1;
    rightEdge = Math.max(rightEdge, pixel % actual.width);
  }
  return { bits, count, width: actual.width, height: actual.height, rightEdge };
}

function intersection(left: InkMask, right: InkMask): number {
  if (left.bits.length !== right.bits.length) throw new Error("mask sizes differ");
  let count = 0;
  for (let i = 0; i < left.bits.length; i += 1) if (left.bits[i] && right.bits[i]) count += 1;
  return count;
}

function missingFromFull(text: InkMask, full: InkMask): number {
  if (text.bits.length !== full.bits.length) throw new Error("mask sizes differ");
  let count = 0;
  for (let i = 0; i < text.bits.length; i += 1) if (text.bits[i] && !full.bits[i]) count += 1;
  return count;
}

function ratio(t: InkMask, t0: InkMask): number | null {
  return t0.count === 0 ? null : Number(((t0.count - t.count) / t0.count).toFixed(4));
}

function productionRuleDecision(rule: Rule, svg: SvgRecord): "finding" | "clean" | "declined" {
  const template = loadCorpus()[0];
  if (!template) throw new Error("product corpus cannot supply a snapshot shell");
  const snapshot = structuredClone(template.snapshot);
  snapshot.svg = [svg];
  snapshot.blocks = [{ ...snapshot.blocks[0]!, nodeKey: svg.nodeKey, box: svg.viewportScreen, page: 1 }];
  const result = rule.run(snapshot, {
    documentPath: "m3-validation-lab://synthetic",
    options: rule.defaultOptions,
    fingerprint: ({ ruleId, key }) => sha256(`${ruleId}\0${key}`),
  });
  if (result.notMeasured.length > 0) return "declined";
  return result.findings.length > 0 ? "finding" : "clean";
}

function box(x = 0, y = 0, width = 400, height = 140): Box {
  return { x, y, width, height };
}

function svgRecord(target: {
  id: string;
  box?: Box;
  clipState?: "none" | "clip-path" | "mask" | "both";
  t: InkMask;
  t0?: InkMask;
  collisionInk?: number;
  occludedInk?: number;
}, viewport = box(), overflow = "hidden"): SvgRecord {
  const t0 = target.t0 ?? target.t;
  return {
    nodeKey: "lab-svg-node",
    page: 1,
    sourceKey: "lab-svg-source",
    measurable: true,
    reason: null,
    viewportScreen: viewport,
    overflow,
    textTargetCount: 1,
    unreadableTargets: 0,
    notRenderedTargets: 0,
    textTargetsCapped: false,
    texts: [{
      targetKey: "bt001",
      svgTextKey: `svg:id:lab-svg|text:id:${target.id}`,
      boxScreen: target.box ?? box(),
      clipState: target.clipState ?? "none",
      ambiguityGroupSize: 1,
      ink: {
        T: {
          count: target.t.count,
          maskHash: sha256(Buffer.from(target.t.bits)),
          ...(target.collisionInk === undefined ? {} : { intersectShapes: target.collisionInk }),
          ...(target.occludedInk === undefined ? {} : { missingInFull: target.occludedInk }),
        },
        T0: { count: t0.count, maskHash: sha256(Buffer.from(t0.bits)) },
      },
    }],
    shapes: [],
    paths: [],
    inkPasses: {
      E: { count: 0, maskHash: sha256("empty") },
      S: { count: 0, maskHash: sha256("shapes") },
      F: { count: 0, maskHash: sha256("full") },
    },
    inkCollected: true,
    inkStable: true,
  };
}

async function preparePage(browser: { newPage(): Promise<PageLike> }, source: string): Promise<ScreenshotPage> {
  const page = (await browser.newPage()) as ScreenshotPage;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (/^(?:https?|file):/u.test(request.url())) {
      measuredExternalRequests += 1;
      void request.abort();
    } else {
      void request.continue();
    }
  });
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  await page.emulateMediaType("print");
  await page.emulateTimezone?.("UTC");
  await page.emulateMediaFeatures?.([{ name: "prefers-color-scheme", value: "light" }]);
  await page.setContent(source, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(`document.fonts.ready`);
  await page.evaluate(`new Paged.Previewer().preview()`);
  const count = await page.evaluate<number>(`document.querySelectorAll(".pagedjs_page").length`);
  if (count !== 1) throw new Error(`fixture paginated to ${count} pages, expected exactly one`);
  return page;
}

async function renderPass(page: ScreenshotPage, css: string): Promise<PassResult> {
  const result = await page.evaluate<{ clip: { x: number; y: number; width: number; height: number }; geometry: string }>(
    `(async () => {
      let style = document.querySelector("style[data-m3-lab-pass]");
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-m3-lab-pass", "true");
        document.head.append(style);
      }
      style.textContent = ${JSON.stringify(css)};
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const svg = document.querySelector(".pagedjs_page #lab-svg");
      if (!svg) throw new Error("paginated SVG is absent");
      const rect = svg.getBoundingClientRect();
      const texts = [...svg.querySelectorAll("text")].map((text) => {
        const r = text.getBoundingClientRect();
        return [text.id, r.x, r.y, r.width, r.height].map(String).join(":");
      }).join("|");
      return { clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, geometry: texts };
    })()`,
  );
  const png = Buffer.from(await page.screenshot({ clip: result.clip }));
  return { png, sha256: sha256(png), geometry: result.geometry };
}

async function measured(page: ScreenshotPage, emptyPng: Buffer, css: string): Promise<MeasuredPass> {
  const pass = await renderPass(page, css);
  return { ink: differenceMask(pass.png, emptyPng), sha256: pass.sha256, geometry: pass.geometry };
}

const OLD_EMPTY = `#lab-svg > *:not(defs):not(style):not(title):not(desc){visibility:hidden!important}`;
const OLD_TEXT = `#lab-svg > *:not(defs):not(style):not(title):not(desc):not(text){visibility:hidden!important}`;
const DEEP_EMPTY = `#lab-svg *:not(defs):not(defs *){visibility:hidden!important}`;
const SHAPES_ONLY = `#lab-svg text,#lab-svg text *{visibility:hidden!important}`;

function targetOnly(targetId: string, neutralise = false): string {
  return `${DEEP_EMPTY}
#lab-svg #${targetId},#lab-svg #${targetId} *{visibility:visible!important}
${neutralise ? "#lab-svg *{clip-path:none!important;mask:none!important;-webkit-mask:none!important}" : ""}`;
}

async function runClipFixture(browser: { newPage(): Promise<PageLike> }, pagedjs: string, fixture: ClipFixture): Promise<unknown> {
  const author = authorDocument(fixture.svg);
  const page = await preparePage(browser, pagedDocument(author, pagedjs));
  try {
    const clipBoundary = fixture.clipBoundary === null ? null : await page.evaluate<{
      elementId: string;
      actualRasterRight: number;
      expectedRasterRight: number;
      deltaDevicePixels: number;
      authoredRight: number;
      targetIds: string[];
      expectation: "cuts-target" | "contains-target";
      applicationTranslateXDevicePixels: number;
      expectedApplicationTranslateXDevicePixels: number;
    }>(`(() => {
      const svg = document.querySelector(".pagedjs_page #lab-svg");
      const boundary = svg.querySelector("#${fixture.clipBoundary.elementId}");
      const appliedTarget = svg.querySelector("#${fixture.clipBoundary.targetIds[0]}");
      if (!boundary || !appliedTarget) throw new Error("authored clip boundary or applied target is absent");
      const svgRect = svg.getBoundingClientRect();
      const actualPoint = svg.createSVGPoint();
      actualPoint.x = Number(boundary.getAttribute("x")) + Number(boundary.getAttribute("width"));
      actualPoint.y = Number(boundary.getAttribute("y"));
      const applicationCtm = appliedTarget.getScreenCTM();
      const baseCtm = svg.getScreenCTM();
      if (!applicationCtm || !baseCtm) throw new Error("applied target/base CTM is unavailable");
      const actualScreen = actualPoint.matrixTransform(applicationCtm);
      const expectedPoint = svg.createSVGPoint();
      expectedPoint.x = ${fixture.clipBoundary.authoredRight};
      expectedPoint.y = 0;
      const expectedScreen = expectedPoint.matrixTransform(applicationCtm);
      const actualRasterRight = (actualScreen.x - svgRect.x) * ${DEVICE_SCALE_FACTOR};
      const expectedRasterRight = (expectedScreen.x - svgRect.x) * ${DEVICE_SCALE_FACTOR};
      return {
        elementId: ${JSON.stringify(fixture.clipBoundary.elementId)},
        actualRasterRight,
        expectedRasterRight,
        deltaDevicePixels: actualRasterRight - expectedRasterRight,
        authoredRight: ${fixture.clipBoundary.authoredRight},
        targetIds: ${JSON.stringify(fixture.clipBoundary.targetIds)},
        expectation: ${JSON.stringify(fixture.clipBoundary.expectation)},
        applicationTranslateXDevicePixels: (applicationCtm.e - baseCtm.e) * ${DEVICE_SCALE_FACTOR},
        expectedApplicationTranslateXDevicePixels: ${fixture.clipBoundary.expectedApplicationTranslateXDevicePixels ?? 0},
      };
    })()`);
    const oldEmpty = await renderPass(page, OLD_EMPTY);
    const oldT = await measured(page, oldEmpty.png, OLD_TEXT);
    const oldT0 = await measured(
      page,
      oldEmpty.png,
      `${OLD_TEXT}\n#lab-svg *{clip-path:none!important;mask:none!important;-webkit-mask:none!important}`,
    );
    const targets: Record<string, unknown> = {};
    for (const [targetId, truth] of Object.entries(fixture.targets)) {
      const empty = await renderPass(page, DEEP_EMPTY);
      const t = await measured(page, empty.png, targetOnly(targetId));
      const t0 = await measured(page, empty.png, targetOnly(targetId, true));
      const clipState = fixture.svg.includes("<mask") ? "mask" : fixture.svg.includes("clip-path") ? "clip-path" : "none";
      targets[targetId] = {
        targetId: `svg:id:lab-svg|text:id:${targetId}`,
        independentGroundTruth: {
          label: truth,
              evidenceKinds: ["synthetic-construction", "neutral-counterfactual-render"],
          rationale: fixture.rationale,
          rightInkEdge: { actual: t.ink.rightEdge, neutral: t0.ink.rightEdge },
        },
        breaklintMeasurement: { T: t.ink.count, T0: t0.ink.count, missingInk: ratio(t.ink, t0.ink) },
        productionDecision: productionRuleDecision(
          textClipped,
          svgRecord({ id: targetId, clipState, t: t.ink, t0: t0.ink }),
        ),
        renderObservation: { actualSha256: t.sha256, neutralSha256: t0.sha256 },
      };
    }
    return {
      fixtureId: fixture.id,
      artifact: { sha256: sha256(author), mediaType: "text/html", synthetic: true },
      renderObservation: { oldTextSha256: oldT.sha256, oldNeutralSha256: oldT0.sha256, clipBoundary },
      independentGroundTruth: { source: "literal synthetic construction", targets: fixture.targets },
      breaklintMeasurement: {
        historicalSharedMask: { T: oldT.ink.count, T0: oldT0.ink.count, missingInk: ratio(oldT.ink, oldT0.ink) },
        perTarget: targets,
      },
      blindAnnotations: [],
      adjudication: null,
      evaluation: { syntheticOnly: true, eligibleRealDocument: false },
    };
  } finally {
    await page.close();
  }
}

async function runCollisionFixture(
  browser: { newPage(): Promise<PageLike> },
  pagedjs: string,
  fixture: CollisionFixture,
): Promise<unknown> {
  const author = authorDocument(fixture.svg);
  const page = await preparePage(browser, pagedDocument(author, pagedjs));
  try {
    const empty = await renderPass(page, DEEP_EMPTY);
    const text = await measured(page, empty.png, targetOnly(fixture.targetId));
    const shapes = await measured(page, empty.png, SHAPES_ONLY);
    const full = await measured(page, empty.png, "");
    const collisionInk = intersection(text.ink, shapes.ink);
    const occludedInk = missingFromFull(text.ink, full.ink);
    const bboxOverlap = await page.evaluate<boolean>(`(() => {
      const svg=document.querySelector(".pagedjs_page #lab-svg");
      const texts=[...svg.querySelectorAll("text")].map((e)=>e.getBoundingClientRect());
      const shapes=[...svg.querySelectorAll("line,rect:not(clipPath rect):not(mask rect),path")];
      if (!texts.length) return false;
      const union={left:Math.min(...texts.map((b)=>b.left)),top:Math.min(...texts.map((b)=>b.top)),
        right:Math.max(...texts.map((b)=>b.right)),bottom:Math.max(...texts.map((b)=>b.bottom))};
      return shapes.some((e)=>{const b=e.getBoundingClientRect();return b.left<union.right&&b.right>union.left&&b.top<union.bottom&&b.bottom>union.top});
    })()`);
    return {
      fixtureId: fixture.id,
      artifact: { sha256: sha256(author), mediaType: "text/html", synthetic: true },
      renderObservation: { textSha256: text.sha256, shapesSha256: shapes.sha256, fullSha256: full.sha256 },
      independentGroundTruth: {
        label: fixture.truth,
        evidenceKinds: ["synthetic-construction", "independent-render-geometry"],
        rationale: fixture.rationale,
        bboxOverlap,
      },
      breaklintMeasurement: { collisionInk, occludedInk },
      productionDecision: productionRuleDecision(
        textInkCollision,
        svgRecord({ id: fixture.targetId, t: text.ink, collisionInk, occludedInk }),
      ),
      blindAnnotations: [],
      adjudication: null,
      evaluation: { syntheticOnly: true, eligibleRealDocument: false },
    };
  } finally {
    await page.close();
  }
}

async function runViewportFixture(
  browser: { newPage(): Promise<PageLike> },
  pagedjs: string,
  fixture: ViewportFixture,
): Promise<unknown> {
  const author = authorDocument(fixture.svg, fixture.svgAttributes);
  const page = await preparePage(browser, pagedDocument(author, pagedjs));
  try {
    const observation = await page.evaluate<{
      overshoot: number;
      overflow: string;
      box: Box;
      viewport: Box;
    }>(`(() => {
      const svg=document.querySelector(".pagedjs_page #lab-svg"), text=svg.querySelector("#${fixture.targetId}");
      const b=text.getBoundingClientRect(), v=svg.getBoundingClientRect(), overflow=getComputedStyle(svg).overflow;
      const overshoot=Math.max(v.x-b.x,v.y-b.y,b.right-v.right,b.bottom-v.bottom);
      return {overshoot,overflow,box:{x:b.x,y:b.y,width:b.width,height:b.height},viewport:{x:v.x,y:v.y,width:v.width,height:v.height}};
    })()`);
    const excluded = /\bvisible\b/u.test(observation.overflow);
    return {
      fixtureId: fixture.id,
      artifact: { sha256: sha256(author), mediaType: "text/html", synthetic: true },
      renderObservation: observation,
      independentGroundTruth: {
        label: fixture.truth,
        evidenceKinds: ["authored-viewport-boundary", "independent-render-geometry"],
        rationale: fixture.rationale,
      },
      breaklintMeasurement: { overshootPx: observation.overshoot, excludedOverflowVisible: excluded },
      productionDecision: productionRuleDecision(
        textOverflowsViewport,
        svgRecord(
          { id: fixture.targetId, box: observation.box, t: { bits: new Uint8Array(1), count: 1, width: 1, height: 1, rightEdge: 0 } },
          observation.viewport,
          observation.overflow,
        ),
      ),
      calibrationMode: "structural-validation",
      thresholdOptimisationApplicable: false,
      blindAnnotations: [],
      adjudication: null,
      evaluation: { syntheticOnly: true, eligibleRealDocument: false },
    };
  } finally {
    await page.close();
  }
}

function fixtureById(values: unknown[], id: string): Record<string, unknown> {
  const value = values.find((entry) => (entry as { fixtureId?: unknown }).fixtureId === id);
  if (!value || typeof value !== "object") throw new Error(`lab report lacks fixture ${id}`);
  return value as Record<string, unknown>;
}

function addCheck(checks: LabCheck[], id: string, passed: boolean, observed: unknown, expected: string): void {
  checks.push({ id, passed, observed, expected });
}

export async function runSvgValidationLab(options: { clipFixtures?: readonly ClipFixture[] } = {}): Promise<SvgValidationLabReport> {
  measuredExternalRequests = 0;
  const paged = packageIdentity("pagedjs");
  const puppeteer = packageIdentity("puppeteer-core");
  const pngjs = packageIdentity("pngjs");
  if (paged.version !== "0.4.3") throw new Error(`validation lab requires Paged.js 0.4.3, got ${paged.version}`);
  const pagedjsPath = join(paged.root, "dist", "paged.js");
  const pagedjs = readFileSync(pagedjsPath, "utf8");
  const launched = await launchBrowser(ROOT);
  if (!launched.browser || !launched.executablePath) throw new Error(launched.detail);
  const font = fontIdentity();
  let browserVersion = "";
  let profileError: string | null = null;
  let closeError: string | null = null;
  try {
    browserVersion = await launched.browser.version();
    const clipFixtures = [];
    for (const fixture of options.clipFixtures ?? CLIP_FIXTURES) clipFixtures.push(await runClipFixture(launched.browser, pagedjs, fixture));
    const collisionFixtures = [];
    for (const fixture of COLLISION_FIXTURES) {
      collisionFixtures.push(await runCollisionFixture(launched.browser, pagedjs, fixture));
    }
    const grazingSamplingCounterexample = await runGrazingSamplingCounterexample(launched.browser, pagedjs);
    const viewportFixtures = [];
    for (const fixture of VIEWPORT_FIXTURES) {
      viewportFixtures.push(await runViewportFixture(launched.browser, pagedjs, fixture));
    }

    const checks: LabCheck[] = [];
    const suppliedClipFixtures = options.clipFixtures ?? CLIP_FIXTURES;
    addCheck(checks, "normative-seven-fixture-order", canonicalJson(suppliedClipFixtures.map((fixture) => fixture.id)) === canonicalJson(NORMATIVE_CLIP_FIXTURE_IDS_V1), suppliedClipFixtures.map((fixture) => fixture.id), "exact independent v1 ID order");
    addCheck(checks, "normative-seven-fixture-unique-ids", new Set(suppliedClipFixtures.map((fixture) => fixture.id)).size === NORMATIVE_CLIP_FIXTURE_IDS_V1.length, suppliedClipFixtures.map((fixture) => fixture.id), "seven unique IDs");
    for (const pin of NORMATIVE_CLIP_FIXTURE_CONTRACT_V1) {
      const fixture = suppliedClipFixtures.find((entry) => entry.id === pin.id);
      const fixtureSvgSha256 = fixture ? sha256(fixture.svg) : null;
      const fixtureTargets = fixture?.targets ?? null;
      const observedBoundary = fixture?.clipBoundary ? { elementId: fixture.clipBoundary.elementId, targetIds: fixture.clipBoundary.targetIds, authoredRight: fixture.clipBoundary.authoredRight, expectedTranslateDevicePixels: fixture.clipBoundary.expectedApplicationTranslateXDevicePixels ?? 0, expectation: fixture.clipBoundary.expectation } : null;
      addCheck(checks, `${pin.id}-independent-literal-contract`, fixtureSvgSha256 === pin.svgSha256 && canonicalJson(fixtureTargets) === canonicalJson(pin.targets) && canonicalJson(observedBoundary) === canonicalJson(pin.boundary), { svgSha256: fixtureSvgSha256, targets: fixtureTargets, boundary: observedBoundary }, "independent literal SVG bytes, target truth and structure pin");
    }
    const clipThreshold = Number(textClipped.defaultOptions.maxMissingInk);
    const collisionThreshold = Number(textInkCollision.defaultOptions.minCollisionInk);
    const occlusionThreshold = Number(textInkCollision.defaultOptions.minOccludedInk);
    const viewportBoundary = Number(textOverflowsViewport.defaultOptions.maxOvershootPx);
    addCheck(checks, "product-default-clip-0.05", clipThreshold === CONTRACT_CLIP_THRESHOLD, clipThreshold, "maxMissingInk = 0.05");
    addCheck(checks, "product-default-collision-8", collisionThreshold === CONTRACT_COLLISION_THRESHOLD && occlusionThreshold === CONTRACT_COLLISION_THRESHOLD, { collisionThreshold, occlusionThreshold }, "minCollisionInk = minOccludedInk = 8");
    addCheck(checks, "product-default-viewport-0", viewportBoundary === CONTRACT_VIEWPORT_BOUNDARY, viewportBoundary, "maxOvershootPx = 0");
    const g1 = fixtureById(clipFixtures, "G1_textInGruppe");
    const g1Measurement = g1.breaklintMeasurement as {
      historicalSharedMask: { T: number };
      perTarget: Record<string, { breaklintMeasurement: { missingInk: number | null } }>;
    };
    addCheck(
      checks,
      "G1-historical-selector-zero",
      g1Measurement.historicalSharedMask.T === 0,
      g1Measurement.historicalSharedMask.T,
      "|T| = 0",
    );
    addCheck(
      checks,
      "G1-target-specific-positive",
      (g1Measurement.perTarget.t1?.breaklintMeasurement.missingInk ?? -1) > clipThreshold,
      g1Measurement.perTarget.t1?.breaklintMeasurement.missingInk ?? null,
      "target-specific missingInk > 0.05",
    );
    const dilution = fixtureById(clipFixtures, "V_verduennung");
    const dilutionMeasurement = dilution.breaklintMeasurement as {
      historicalSharedMask: { missingInk: number | null };
      perTarget: Record<string, { breaklintMeasurement: { missingInk: number | null } }>;
    };
    addCheck(
      checks,
      "V-shared-mask-dilution",
      dilutionMeasurement.historicalSharedMask.missingInk !== null &&
        dilutionMeasurement.historicalSharedMask.missingInk < clipThreshold,
      dilutionMeasurement.historicalSharedMask.missingInk,
      "shared missingInk < 0.05",
    );
    addCheck(
      checks,
      "V-target-specific-positive",
      (dilutionMeasurement.perTarget.tk?.breaklintMeasurement.missingInk ?? -1) > clipThreshold,
      dilutionMeasurement.perTarget.tk?.breaklintMeasurement.missingInk ?? null,
      "tk missingInk > 0.05",
    );
    for (const entry of clipFixtures) {
      const item = entry as {
        fixtureId: string;
        renderObservation: { clipBoundary: null | { actualRasterRight: number; expectedRasterRight: number; deltaDevicePixels: number; targetIds: string[]; expectation: "cuts-target" | "contains-target"; applicationTranslateXDevicePixels: number; expectedApplicationTranslateXDevicePixels: number } };
        independentGroundTruth: { targets: Record<string, string> };
        breaklintMeasurement: { perTarget: Record<string, { independentGroundTruth: { rightInkEdge: { actual: number; neutral: number } }; breaklintMeasurement: { missingInk: number | null } }> };
      };
      const boundary = item.renderObservation.clipBoundary;
      if (boundary) {
        addCheck(
          checks,
          `${item.fixtureId}-authored-clip-boundary`,
          Math.abs(boundary.deltaDevicePixels) <= 1,
          boundary,
          "constructed clip boundary matches authored boundary within ±1 device pixel",
        );
        addCheck(checks, `${item.fixtureId}-application-transform`, Math.abs(boundary.applicationTranslateXDevicePixels - boundary.expectedApplicationTranslateXDevicePixels) <= 0.01, boundary, "target-to-SVG transform projection matches independently authored device-pixel translation");
      }
      for (const [target, truth] of Object.entries(item.independentGroundTruth.targets)) {
        const targetResult = item.breaklintMeasurement.perTarget[target];
        const value = targetResult?.breaklintMeasurement.missingInk ?? null;
        addCheck(
          checks,
          `${item.fixtureId}-${target}-target-attribution`,
          value !== null && (truth === "positive" ? value > clipThreshold : value === 0),
          value,
          truth === "positive" ? "target measurement > 0.05" : "target measurement = 0",
        );
        const edge = targetResult?.independentGroundTruth.rightInkEdge;
        const isBoundaryTarget = boundary?.targetIds.includes(target) ?? false;
        const boundaryRelation = !isBoundaryTarget || !boundary
          ? true
          : boundary.expectation === "cuts-target"
            ? Boolean(edge && edge.actual >= 0 && Math.abs((boundary.actualRasterRight - 1) - edge.actual) <= 1)
            : Boolean(edge && edge.actual >= 0 && edge.actual < boundary.actualRasterRight);
        addCheck(
          checks,
          `${item.fixtureId}-${target}-right-edge-relation`,
          Boolean(edge && edge.actual >= 0 && edge.neutral >= 0 && (truth === "positive" ? edge.actual < edge.neutral : edge.actual === edge.neutral) && boundaryRelation),
          { edge: edge ?? null, boundary },
          truth === "positive" ? "actual right edge is clipped, differs from neutral, and aligns with authored boundary" : "actual and neutral right edges agree; containing boundaries remain beyond the ink",
        );
      }
    }
    for (const entry of collisionFixtures) {
      const item = entry as {
        fixtureId: string;
        independentGroundTruth: { label: string; bboxOverlap: boolean };
        breaklintMeasurement: { collisionInk: number; occludedInk: number };
        productionDecision: string;
      };
      const m = item.breaklintMeasurement;
      const label = item.independentGroundTruth.label;
      const passed = label === "collision" ? m.collisionInk > 0 : label === "occlusion" ? m.occludedInk > 0 : m.collisionInk === 0 && m.occludedInk === 0;
      addCheck(checks, `${item.fixtureId}-collision-boundary`, passed, m, `matches constructed ${label} truth`);
      const contractFixture = COLLISION_FIXTURES.find((fixture) => fixture.id === item.fixtureId)!;
      addCheck(checks, `${item.fixtureId}-production-decision`, item.productionDecision === contractFixture.expectedDecision, item.productionDecision, contractFixture.expectedDecision);
      if (contractFixture.expectedCollisionInk !== undefined) addCheck(checks, `${item.fixtureId}-exact-device-pixels`, m.collisionInk === contractFixture.expectedCollisionInk, m.collisionInk, `exactly ${contractFixture.expectedCollisionInk}`);
    }
    const gap = collisionFixtures.find((entry) => (entry as { fixtureId?: string }).fixtureId === "collision_line_in_text_gap") as {
      independentGroundTruth: { bboxOverlap: boolean };
      breaklintMeasurement: { collisionInk: number };
    };
    addCheck(
      checks,
      "collision-bbox-negative-control",
      gap.independentGroundTruth.bboxOverlap && gap.breaklintMeasurement.collisionInk === 0,
      { bboxOverlap: gap.independentGroundTruth.bboxOverlap, collisionInk: gap.breaklintMeasurement.collisionInk },
      "bbox overlap true while collisionInk = 0",
    );
    const grazing = grazingSamplingCounterexample as {
      renderObservation: { samples4px: number; samples025px: number };
    };
    addCheck(
      checks,
      "collision-grazing-corner-fixed-grid-counterexample",
      grazing.renderObservation.samples4px === 0 && grazing.renderObservation.samples025px > 0,
      grazing.renderObservation,
      "4 px grid = 0 hits and 0.25 px grid > 0 hits",
    );
    for (const entry of viewportFixtures) {
      const item = entry as {
        fixtureId: string;
        independentGroundTruth: { label: string };
        productionDecision: string;
      };
      addCheck(
        checks,
        `${item.fixtureId}-structural-boundary`,
        item.independentGroundTruth.label === "positive"
          ? item.productionDecision === "finding"
          : item.productionDecision !== "finding",
        item.productionDecision,
        item.independentGroundTruth.label === "positive" ? "finding" : "clean or declined",
      );
    }

    const executableSha256 = sha256(readFileSync(launched.executablePath));
    const pagedjsArtifactSha256 = sha256(readFileSync(pagedjsPath));
    const sourceIdentity = repositorySourceIdentity();
    const rendererFreeze: DocumentEntry["rendererFreeze"] = {
      rendererFreezeId: `renderer_${"0".repeat(64)}`,
      sourceIdentity,
      breaklintVersion: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string,
      nodeVersion: process.version,
      browserProduct: browserVersion.split("/")[0] ?? browserVersion,
      browserVersion,
      browserExecutableSha256: executableSha256,
      puppeteerVersion: puppeteer.version,
      pagedjsVersion: paged.version,
      pagedjsArtifactSha256,
      rasterizer: "Chrome screenshot",
      rasterizerVersion: `Chrome ${browserVersion}; pngjs ${pngjs.version}; channel delta ${CHANNEL_DELTA}`,
      headless: true,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, unit: "css-px" },
      pageSize: { width: 440, height: 180, unit: "css-px" },
      locale: "en",
      timezone: "UTC",
      colorScheme: "light",
      os: { platform: platform(), version: release(), arch: arch() },
      fonts: font ? [font] : [],
      customFontHashes: [],
      networkMode: "offline",
      resourceHashes: [paged.packageJsonSha256, pagedjsArtifactSha256, puppeteer.packageJsonSha256, pngjs.packageJsonSha256].sort(),
    };
    rendererFreeze.rendererFreezeId = contentDerivedRendererId(rendererFreeze);
    const freezeContentHash = rendererContentHash(rendererFreeze);
    const renderer = { ...rendererFreeze, rendererContentHash: freezeContentHash, networkObservation: { policy: "intercept-and-block", externalRequests: measuredExternalRequests } };
    const rendererIdentityComplete = Boolean(
      browserVersion && executableSha256 && font && paged.version === "0.4.3" &&
      paged.packageJsonSha256 && puppeteer.packageJsonSha256 && pngjs.packageJsonSha256 &&
      rendererFreeze.rendererFreezeId === `renderer_${freezeContentHash}` &&
      (sourceIdentity.mode === "clean-commit"
        ? /^[a-f0-9]{40}$/u.test(sourceIdentity.commit)
        : [sourceIdentity.gitDiffSha256, sourceIdentity.sourceTreeSha256, sourceIdentity.sourceBundleSha256].every((value) => /^[a-f0-9]{64}$/u.test(value))) &&
      measuredExternalRequests === 0,
    );
    addCheck(
      checks,
      "renderer-identity-complete",
      rendererIdentityComplete,
      renderer,
      "all renderer, runtime, OS, font, raster, locale and resource fields are present",
    );
    return {
      contractVersion: 1,
      reportSchemaVersion: 1,
      status: checks.every((check) => check.passed) ? "pass" : "fail",
      rendererIdentityComplete,
      renderer,
      oracleContract: {
        independentGroundTruthSources: [
          "literal synthetic construction",
          "authored clip/viewBox boundaries",
          "rendered right-ink-edge and target/shape controls",
        ],
        prohibitedSources: [
          "breaklint finding",
          "production decision",
          "production threshold",
          "missingInk",
          "collisionInk",
          "occludedInk",
        ],
        productionOutputsUsedForGroundTruth: false,
      },
      layers: [
        "artifact",
        "renderObservation",
        "independentGroundTruth",
        "breaklintMeasurement",
        "productionDecision",
        "blindAnnotations",
        "adjudication",
        "evaluation",
      ],
      clipFixtures,
      collisionFixtures,
      grazingSamplingCounterexample,
      viewportFixtures,
      checks,
    };
  } finally {
    closeError = await closeBrowserBounded(launched.browser);
    profileError = cleanupBrowserProfile(launched.userDataDir ?? null);
    if (closeError || profileError) {
      throw new Error(`validation-lab cleanup failed: ${[closeError, profileError].filter(Boolean).join("; ")}`);
    }
  }
}

async function main(): Promise<void> {
  const outputFlag = process.argv.indexOf("--output");
  const output = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
  if (outputFlag >= 0 && !output) throw new Error("--output requires a path");
  const report = await runSvgValidationLab();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(resolve(output), json);
  process.stdout.write(json);
  process.exitCode = report.status === "pass" ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`svg validation lab infrastructure failure: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  });
}

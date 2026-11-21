/**
 * checkPage's Node-side stabilization contract, driven through the real checkPage with a structural
 * page. The stub answers only the browser calls checkPage makes (fonts, frame, sample, screenshot);
 * timing, budget and verdict logic are the production code.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { checkPage } from "../../src/api/check-page.ts";
import type { StructuralPage } from "../../src/web/types.ts";

const output = mkdtempSync(join(tmpdir(), "breaklint-screen-stabilization-"));
after(() => rmSync(output, { recursive: true, force: true }));

function png(): Uint8Array {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12, "ascii"); bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(400, 20);
  return bytes;
}

function sample(index: number, fonts: string, changing: boolean): unknown {
  const target = {
    selector: "#t", domPath: "html:nth-child(1)>body:nth-child(2)>p:nth-child(1)", tag: "p", id: "t", className: "", textLength: 4, directText: "text",
    hasDirectText: true, isSvg: false, isSvgText: false, isInteractiveControl: false, siblingEligible: false, fontSizePx: 16, siblingOverlapPx: 0,
    svgTextOverflowPx: 0, svgClipped: false, svgInterior: false, paintSignature: "p", ancestorSignatureComplete: true,
    box: { x: 0, y: 0, width: changing ? 100 + index : 100, height: 20 }, coordinateSystem: "css-viewport-pixels", state: "candidate", reason: null, paint: null,
    transform: null, clipped: "none", horizontalOverflow: 0, allowedScroll: false, clipByAllowed: false, overlay: false, sourceContainer: null, scroll: { x: 0, y: 0 },
  };
  return {
    signature: { url: "https://host.test/page", viewport: [640, 400, 1], scroll: [0, 0], document: [640, 400, 640, 400, 3], fonts },
    fontsReady: fonts === "loaded", deviceScaleFactor: 1, candidates: 3, omittedCount: 0, signatureTextComplete: true, ancestorSignatureComplete: true,
    exceptions: { allowed: [], overlay: [], allowedRoot: [], overlayRoot: [] }, targets: [target],
  };
}

interface StubPlan {
  /** Delay of each sample by sample index (0 = first). `Infinity` never resolves. */
  sampleDelayMs?: (index: number) => number;
  fonts?: (index: number) => string;
  changing?: boolean;
  screenshotHangs?: boolean;
}

function stubPage(plan: StubPlan): { page: StructuralPage; calls: { samples: number; screenshots: number } } {
  const calls = { samples: 0, screenshots: 0 };
  const delay = <T>(ms: number, value: T): Promise<T> => ms === Infinity ? new Promise<T>(() => undefined) : new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const page: StructuralPage = {
    evaluate: (async (fn: (...args: unknown[]) => unknown, arg?: unknown) => {
      if (arg && typeof arg === "object" && "maxTargets" in (arg as object)) {
        const index = calls.samples++;
        return delay(plan.sampleDelayMs?.(index) ?? 0, sample(index, plan.fonts?.(index) ?? "loaded", plan.changing === true));
      }
      const source = String(fn);
      if (source.includes("requestAnimationFrame")) return delay(1, true);
      if (source.includes("document.fonts")) return true;
      return null;
    }) as StructuralPage["evaluate"],
    screenshot: async () => { calls.screenshots++; return plan.screenshotHangs ? new Promise<Uint8Array>(() => undefined) : png(); },
    url: () => "https://host.test/page",
    viewportSize: () => ({ width: 640, height: 400 }),
    context: () => ({ browser: () => ({ version: () => "stub" }) }),
  };
  return { page, calls };
}

const options = (scenario: string, stabilizationTimeoutMs: number) => ({
  trust: "host-controlled-page", networkPolicy: "host-owned", scenario, output: { dir: output, screenshot: "viewport" }, geometry: { stabilizationTimeoutMs },
});

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`checkPage did not return within ${ms} ms`)), ms); })]);
  } finally { clearTimeout(timer); }
}

describe("screen checkPage stabilization budget", () => {
  it("starts the stabilization deadline after the first sample and records that sample's duration", async () => {
    // Every sample takes 400 ms; the budget of 600 ms leaves room for one more sample only when it
    // is counted from the end of the first one.
    const { page } = stubPage({ sampleDelayMs: () => 400 });
    const result = await checkPage(page, options("slow-first-sample", 600));
    assert.equal(result.report.capture.stabilized, true, JSON.stringify(result.report.infrastructure));
    assert.equal(result.report.capture.drifted, false);
    assert.equal(result.report.runVerdict, "clean");
    assert.ok((result.report.capture.firstSampleMs ?? 0) >= 390, String(result.report.capture.firstSampleMs));
  });

  it("reports a stabilization timeout as a timeout, never as drift, when no second sample differed", async () => {
    const { page } = stubPage({ sampleDelayMs: () => 400 });
    const result = await checkPage(page, options("timeout-not-drift", 300));
    assert.equal(result.report.runVerdict, "insufficient-coverage");
    assert.equal(result.report.capture.timedOut, true);
    assert.equal(result.report.capture.drifted, false);
    assert.equal(result.report.capture.stabilizationEndedBy, "timeout");
    assert.ok(result.report.infrastructure.some((e) => e.kind === "screen-stabilization-timeout"), JSON.stringify(result.report.infrastructure));
    assert.equal(result.report.infrastructure.some((e) => e.kind === "screen-capture-drift"), false, JSON.stringify(result.report.infrastructure));
  });

  it("reports the attempt limit separately from the time budget", async () => {
    const { page } = stubPage({ changing: true });
    const result = await checkPage(page, options("attempt-limit", 15_000));
    assert.equal(result.report.runVerdict, "insufficient-coverage");
    assert.equal(result.report.capture.stabilizationEndedBy, "attempt-limit");
    assert.equal(result.report.capture.stabilizationAttempts, 20);
    assert.equal(result.report.capture.timedOut, false);
    assert.ok(result.report.infrastructure.some((e) => e.kind === "screen-stabilization-attempt-limit" && e.detail.includes("20")), JSON.stringify(result.report.infrastructure));
    // The samples really differed: that is drift, reported as such.
    assert.equal(result.report.capture.drifted, true);
  });

  it("never binds evidence to identical samples taken while document fonts are still loading", async () => {
    const { page } = stubPage({ fonts: () => "loading" });
    const result = await checkPage(page, options("fonts-reloading", 300));
    assert.equal(result.report.runVerdict, "insufficient-coverage");
    assert.equal(result.report.capture.fontsReady, false);
    assert.equal(result.report.capture.drifted, false);
    assert.ok(result.report.infrastructure.some((e) => e.kind === "screen-fonts-not-ready"), JSON.stringify(result.report.infrastructure));
    assert.ok(result.report.evaluations.every((e) => e.evidenceBound === false));

    // Positive control: the font finishes loading during stabilization, the capture settles.
    const { page: settling } = stubPage({ fonts: (index) => index < 2 ? "loading" : "loaded" });
    const settled = await checkPage(settling, options("fonts-settle", 2_000));
    assert.equal(settled.report.runVerdict, "clean", JSON.stringify(settled.report.infrastructure));
    assert.equal(settled.report.capture.fontsReady, true);
  });

  it("keeps the 0.10 meaning of stabilizationTimeoutMs 0: no waiting, a timeout, no drift claim", async () => {
    const { page, calls } = stubPage({});
    const result = await checkPage(page, options("zero-budget", 0));
    assert.equal(result.report.runVerdict, "insufficient-coverage");
    assert.equal(result.report.capture.timedOut, true);
    assert.equal(result.report.capture.drifted, false);
    assert.ok(result.report.infrastructure.some((e) => e.kind === "screen-font-layout-timeout"), JSON.stringify(result.report.infrastructure));
    assert.equal(result.report.infrastructure.some((e) => e.kind === "screen-capture-drift"), false, JSON.stringify(result.report.infrastructure));
    // Still observed: a sample before and after a screenshot.
    assert.ok(calls.samples >= 2);
    assert.equal(calls.screenshots, 1);
  });

  it("returns without a screenshot when the first sample never arrives", async () => {
    const { page, calls } = stubPage({ sampleDelayMs: () => Infinity });
    const result = await bounded(checkPage(page, options("hanging-first-sample", 0)), 20_000);
    assert.equal(result.ok, false);
    assert.equal(result.report.runVerdict, "infrastructure");
    assert.equal(calls.screenshots, 0);
    assert.equal(result.report.artifact.relativePath, null);
    assert.ok(result.report.infrastructure.some((e) => e.kind === "screen-sample-timeout" && e.fatal), JSON.stringify(result.report.infrastructure));
    assert.equal(result.report.evaluations.length, 0);
  });

  it("bounds the screenshot on its own", async () => {
    const { page } = stubPage({ screenshotHangs: true });
    const result = await bounded(checkPage(page, options("hanging-screenshot", 0)), 20_000);
    assert.equal(result.report.runVerdict, "infrastructure");
    assert.equal(result.report.artifact.relativePath, null);
    assert.ok(result.report.infrastructure.some((e) => e.kind === "screen-screenshot-timeout" && e.fatal), JSON.stringify(result.report.infrastructure));
  });
});

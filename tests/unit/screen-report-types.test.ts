/**
 * Type contract of the screen report (checked by `npm run typecheck`, which includes tests/): the
 * emitted `PublicScreenReport` is the Screen 2 form; readers take `ReadableScreenReport`, which also
 * admits the Screen 1 form 0.10.0 wrote. The runtime part feeds a Screen 1 report to the readers.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { writeReportBundle } from "../../src/api/bundle.ts";
import { createContextPack } from "../../src/api/context.ts";
import type { PublicScreenReport, PublicScreenReportV1, ReadableScreenReport } from "../../src/index.ts";

// The shape checkPage 0.10.0 wrote (measured with the v0.10.0 code): no `scope` on exception
// counters, no failOn/rulesEnabled, a capture without the stabilization fields.
const screen1: PublicScreenReportV1 = {
  schemaVersion: 1, profileKind: "screen", runId: "screen-1-run", runVerdict: "clean", exitCode: 0,
  scope: { projectId: null, documentId: null, scenario: "legacy", url: "https://host.test/page", viewport: { width: 640, height: 400, deviceScaleFactor: 1 }, browserVersion: "0.10.0-host" },
  trust: "host-controlled-page", networkPolicy: "host-owned",
  targetInventory: { complete: true, omittedCount: 0, reason: null },
  coverage: { candidates: 2, measured: 2, excluded: 0, notMeasured: 0, allowedScrollContainers: [{ selector: "[data-grid]", reason: "grid", count: 1 }], intentionalOverlays: [] },
  capture: { before: "a", stable: "a", after: "a", fontsReady: true, timedOut: false, drifted: false },
  artifact: { kind: "png", relativePath: null, sha256: null, byteLength: null, widthPx: null, heightPx: null, capture: "viewport", coordinateSystem: "css-viewport-pixels-with-scroll" },
  evaluations: [], findings: [], infrastructure: [], events: [],
};

// @ts-expect-error The emitted report type is the Screen 2 form; a Screen 1 report is not one.
const notEmitted: PublicScreenReport = screen1;
void notEmitted;

describe("screen report reader types", () => {
  it("reads a Screen 1 report through ReadableScreenReport without narrowing", () => {
    const readable: ReadableScreenReport = screen1;
    const url: string = readable.scope.url;
    assert.equal(url, "https://host.test/page");
    assert.equal(createContextPack(readable).canonicalReport.profileKind, "screen");
    const out = mkdtempSync(join(tmpdir(), "breaklint-screen1-bundle-"));
    try {
      const bundle = writeReportBundle(readable, { outDir: out });
      assert.ok(bundle);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});

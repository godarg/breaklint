import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as contract from "../tools/report-surface-contract.mjs";
import type { ReviewLedger } from "../tools/report-surface-contract.mjs";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Handwritten complete fixture: one screen and tile, and one two-page PDF/raster pair. */
function fixture() {
  const fingerprint = sha("independent input");
  const reviewEnvironment = {
    reviewArtifactContractVersion: 4, screenPixelContractVersion: 1,
    browser: "Chromium 141.0.7390.37", platform: "linux", architecture: "x64", nodeMajor: "24",
    deviceScaleFactor: 1,
    browserRenderArgs: ["--deterministic-mode", "--disable-gpu", "--disable-lcd-text", "--disable-skia-runtime-opts", "--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars"],
    viewports: { mobile: { width: 390, height: 844 } }, themes: ["light"],
    print: { rasterDpi: 110, rasterizer: "pdftoppm version 24.02.0", contentViewportCssPx: { width: 703, height: 1123 } },
  };
  const images = [
    { path: "clean--light--mobile.png", sha256: sha("whole screen") },
    { path: "clean--light--mobile--tile-01.png", sha256: sha("screen tile") },
    { path: "clean--a4-page-1.png", sha256: sha("first A4 page") },
    { path: "clean--a4-page-2.png", sha256: sha("second A4 page") },
  ];
  const artifacts = [
    { cell: "screen/clean/light/mobile", kind: "screen", ...images[0]!, tiles: [images[1]!], reviewArtifactFingerprint: sha("screen fingerprint"), pixels: { normalizedRgbaSha256: sha("screen RGBA") } },
    { cell: "print/clean/pdf", kind: "pdf", path: "clean--a4.pdf", sha256: sha("PDF"), pages: 2, rasterPageVisualHashes: images.slice(2).map((image) => image.sha256), reviewArtifactFingerprint: sha("PDF fingerprint") },
    { cell: "print/clean/raster-set", kind: "raster-set", pages: images.slice(2), reviewArtifactFingerprint: sha("raster fingerprint") },
  ];
  const physicalArtifacts = { screens: 1, screenTiles: 1, pdfs: 1, rasterPages: 2 };
  const common = { status: "pass", reviewer: "@SightAI", reviewedAt: "2026-10-07T04:00:00.000Z", note: "Reviewed every assigned image at its original size." };
  const round = {
    round: 1, record: "current", outcome: "pass", reviewedAt: common.reviewedAt,
    reviewers: [{
      kind: "delegated-ai", handle: "@SightAI", actual_model: "claude-opus-5-5",
      promptSha256: sha("neutral complete prompt"), outputSha256: sha("original review answer"),
      nativeReceipt: { path: "reviews/0.9.0-native-receipt.json", sha256: sha("native receipt"), imageCount: 4 },
      receivedImages: structuredClone(images),
    }],
    delegation: { founder: "@Founder", date: "2026-10-07", sessionQuote: "I delegate the 0.9.0 sight review to the independent AI reviewer.", release: "0.9.0", revoked: false },
    binding: { reviewInputFingerprint: fingerprint, renderManifestGeneratedAt: "2026-10-07T03:00:00.000Z", reviewEnvironment: structuredClone(reviewEnvironment) },
    physicalArtifactsReviewed: structuredClone(physicalArtifacts),
    findings: { blocker: 0, high: 0, medium: 0, low: 0 }, note: "Synthetic delegated sight gate positive control; no real review claim.",
    cells: {
      "screen/clean/light/mobile": { ...common, reviewArtifactFingerprint: sha("screen fingerprint"), reviewedRawSha256: images[0]!.sha256, reviewedNormalizedRgbaSha256: sha("screen RGBA"), reviewedArtifacts: images.slice(0, 2).map((image) => image.path) },
      "print/clean/pdf": { ...common, reviewArtifactFingerprint: sha("PDF fingerprint"), reviewedRawSha256: sha("PDF"), reviewedPages: [1, 2], reviewedArtifacts: ["clean--a4.pdf"] },
      "print/clean/raster-set": { ...common, reviewArtifactFingerprint: sha("raster fingerprint"), reviewedRawSha256: images.slice(2).map((image) => image.sha256), reviewedPages: [1, 2], reviewedArtifacts: images.slice(2).map((image) => image.path) },
    },
  };
  return { ledger: { schemaVersion: 6, rounds: [round] }, manifest: { reviewEnvironment, artifacts, physicalArtifacts }, fingerprint };
}

type Fixture = ReturnType<typeof fixture>;
function sight(input: Fixture) {
  const assess = Reflect.get(contract, "assessSightGate");
  assert.equal(typeof assess, "function", "delegated sight review requires the separate assessSightGate contract");
  return (assess as (ledger: unknown, manifest: unknown, fingerprint: string) => { reviewKind: string })(input.ledger, input.manifest, input.fingerprint);
}
function reject(change: (input: Fixture) => void, expected: RegExp) {
  const input = fixture(); change(input);
  assert.throws(() => sight(input), expected);
}

describe("delegated AI sight review", () => {
  it("accepts an explicit release delegation and all exact received images as delegatedAI", () => {
    const input = fixture();
    assert.equal(sight(input).reviewKind, "delegatedAI");
    assert.throws(() => contract.assessHumanGate(input.ledger as unknown as ReviewLedger, input.manifest, input.fingerprint), /human-only/u);
    const line = contract.describeLatestRound(input.ledger as unknown as ReviewLedger, input.manifest, input.fingerprint);
    assert.match(line, /delegatedAI/u);
    assert.doesNotMatch(line, /latest human review/u);
    assert.equal(contract.summarizeLatestRound(input.ledger as unknown as ReviewLedger).humanPass, false);
  });

  it("refuses unknown reviewer kinds", () => reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.kind = "unknown"; }, /reviewer kind/u));
  it("refuses a delegated AI borrowing a human handle", () => reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.handle = "@Founder"; }, /human review role/u));
  it("refuses an ordinary agent pass even beside a delegation", () => reject((i) => { i.ledger.rounds[0]!.reviewers = [{ kind: "agent", handle: "@SightAI", model: "example" }] as unknown as typeof i.ledger.rounds[0]["reviewers"]; }, /an agent reviewer/u));
  it("refuses missing delegation", () => reject((i) => { Reflect.deleteProperty(i.ledger.rounds[0]!, "delegation"); }, /delegation missing/u));
  it("refuses revoked delegation", () => reject((i) => { i.ledger.rounds[0]!.delegation.revoked = true; }, /revoked/u));
  it("refuses a different release", () => reject((i) => { i.ledger.rounds[0]!.delegation.release = "0.10.0"; }, /release 0\.9\.0/u));
  it("refuses missing session quote", () => reject((i) => { i.ledger.rounds[0]!.delegation.sessionQuote = ""; }, /session quote/u));
  it("refuses an unrecorded actual model", () => {
    for (const value of ["", " ", "UNKNOWN", "unknown", "UNKNOWN (unavailable)"]) reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.actual_model = value; }, /actual_model/u);
  });
  it("refuses UNBEKANNT and n/a as missing actual-model markers", () => {
    for (const value of ["UNBEKANNT", "unbekannt", "UNBEKANNT (not recorded)", "n/a", "N/A"]) {
      reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.actual_model = value; }, /actual_model/u);
    }
  });
  it("refuses missing or malformed prompt and output hashes", () => {
    for (const field of ["promptSha256", "outputSha256"]) reject((i) => { Reflect.set(i.ledger.rounds[0]!.reviewers[0]!, field, "not-a-hash"); }, /SHA-256/u);
  });
  it("refuses a missing native receipt", () => reject((i) => { Reflect.deleteProperty(i.ledger.rounds[0]!.reviewers[0]!, "nativeReceipt"); }, /native receipt/u));
  it("refuses unknown reviewer, delegation, receipt or image fields", () => {
    for (const shape of ["reviewer", "delegation", "receipt", "image"]) reject((i) => {
      const reviewer = i.ledger.rounds[0]!.reviewers[0]!;
      const target = shape === "reviewer" ? reviewer : shape === "delegation" ? i.ledger.rounds[0]!.delegation : shape === "receipt" ? reviewer.nativeReceipt : reviewer.receivedImages[0]!;
      Reflect.set(target, "unregistered", true);
    }, /fields|unknown field/u);
  });
  it("refuses an unseen screen, tile or last A4 page", () => {
    for (const index of [0, 1, 3]) reject((i) => { const r = i.ledger.rounds[0]!.reviewers[0]!; r.receivedImages.splice(index, 1); r.nativeReceipt.imageCount = 3; }, /received images do not match/u);
  });
  it("refuses a wrong image SHA even with the correct path and count", () => reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.receivedImages[3]!.sha256 = sha("different second page"); }, /received images do not match/u));
  it("refuses mismatched native image count", () => reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.nativeReceipt.imageCount = 3; }, /image count/u));
  it("refuses duplicate or extra received images", () => {
    reject((i) => { const r = i.ledger.rounds[0]!.reviewers[0]!; r.receivedImages.push(r.receivedImages[0]!); r.nativeReceipt.imageCount = 5; }, /duplicate received image/u);
    reject((i) => { const r = i.ledger.rounds[0]!.reviewers[0]!; r.receivedImages.push({ path: "unassigned.png", sha256: sha("extra") }); r.nativeReceipt.imageCount = 5; }, /received images do not match/u);
  });
  it("requires the PDF's exact complete raster pair", () => {
    reject((i) => { i.manifest.artifacts.splice(2, 1); Reflect.deleteProperty(i.ledger.rounds[0]!.cells, "print/clean/raster-set"); }, /PDF raster pair/u);
    reject((i) => { Reflect.set(i.manifest.artifacts[1]!, "rasterPageVisualHashes", [sha("first A4 page"), sha("wrong page")]); }, /PDF raster hashes/u);
  });
  it("retains source, environment, pixels, artifact and physical inventory protections", () => {
    reject((i) => { i.fingerprint = sha("changed input"); }, /different source\/input/u);
    reject((i) => { i.manifest.reviewEnvironment.browser = "Chromium 142.0.7390.37"; }, /different declared browser/u);
    reject((i) => { i.ledger.rounds[0]!.cells["screen/clean/light/mobile"].reviewedNormalizedRgbaSha256 = sha("different RGBA"); }, /different visible screen pixels/u);
    reject((i) => { i.ledger.rounds[0]!.cells["print/clean/pdf"].reviewArtifactFingerprint = sha("different artifact"); }, /different rendered artifact/u);
    reject((i) => { i.ledger.rounds[0]!.physicalArtifactsReviewed.rasterPages = 1; }, /physical artifact inventory/u);
  });
  it("does not transfer a historical delegated pass to the current gate", () => reject((i) => { i.ledger.rounds[0]!.record = "historical"; }, /current record/u));
  it("migrates only the schema stamp and preserves all four original review rounds", () => {
    const ledger = JSON.parse(readFileSync(new URL("../golden/report-surfaces/review-ledger.json", import.meta.url), "utf8")) as ReviewLedger;
    assert.equal(ledger.schemaVersion, 6);
    const historical = { ...ledger, rounds: ledger.rounds.slice(0, 4) };
    assert.equal(historical.rounds.length, 4);
    assert.equal(sha(JSON.stringify(historical.rounds)), "d16be7667cdbb2dbb7437ff9824c813b4529a07823302d3ded87c1bd1e9aa573");
    assert.equal(contract.validateReviewLedger(historical).rounds, 4);

    const current = contract.validateReviewLedger(ledger);
    assert.equal(current.rounds, 5);
    assert.equal(current.latest.round, 5);
    assert.ok(current.latest.reviewers.every((reviewer) => reviewer.kind === "delegated-ai"));
    assert.equal(current.latest.delegation?.release, "0.9.0");
    const summary = contract.summarizeLatestRound(ledger);
    assert.equal(summary.passingCells, 32);
    assert.equal(summary.delegatedPassingCells, 32);
    assert.equal(summary.humanPassingCells, 0);
    assert.equal(summary.delegatedPass, true);
    assert.equal(summary.humanPass, false);
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as contract from "../tools/report-surface-contract.mjs";
import type { ReviewLedger } from "../tools/report-surface-contract.mjs";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const LEDGER_URL = new URL("../golden/report-surfaces/review-ledger.json", import.meta.url);
// This independently authored historical fixture binds its own package version. A new
// checkout version must not hide image-membership failures behind an unrelated release error.
const fixtureRoot = mkdtempSync(join(tmpdir(), "breaklint-delegated-fixture-"));
writeFileSync(join(fixtureRoot, "package.json"), JSON.stringify({ version: "0.9.0" }));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

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
  return (assess as (ledger: unknown, manifest: unknown, fingerprint: string, root: string) => { reviewKind: string })(input.ledger, input.manifest, input.fingerprint, fixtureRoot);
}
function reject(change: (input: Fixture) => void, expected: RegExp) {
  const input = fixture(); change(input);
  assert.throws(() => sight(input), expected);
}

describe("delegated AI sight review", () => {
  it("accepts an explicit release delegation and all exact received images as delegatedAI", () => {
    const input = fixture();
    assert.equal(sight(input).reviewKind, "delegatedAI");
    assert.throws(() => contract.assessRosterGate(input.ledger as unknown as ReviewLedger, input.manifest, input.fingerprint), /roster-only/u);
    const line = contract.describeLatestRound(input.ledger as unknown as ReviewLedger, input.manifest, input.fingerprint);
    assert.match(line, /delegatedAI/u);
    assert.doesNotMatch(line, /latest rostered review/u);
    assert.equal(contract.summarizeLatestRound(input.ledger as unknown as ReviewLedger).rosteredPass, false);
  });

  it("refuses unknown reviewer kinds", () => reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.kind = "unknown"; }, /reviewer kind/u));
  it("refuses a delegated AI borrowing a rostered handle", () => reject((i) => { i.ledger.rounds[0]!.reviewers[0]!.handle = "@Founder"; }, /rostered reviewer role/u));
  it("refuses an ordinary agent pass even beside a delegation", () => reject((i) => { i.ledger.rounds[0]!.reviewers = [{ kind: "agent", handle: "@SightAI", model: "example" }] as unknown as typeof i.ledger.rounds[0]["reviewers"]; }, /an agent reviewer/u));
  it("refuses missing delegation", () => reject((i) => { Reflect.deleteProperty(i.ledger.rounds[0]!, "delegation"); }, /delegation missing/u));
  it("refuses revoked delegation", () => reject((i) => { i.ledger.rounds[0]!.delegation.revoked = true; }, /revoked/u));
  it("refuses a release different from its bound package", () => reject((i) => { i.ledger.rounds[0]!.delegation.release = "0.10.0"; }, /does not match bound package version 0\.9\.0/u));
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
  it("migrates only the schema stamp and preserves rounds 1–9 byte for byte", () => {
    const text = readFileSync(LEDGER_URL, "utf8");
    const ledger = JSON.parse(text) as ReviewLedger;
    assert.equal(ledger.schemaVersion, 6);
    const historical = { ...ledger, rounds: ledger.rounds.slice(0, 4) };
    assert.equal(historical.rounds.length, 4);
    assert.equal(sha(JSON.stringify(historical.rounds)), "d16be7667cdbb2dbb7437ff9824c813b4529a07823302d3ded87c1bd1e9aa573");
    assert.equal(contract.validateReviewLedger(historical).rounds, 4);

    const priorFive = { ...ledger, rounds: ledger.rounds.slice(0, 5) };
    assert.equal(priorFive.rounds.length, 5);
    assert.equal(sha(JSON.stringify(priorFive.rounds)), "ffd3ec0c86794e1f0a9ad869aee54636345dbe86bea9c5de71918f944cf03225");
    assert.equal(contract.validateReviewLedger(priorFive).rounds, 5);

    const current = contract.validateReviewLedger(ledger);
    assert.ok(current.rounds >= 9, "the nine existing review rounds must remain");
    assert.equal(current.rounds, ledger.rounds.length);
    assert.equal(current.latest.round, ledger.rounds.length);
    assert.ok(current.latest.reviewers.every((reviewer) => reviewer.kind === "delegated-ai"));
    assert.equal(sha(JSON.stringify(ledger.rounds.slice(0, 6))),
      "5526ecc6f4c90e49c9572e9999495750e93ccd0bb131b688618bf42f16d9a074",
      "the complete six historical rounds remain unchanged");
    assert.equal(sha(JSON.stringify(ledger.rounds.slice(0, 8))),
      "7a5aac35065f6da75b0f15a65b8c2860718adb312058bfdfc59205a0a368f3a2",
      "the complete eight historical rounds remain unchanged");
    assert.equal(sha(JSON.stringify(ledger.rounds.slice(0, 9))),
      "1749cbec9becf140b1fee10a086056f4b3dc9bca82786e514befcd538694990b",
      "the complete nine rounds recorded before the round-10 ledger contract remain unchanged");
    // Byte for byte: the file starts with exactly the canonical two-space rendering of rounds 1–9
    // (schema stamp and purpose included); a later round is appended after round 9's closing brace.
    const nine = JSON.stringify({ ...ledger, rounds: ledger.rounds.slice(0, 9) }, null, 2);
    const prefix = nine.slice(0, nine.lastIndexOf("\n  ]\n}"));
    assert.ok(text.startsWith(prefix), "the ledger file no longer begins with rounds 1–9 exactly as recorded");
    assert.equal(sha(prefix), "f1bee1d75601ee9ec391698ab523cf1fc895b77ba1efe03a39f85efc93378695",
      "the bytes of rounds 1–9 (with schema stamp and purpose) changed");
  });

  it("binds every delegated round to its release by table, and the latest round to this package version", () => {
    const ledger = JSON.parse(readFileSync(LEDGER_URL, "utf8")) as ReviewLedger;
    // {round: release}. A new delegated round adds one row here; it needs no new code.
    const RELEASE_BY_ROUND: Readonly<Record<number, string>> = { 5: "0.9.0", 6: "0.9.0", 7: "0.10.0", 8: "0.10.0", 9: "0.11.0" };
    for (const round of ledger.rounds) {
      if (!round.delegation) continue;
      assert.ok(Object.hasOwn(RELEASE_BY_ROUND, round.round), `delegated round ${round.round} has no row in the {round: release} table`);
      assert.equal(round.delegation.release, RELEASE_BY_ROUND[round.round], `delegated round ${round.round} names release ${round.delegation.release}`);
    }
    const latest = ledger.rounds.at(-1)!;
    const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
    assert.equal(latest.delegation?.release, version,
      `the latest round ${latest.round} delegates release ${latest.delegation?.release ?? "none"}, package.json is ${version}: ` +
        "this release needs its own sight-review round");
  });

  it("the latest round passes all 32 cells under delegated AI, never as a rostered pass", () => {
    const ledger = JSON.parse(readFileSync(LEDGER_URL, "utf8")) as ReviewLedger;
    const summary = contract.summarizeLatestRound(ledger);
    assert.equal(summary.passingCells, 32);
    assert.equal(summary.delegatedPassingCells, 32);
    assert.equal(summary.rosteredPassingCells, 0);
    assert.equal(summary.delegatedPass, true);
    assert.equal(summary.rosteredPass, false);
  });
});

/*
 * From round 10 on the ledger records the Founder's session authorization as a SHA-256 of the
 * verbatim quote plus a fixed neutral statement, and the native receipts as path + SHA-256 + image
 * count in the maintainers' evidence store outside this public repository. Rounds 1–9 keep their
 * original shape and bytes.
 */
describe("review-ledger contract for rounds after 9", () => {
  const NEUTRAL = "release-specific delegation recorded";
  const realLedger = () => JSON.parse(readFileSync(LEDGER_URL, "utf8")) as ReviewLedger;
  /** The nine recorded rounds plus a round 10 cloned from round 9 in the new delegation shape. */
  function withRound10(change: (round: ReviewLedger["rounds"][number]) => void = () => {}) {
    const ledger = realLedger();
    const round = structuredClone(ledger.rounds[8]!);
    round.round = 10;
    round.delegation = { founder: "@Founder", date: round.delegation!.date, sessionQuoteSha256: sha("verbatim session quote"), statement: NEUTRAL, release: "0.11.1", revoked: false } as unknown as NonNullable<typeof round.delegation>;
    for (const reviewer of round.reviewers) {
      if (reviewer.kind !== "delegated-ai") continue;
      reviewer.nativeReceipt.path = `maintainer-evidence:0.11.1/round10-${reviewer.handle.slice(1).toLowerCase()}-native-receipt.json`;
    }
    change(round);
    ledger.rounds.push(round);
    return ledger;
  }
  const delegationOf = (round: ReviewLedger["rounds"][number]) => round.delegation as unknown as Record<string, unknown>;

  it("accepts a round-10 delegation recorded as quote hash and neutral statement, with receipts outside the repository", () => {
    assert.equal(contract.validateReviewLedger(withRound10()).rounds, 10);
  });

  it("refuses a verbatim session quote from round 10 on", () => {
    assert.throws(() => contract.validateReviewLedger(withRound10((round) => {
      const delegation = delegationOf(round);
      Reflect.deleteProperty(delegation, "sessionQuoteSha256");
      Reflect.deleteProperty(delegation, "statement");
      delegation.sessionQuote = "a verbatim chat instruction";
    })), /round 10: .*verbatim session quote/u);
    assert.throws(() => contract.validateReviewLedger(withRound10((round) => { delegationOf(round).sessionQuote = "a verbatim chat instruction"; })),
      /round 10: .*verbatim session quote/u);
  });

  it("refuses a round-10 delegation without a quote hash or with any statement but the neutral one", () => {
    for (const value of [undefined, "", "not-a-hash"]) {
      assert.throws(() => contract.validateReviewLedger(withRound10((round) => {
        if (value === undefined) Reflect.deleteProperty(delegationOf(round), "sessionQuoteSha256");
        else delegationOf(round).sessionQuoteSha256 = value;
      })), /round 10\b.*sessionQuoteSha256/u);
    }
    for (const value of ["", "delegierte KI-Sichtprüfung + Freigabe", `${NEUTRAL}.`]) {
      assert.throws(() => contract.validateReviewLedger(withRound10((round) => { delegationOf(round).statement = value; })), /round 10: .*neutral statement/u);
    }
  });

  it("refuses a round-10 native receipt kept in the repository", () => {
    for (const path of ["tests/golden/report-surfaces/delegated-ai-0111-round10-clean-native-receipt.json", "/abs/receipt.json",
      "maintainer-evidence:../tests/golden/receipt.json", "maintainer-evidence:", "evidence:receipt.json"]) {
      assert.throws(() => contract.validateReviewLedger(withRound10((round) => {
        const reviewer = round.reviewers.find((entry) => entry.kind === "delegated-ai");
        if (reviewer?.kind === "delegated-ai") reviewer.nativeReceipt.path = path;
      })), /round 10 reviewer 1: native receipt .*outside the repository/u, path);
    }
  });

  it("rounds 1–9 keep their recorded delegation shape", () => {
    const ledger = realLedger();
    for (const round of ledger.rounds.slice(0, 9)) {
      if (!round.delegation) continue;
      assert.deepEqual(Object.keys(round.delegation).sort(), ["date", "founder", "release", "revoked", "sessionQuote"]);
    }
  });

  it("the repository holds native receipts only for rounds 1–9, each byte-identical to its ledger record", () => {
    const ledger = realLedger();
    const recorded = new Map<string, string>();
    for (const round of ledger.rounds) {
      for (const reviewer of round.reviewers) {
        if (reviewer.kind !== "delegated-ai") continue;
        if (round.round > 9) {
          assert.match(reviewer.nativeReceipt.path, /^maintainer-evidence:/u, `round ${round.round} keeps its native receipt in the repository`);
          continue;
        }
        recorded.set(reviewer.nativeReceipt.path, reviewer.nativeReceipt.sha256);
      }
    }
    const directory = fileURLToPath(new URL("../golden/report-surfaces/", import.meta.url));
    const present = readdirSync(directory).filter((name) => name.endsWith("-native-receipt.json")).map((name) => `tests/golden/report-surfaces/${name}`).sort();
    assert.deepEqual(present, [...recorded.keys()].sort(), "a native receipt file in the repository is not one of rounds 1–9");
    for (const [path, digest] of recorded) {
      assert.equal(createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex"), digest, `${path} changed`);
    }
  });

  it("the strict sight gate accepts a complete round-10 delegated review in the new shape", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-delegated-round10-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.11.1" }));
      const input = fixture();
      const round = input.ledger.rounds[0]! as unknown as ReviewLedger["rounds"][number];
      const at = "2026-11-21T11:00:00.000Z";
      round.round = 10;
      round.reviewedAt = at;
      for (const cell of Object.values(round.cells!)) cell.reviewedAt = at;
      round.delegation = { founder: "@Founder", date: "2026-11-21", sessionQuoteSha256: sha("verbatim session quote"), statement: NEUTRAL, release: "0.11.1", revoked: false } as unknown as NonNullable<typeof round.delegation>;
      const reviewer = round.reviewers[0]!;
      if (reviewer.kind === "delegated-ai") reviewer.nativeReceipt.path = "maintainer-evidence:0.11.1/round10-sightai-native-receipt.json";
      // Nine pending placeholder rounds put the synthetic three-cell round at number 10.
      const placeholders = Array.from({ length: 9 }, (_, index) => ({
        round: index + 1, record: "current", outcome: "pending", reviewedAt: null, reviewers: [], binding: null,
        findings: { blocker: 0, high: 0, medium: 0, low: 0 }, cells: null, note: "Synthetic placeholder round; no review.",
      }));
      const ledger = { schemaVersion: 6, rounds: [...placeholders, round] };
      const assess = Reflect.get(contract, "assessSightGate") as (l: unknown, m: unknown, f: string, r: string) => { reviewKind: string };
      assert.equal(assess(ledger, input.manifest, input.fingerprint, root).reviewKind, "delegatedAI");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

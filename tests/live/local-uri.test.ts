/**
 * artifact/local-uri against what the browser actually fetched, through the real chain.
 *
 * `tests/fixtures/local-uri-late-base.html` puts an image and an applied style-sheet url() BEFORE a
 * late `<base href="https://…">`, and a hyperlink on either side of it. The browser resolves a
 * fetch when its element is parsed, so both resources come from the local tree (the loopback root
 * is the fixture directory) and are in the PDF; it resolves a hyperlink against the final base.
 * The unit suite reads the same fixture through the collector alone; only a live run shows that the
 * two fetches really happened, and that nothing was requested from the base host.
 *
 * Red condition: apply the base to the whole document in the collector, and the two fetched
 * references become "remote" — no finding, and `requested` false because the https URL was never
 * requested. The run uses no evidence binding: binding decides whether a finding may point at the
 * evidence, not what was fetched.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderDocuments, type RenderResult } from "../../src/acquire/render-run.ts";
import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import { runDocument } from "../../src/core/engine.ts";
import { localUri } from "../../src/rules/artifact/local-uri.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(REPO, "tests", "fixtures", "local-uri-late-base.html");
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

describe("artifact/local-uri before a late base, live", () => {
  let outDir = "";
  let result: RenderResult | null = null;

  before(async (t) => {
    if (missing.length > 0) {
      if (optional) return (t as { skip(message: string): void }).skip(`missing: ${missing.join(", ")}`);
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    outDir = mkdtempSync(join(tmpdir(), "breaklint-local-uri-live-"));
    result = await renderDocuments([FIXTURE], {
      outDir,
      evidenceBinding: false,
      sourceMapInjection: true,
      network: { mode: "offline", allowed: [] },
      locale: "de-DE",
    });
  });

  after(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("fetches the image and the style-sheet url() before the base locally, and reports both", () => {
    assert.equal(result?.fatal, null, `fatal: ${result?.fatal?.message}`);
    const document = result!.documents[0]!;
    assert.ok(document.snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    const snapshot = document.snapshot;
    const byValue = new Map(snapshot.uriRefs.map((ref) => [`${ref.attribute}=${ref.rawValue}`, ref]));
    for (const key of ["src=/baseline.svg", "style-sheet=/changed.svg"]) {
      const ref = byValue.get(key);
      assert.ok(ref, `the collector lost ${key}`);
      assert.match(ref.resolvedUri, /^file:\/\/\/.+\/tests\/fixtures\/(?:baseline|changed)\.svg$/u, `${key} was not resolved into the local tree`);
      assert.equal(ref.requested, true, `${key} was not requested from the local tree: ${ref.resolvedUri}`);
    }
    const local = snapshot.resources.filter((resource) => /\/(?:baseline|changed)\.svg$/u.test(resource.resolvedUri));
    assert.deepEqual(local.map((resource) => [resource.resolvedUri.replace(/^.*\//u, ""), resource.status]).sort(), [["baseline.svg", 200], ["changed.svg", 200]]);
    assert.deepEqual(snapshot.resources.filter((resource) => resource.resolvedUri.includes("docs.example.org")), [], "something was requested from the base host");

    const { report } = runDocument(document, { failOn: "never", activeRules: [localUri], optionsByRule: {}, coverageFloors: {} });
    assert.notEqual(report.verdict, "infrastructure", JSON.stringify(report.infrastructure));
    const pairs = report.findings.map((finding) => /([a-z:-]+="[^"]*")/u.exec(finding.message)?.[1]);
    assert.deepEqual(pairs, ['style-sheet="/changed.svg"', 'src="/baseline.svg"']);
    assert.ok(report.findings.every((finding) => finding.ruleId === "artifact/local-uri" && !finding.message.includes("never fetched")));
  });

  it("resolves both hyperlinks on the base host and reports neither", () => {
    const snapshot = result!.documents[0]!.snapshot!;
    for (const value of ["/docs/early.html", "/docs/late.html"]) {
      const ref = snapshot.uriRefs.find((item) => item.rawValue === value);
      assert.equal(ref?.resolvedUri, `https://docs.example.org${value}`);
    }
  });
});

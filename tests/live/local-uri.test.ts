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
 *
 * The second half is about breaklint's own paginator under an EARLY base. Paged.js 0.4.3 re-fetches
 * a <style>'s @import resolved against the document URL, ignoring <base>, so it asks the loopback
 * origin for `/imp.css` while the browser took the sheet from the (allow-listed) base host. The base
 * host here is a second loopback server. THE COMPLICATION is that a discovery which skips references
 * under the base serves nothing for that request: Paged.js receives a 403, paginates the document
 * without the sheet, and a clean report comes out over a different document — the imported rule
 * makes `#big` 200 px tall, and without it the block is one 20 px line. Red conditions: skip
 * base-governed references in discovery (the round-2 change) and `#big` measures 20 px; drop the
 * fail-closed rule for a failed style-sheet route and the host-only import measures a smaller page
 * instead of ending with source-acquisition-failed.
 *
 * Four more import forms go through the same two outcomes, because each once escaped discovery or the
 * route guard: `@import"…"` and `@import'…'` with no whitespace (every per-reader regex required
 * some), `@import url("…")` (the url() form of an import) and an @import nested inside a captured
 * local sheet. Red conditions: the previous regexes (no-space leaves), import-kind for url() lost
 * (url leaf), nested imports not marked as style-sheet routes (nested leaf).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

/** A document with an early base to `host` and a head <style> holding the import rule `rule`. */
function earlyBaseImport(host: string, rule: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>import under a base</title>' +
    `<base href="${host}/manual/">` +
    '<style>@page { size: 400px 600px; margin: 40px; } body { font: 14px/20px serif; margin: 0; } p { margin: 0 0 4px; }</style>' +
    `<style>${rule}</style></head>` +
    '<body><p>An imported sheet under an early base.</p><div id="big" class="big">tall block</div><p>after</p></body></html>';
}

describe("artifact/local-uri and the document base, live", () => {
  let outDir = "";
  let result: RenderResult | null = null;
  let host: Server | null = null;
  let hostOrigin = "";
  const hostRequests: string[] = [];
  const imported: Record<string, RenderResult> = {};

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

    // The base host serves every sheet below. Beside the document, only `local` exists.
    const BIG = ".big { height: 200px; }";
    const sheets: Record<string, string> = {
      "/imp.css": BIG, "/host-only.css": BIG, "/a.css": '@import "nested-host-only.css";', "/nested-host-only.css": BIG,
    };
    host = createServer((request, response) => {
      const path = (request.url ?? "").split("?")[0]!;
      hostRequests.push(path);
      const body = sheets[path];
      if (body === undefined) response.writeHead(404).end();
      else response.writeHead(200, { "content-type": "text/css", "access-control-allow-origin": "*" }).end(body);
    });
    await new Promise<void>((resolve) => host!.listen(0, "127.0.0.1", resolve));
    hostOrigin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
    // Each case names its complication. `local` is what exists beside the document.
    const importCases: { name: string; rule: string; local: Record<string, string> }[] = [
      { name: "local-copy", rule: '@import "/imp.css";', local: { "imp.css": BIG } },
      { name: "host-only", rule: '@import "/host-only.css";', local: {} },
      // Valid CSS with no whitespace after @import: every per-reader regex used to miss it.
      { name: "nospace-local-copy", rule: '@import"/imp.css";', local: { "imp.css": BIG } },
      { name: "nospace-host-only", rule: "@import'/host-only.css';", local: {} },
      // The url() form of @import with a quoted argument.
      { name: "url-quoted-host-only", rule: '@import url("/host-only.css");', local: {} },
      // A nested import inside a captured local sheet: Paged.js resolves it against that sheet.
      { name: "nested-host-only", rule: '@import "/a.css";', local: { "a.css": '@import "nested-host-only.css";' } },
    ];
    for (const { name, rule, local } of importCases) {
      const dir = join(outDir, name);
      mkdirSync(dir);
      for (const [file, text] of Object.entries(local)) writeFileSync(join(dir, file), text);
      writeFileSync(join(dir, "doc.html"), earlyBaseImport(hostOrigin, rule));
      imported[name] = await renderDocuments([join(dir, "doc.html")], {
        outDir: join(dir, "out"),
        evidenceBinding: false,
        sourceMapInjection: true,
        network: { mode: "allowlist", allowed: [hostOrigin] },
        locale: "de-DE",
      });
    }
  });

  after(async () => {
    if (host) await new Promise<void>((resolve) => host!.close(() => resolve()));
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

  it("serves the paginator's own @import request under an early base, so the imported rule applies", () => {
    const run = imported["local-copy"]!;
    assert.equal(run.fatal, null, `fatal: ${run.fatal?.message}`);
    const document = run.documents[0]!;
    assert.ok(document.snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    const local = document.snapshot.resources.filter((resource) => resource.resolvedUri.endsWith("/imp.css") && resource.scheme === "file");
    assert.deepEqual(local.map((resource) => resource.status), [200], "the paginator's loopback request for /imp.css was not served");
    const big = document.snapshot.blocks.find((block) => block.authorId === "big");
    assert.equal(big?.box.height, 200, "the document was paginated without its imported sheet");
  });

  it("ends with source-acquisition-failed when the paginator's style-sheet request is refused", () => {
    // /host-only.css exists on the base host only: the browser loads it there, Paged.js asks the
    // loopback origin, which cannot serve it. Measuring on would judge a page without the sheet.
    const run = imported["host-only"]!;
    const document = run.documents[0]!;
    assert.ok(hostRequests.includes("/host-only.css"), "the browser never took the sheet from the base host");
    assert.equal(document.snapshot, null, "a page paginated without its imported sheet was measured");
    assert.ok(
      document.infrastructure.some((event) => event.kind === "source-acquisition-failed" && /host-only\.css/u.test(event.detail)),
      JSON.stringify(document.infrastructure),
    );
  });

  const assertServed = (name: string): void => {
    const run = imported[name]!;
    assert.equal(run.fatal, null, `fatal: ${run.fatal?.message}`);
    const document = run.documents[0]!;
    assert.ok(document.snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    const local = document.snapshot.resources.filter((resource) => resource.resolvedUri.endsWith("/imp.css") && resource.scheme === "file");
    assert.deepEqual(local.map((resource) => resource.status), [200], "the paginator's loopback request for /imp.css was not served");
    assert.equal(document.snapshot.blocks.find((block) => block.authorId === "big")?.box.height, 200, "the document was paginated without its imported sheet");
  };
  const assertRefused = (name: string, sheet: string): void => {
    const document = imported[name]!.documents[0]!;
    assert.ok(hostRequests.includes(`/${sheet}`), `the browser never took ${sheet} from the base host`);
    assert.equal(document.snapshot, null, "a page paginated without its imported sheet was measured");
    assert.ok(
      document.infrastructure.some((event) => event.kind === "source-acquisition-failed" && event.detail.includes(sheet)),
      JSON.stringify(document.infrastructure),
    );
  };

  it("serves a no-space @import\"…\" the paginator requests under an early base", () => assertServed("nospace-local-copy"));
  it("refuses to measure when a no-space @import'…' is available only on the base host", () => assertRefused("nospace-host-only", "host-only.css"));
  it("refuses to measure when an @import url(\"…\") is available only on the base host", () => assertRefused("url-quoted-host-only", "host-only.css"));
  it("refuses to measure when a nested @import inside a captured sheet is available only on the base host", () => assertRefused("nested-host-only", "nested-host-only.css"));
});

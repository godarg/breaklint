import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderDocuments, type RenderOptions } from "../../src/acquire/render-run.ts";
import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import { exitCodeFor, runDocument } from "../../src/core/engine.ts";
import { resolveConfig, coverageFloorMap } from "../../src/config/resolve.ts";

const REPO = new URL("../..", import.meta.url).pathname;
const missing = [resolveBrowser().path ? null : "Chrome", resolvePackageRoot("pagedjs", REPO) ? null : "Paged.js",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist"].filter(Boolean);

function options(outDir: string): RenderOptions {
  return { outDir, evidenceBinding: false, sourceMapInjection: true,
    network: { mode: "offline", allowed: [] }, locale: "en-US" };
}

describe("silent content loss boundaries", () => {
  it("refuses a body column container and a display: contents heading", async (t) => {
    if (missing.length) return t.skip(`missing: ${missing.join(", ")}`);
    const root = mkdtempSync(join(tmpdir(), "breaklint-p2-loss-"));
    try {
      const bodyColumns = join(root, "body-columns.html");
      const contentsHeading = join(root, "contents-heading.html");
      writeFileSync(bodyColumns, `<!doctype html><style>@page{size:A5;margin:12mm}body{column-count:1}</style><main>${"<p>Words on this printed page.</p>".repeat(35)}</main>`);
      writeFileSync(contentsHeading, `<!doctype html><style>@page{size:A5;margin:12mm}h2{display:contents}</style><h2>${"Heading continuation words ".repeat(45)}</h2><p>Following paragraph.</p>`);
      const result = await renderDocuments([bodyColumns, contentsHeading], options(join(root, "evidence")));
      assert.equal(result.fatal, null, result.fatal?.message);
      const config = resolveConfig({ file: {}, cli: {} });
      const missed: string[] = [];
      for (const [index, reason] of ["body-column-container", "contents-heading"].entries()) {
        const document = result.documents[index];
        assert.ok(document, `missing document ${index}`);
        if (!document.infrastructure.some((event) => event.kind === "source-layout-unsupported" && event.detail.includes(reason))) {
          missed.push(`${reason}: no diagnostic; events=${JSON.stringify(document.infrastructure.map((event) => event.kind))}`);
        }
        const outcome = runDocument(document, { failOn: config.failOn, activeRules: config.activeRules,
          optionsByRule: config.optionsByRule, coverageFloors: coverageFloorMap(config) });
        if (outcome.report.verdict !== "infrastructure" || exitCodeFor(outcome.report.verdict) !== 3) {
          missed.push(`${reason}: verdict=${outcome.report.verdict}, exit=${exitCodeFor(outcome.report.verdict)}`);
        }
      }
      assert.deepEqual(missed, [], `silent content loss cases were accepted:\n${missed.join("\n")}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

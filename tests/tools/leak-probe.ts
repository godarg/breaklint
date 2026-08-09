/**
 * A child process that opens a rasteriser against a deliberately broken browser and then ends.
 *
 * It exists because the symptom of a leaked loopback server is not a value anybody can read: it
 * is a process that finishes its work and does not exit, because a listening socket keeps the
 * event loop alive. `process.getActiveResourcesInfo()` is not an oracle for it — measured, the
 * entry for a server stays in the list after `close()` has already run. So the test spawns this
 * file and asks the only question that matters: did it end?
 *
 * `argv[2]` is where the fake browser fails: `newPage`, `goto`, `evaluate`, `never`, or `leak`
 * for the positive control, which starts a server and deliberately keeps it.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePackageRoot, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import { openRasterizer } from "../../src/render/rasterizer.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const failAt = process.argv[2] ?? "never";
const pdfRoot = resolvePackageRoot("pdfjs-dist", REPO);
const declaredVersion = pdfRoot
  ? (JSON.parse(readFileSync(join(pdfRoot, "package.json"), "utf8")) as { version: string }).version
  : "missing";

if (failAt === "leak") {
  // The control. If this one exits too, the probe is measuring nothing.
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1", () => process.stdout.write("leaking\n"));
} else {
  const page: PageLike = {
    async goto() {
      if (failAt === "goto") throw new Error("probe: goto failed");
      return undefined;
    },
    async setContent() {},
    async evaluate() {
      if (failAt === "evaluate") throw new Error("probe: evaluate failed");
      return (failAt === "version-mismatch" ? "0.0.0" : declaredVersion) as never;
    },
    async waitForFunction() {
      return undefined;
    },
    async emulateMediaType() {},
    async setViewport() {},
    async pdf() {
      return new Uint8Array();
    },
    on() {},
    async close() {},
  };
  const browser: BrowserLike = {
    async newPage() {
      if (failAt === "newPage") throw new Error("probe: newPage failed");
      return page;
    },
    async version() {
      return "fake";
    },
    async close() {},
  };

  const result = await openRasterizer(browser, { fromDir: REPO, contentPagesOpen: () => 0 });
  process.stdout.write(`${result.rasterizer === null ? "refused" : "opened"}\n`);
  // On the success path the caller owns the rasteriser and closing it is its job — which is
  // exactly what the product does. Not closing it here would test the wrong thing.
  if (result.rasterizer) await result.rasterizer.close();
}

/** Self-authored HTTP transports verify CDP pending against an independent server boundary. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { configureNetwork, awaitNetworkQuiet, closeBrowserBounded, cleanupBrowserProfile } from "../../src/acquire/render-run.ts";
import { launchBrowser, ownServerLifecycle } from "../../src/acquire/browser.ts";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const options = { outDir: ".tmp/network-live", evidenceBinding: true, sourceMapInjection: true,
  network: { mode: "offline" as const, allowed: [] }, locale: "en-US" };

describe("CDP lifecycle at the real HTTP boundary", () => {
  it("keeps an unfinished transport pending, handles redirects and records failed transport", async () => {
    let release!: () => void;
    const arrived: string[] = [];
    const server = createServer((req, res) => {
      arrived.push(req.url ?? "");
      if (req.url === "/held") { release = () => res.end("self-authored held response"); return; }
      if (req.url === "/redirect") { res.writeHead(302, { location: "/finished" }); res.end(); return; }
      if (req.url === "/failed") { req.socket.destroy(); return; }
      if (req.url === "/finished") { res.end("self-authored completed response"); return; }
      res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>Transport fixture</title><p>Original fixture text.</p>");
    });
    const ownership = ownServerLifecycle(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const launched = await launchBrowser(repo);
    assert.ok(launched.browser, launched.detail);
    const context = await launched.browser.createBrowserContext!();
    const page = await context.newPage();
    const tracker = await configureNetwork(page, origin, options, { count: 0 });
    try {
      await page.goto(origin, { waitUntil: "networkidle0" });
      assert.equal(await awaitNetworkQuiet(tracker, 400), true);
      await page.evaluate(`void fetch('/held'); void fetch('/finished')`);
      const deadline = Date.now() + 5000;
      while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(release, "independent HTTP server observed the held request");
      assert.equal(await awaitNetworkQuiet(tracker, 75), false);
      assert.ok([...tracker.inFlight.values()].some(value => value.url.endsWith("/held")));
      release(); assert.equal(await awaitNetworkQuiet(tracker, 1500), true);
      await page.evaluate(`fetch('/redirect').then(response => response.text())`);
      assert.ok(arrived.includes("/redirect") && arrived.includes("/finished"));
      assert.equal(await awaitNetworkQuiet(tracker, 1500), true);
      await page.evaluate(`fetch('/failed').catch(() => null)`);
      assert.equal(await awaitNetworkQuiet(tracker, 1500), false);
      assert.ok(arrived.includes("/failed"));
      assert.match(tracker.errors.join("; "), /network lifecycle transport failed/u);
    } finally {
      release?.();
      await tracker.close(); await page.close(); await context.close();
      assert.equal(await closeBrowserBounded(launched.browser), null);
      assert.equal(cleanupBrowserProfile(launched.userDataDir), null);
      const closed = await ownership.close(5000); assert.equal(closed, null);
    }
  });
});

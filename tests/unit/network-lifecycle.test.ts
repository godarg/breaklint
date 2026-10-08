/** Independent hand-authored transport events; no expected value comes from the tracker. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { configureNetwork, awaitNetworkQuiet, resourceFailureDetail } from "../../src/acquire/render-run.ts";
import type { CdpSessionLike, PageLike, RequestLike } from "../../src/acquire/browser.ts";

class Session extends EventEmitter implements CdpSessionLike {
  commands: string[] = [];
  detached = 0;
  failEnable = false;
  failDetach = false;
  async send<R>(method: string): Promise<R> {
    this.commands.push(method);
    if (this.failEnable) throw new Error("independent enable refusal");
    return {} as R;
  }
  async detach(): Promise<void> {
    this.detached += 1;
    if (this.failDetach) throw new Error("independent detach refusal");
  }
}
class Page extends EventEmitter {
  session = new Session();
  async createCDPSession(): Promise<CdpSessionLike> { return this.session; }
  async setRequestInterception(): Promise<void> {}
}
const options = { outDir: ".tmp/network-lifecycle", evidenceBinding: true, sourceMapInjection: true,
  network: { mode: "allowlist" as const, allowed: ["https://assets.example"] }, locale: "en-US" };
const url = "http://127.0.0.1:1234/fonts/original.woff2";
const request = (uri = url): RequestLike => ({ url: () => uri, continue: async () => {}, abort: async () => {} });
const start = (page: Page, id: string, uri = url, extra: Record<string, unknown> = {}) =>
  page.session.emit("Network.requestWillBeSent", { requestId: id, type: "Font", request: { url: uri }, ...extra });
const finish = (page: Page, id: string) => page.session.emit("Network.loadingFinished", { requestId: id });
const setup = async (page = new Page(), deploymentDeniedRoutes: ReadonlySet<string> = new Set()) => ({ page, tracker: await configureNetwork(page as unknown as PageLike,
  "http://127.0.0.1:1234", options, { count: 0 }, deploymentDeniedRoutes) });
const close = async (tracker: Awaited<ReturnType<typeof configureNetwork>>) => {
  // Added lifecycle cleanup is tested directly without hiding an absent production boundary.
  await (tracker as typeof tracker & { close: () => Promise<void> }).close();
};

describe("public CDP network lifecycle", () => {
  it("finishes one transport despite two distinct Puppeteer request objects", async () => {
    const { page, tracker } = await setup();
    try {
      start(page, "font-1");
      const first = request(), second = request();
      page.emit("request", first); page.emit("request", second);
      page.emit("requestfinished", second); finish(page, "font-1");
      assert.equal(await awaitNetworkQuiet(tracker, 350), true);
      assert.equal(tracker.inFlight.size, 0);
    } finally { if ("close" in tracker) await close(tracker); }
  });
  it("keeps a real pending transport even after Puppeteer claims completion", async () => {
    const { page, tracker } = await setup();
    try {
      start(page, "pending");
      const own = request(); page.emit("request", own); page.emit("requestfinished", own);
      assert.equal(await awaitNetworkQuiet(tracker, 35), false);
      assert.equal(tracker.inFlight.size, 1);
    } finally { if ("close" in tracker) await close(tracker); }
  });
  it("does not collapse concurrent transports with the same URL", async () => {
    const { page, tracker } = await setup();
    try {
      start(page, "same-url-a"); start(page, "same-url-b"); finish(page, "same-url-a");
      assert.equal(await awaitNetworkQuiet(tracker, 35), false);
      assert.equal(tracker.inFlight.size, 1);
      finish(page, "same-url-b"); assert.equal(await awaitNetworkQuiet(tracker, 350), true);
    } finally { if ("close" in tracker) await close(tracker); }
  });
  it("keeps a redirected ID pending until the final hop completes", async () => {
    const { page, tracker } = await setup();
    try {
      start(page, "redirect"); start(page, "redirect", "http://127.0.0.1:1234/fonts/next.woff2",
        { redirectResponse: { status: 302, url } });
      assert.equal(await awaitNetworkQuiet(tracker, 35), false);
      assert.equal(tracker.inFlight.size, 1);
      finish(page, "redirect"); assert.equal(await awaitNetworkQuiet(tracker, 350), true);
    } finally { if ("close" in tracker) await close(tracker); }
  });
  it("records a failed transport as fatal provenance rather than leaving phantom pending", async () => {
    const { page, tracker } = await setup();
    try {
      start(page, "failed"); page.session.emit("Network.loadingFailed", { requestId: "failed", errorText: "net::ERR_FAILED" });
      assert.equal(tracker.inFlight.size, 0);
      assert.match(tracker.errors.join("; "), /transport failed.*ERR_FAILED/u);
      assert.equal(await awaitNetworkQuiet(tracker, 350), false);
    } finally { if ("close" in tracker) await close(tracker); }
  });
  it("settles observed loopback deny cancellations only for ambient or source-declared omitted deployment requests", async () => {
    for (const control of [
      { type: "Fetch", route: "/fonts/original.woff2", declared: false },
      { type: "Stylesheet", route: "/styles.css", declared: true },
      { type: "Script", route: "/assets/nav.js", declared: true },
    ]) {
      const uri = "http://127.0.0.1:1234" + control.route;
      const { page, tracker } = await setup(new Page(), new Set(control.declared ? [control.route] : []));
      try {
        start(page, "denied", uri, { type: control.type });
        assert.equal(await awaitNetworkQuiet(tracker, 35), false, "a known route is not terminal evidence");
        page.session.emit("Network.responseReceived", { requestId: "denied", response: { status: 403, url: uri } });
        page.session.emit("Network.loadingFailed", { requestId: "denied", errorText: "net::ERR_ABORTED", canceled: true });
        assert.equal(tracker.inFlight.size, 0);
        assert.deepEqual(tracker.errors, [], JSON.stringify(control));
        assert.equal(await awaitNetworkQuiet(tracker, 350), true);
      } finally { await close(tracker); }
    }
  });
  it("keeps other cancellation and resource failure cases fatal", async () => {
    for (const control of [
      { type: "Fetch", uri: url, status: 200, canceled: true, errorText: "net::ERR_ABORTED" },
      { type: "Fetch", uri: "https://assets.example/private-resource", status: 403, canceled: true, errorText: "net::ERR_ABORTED" },
      { type: "Stylesheet", uri: url, status: 403, canceled: true, errorText: "net::ERR_ABORTED" },
      { type: "Font", uri: url, status: 403, canceled: true, errorText: "net::ERR_ABORTED" },
      { type: "Fetch", uri: url, status: 403, canceled: false, errorText: "net::ERR_FAILED" },
      { type: "Fetch", uri: url, status: null, canceled: true, errorText: "net::ERR_ABORTED" },
      { type: "Script", uri: url, status: 403, canceled: true, errorText: "net::ERR_ABORTED" },
      { type: "Script", uri: url, status: 403, canceled: true, errorText: "net::ERR_ABORTED", declared: ["/other.js"] },
      { type: "Font", uri: url, status: 403, canceled: true, errorText: "net::ERR_ABORTED", declared: ["/fonts/original.woff2"] },
      { type: "Stylesheet", uri: url, status: 200, canceled: true, errorText: "net::ERR_ABORTED", declared: ["/fonts/original.woff2"] },
    ]) {
      const { page, tracker } = await setup(new Page(), new Set(control.declared ?? []));
      try {
        start(page, "negative", control.uri, { type: control.type });
        if (control.status !== null) page.session.emit("Network.responseReceived", { requestId: "negative", response: { status: control.status, url: control.uri } });
        page.session.emit("Network.loadingFailed", { requestId: "negative", errorText: control.errorText, canceled: control.canceled });
        assert.equal(tracker.inFlight.size, 0);
        assert.match(tracker.errors.join("; "), /transport failed/u, JSON.stringify(control));
        assert.equal(await awaitNetworkQuiet(tracker, 350), false);
      } finally { await close(tracker); }
    }
  });
  it("rejects an unjoined or malformed response observation", async () => {
    const { page, tracker } = await setup();
    try {
      page.session.emit("Network.responseReceived", { requestId: "not-started", response: { status: 403, url } });
      start(page, "bad-status", url, { type: "Fetch" });
      page.session.emit("Network.responseReceived", { requestId: "bad-status", response: { status: "403", url } });
      finish(page, "bad-status");
      assert.match(tracker.errors.join("; "), /response/u);
      assert.equal(await awaitNetworkQuiet(tracker, 350), false);
    } finally { await close(tracker); }
  });
  it("requires event measurement and detaches after enable failure", async () => {
    const page = new Page(); page.session.failEnable = true;
    await assert.rejects(setup(page), /enable refusal/u); assert.equal(page.session.detached, 1);
    const missing = new Page();
    Object.defineProperty(missing, "createCDPSession", { value: undefined });
    await assert.rejects(setup(missing), /network lifecycle session/u);
    const unavailable = new Page();
    Object.defineProperty(unavailable.session, "on", { value: undefined });
    await assert.rejects(setup(unavailable), /network lifecycle events/u);
    assert.equal(unavailable.session.detached, 1);
  });
  it("does not let a completed transport bypass an unfinished resource body", async () => {
    const { page, tracker } = await setup();
    let release!: (value: Buffer) => void;
    const body = new Promise<Buffer>(resolve => { release = resolve; });
    const own = { ...request("https://assets.example/font.woff2"), response: () => ({
      url: () => "https://assets.example/font.woff2", status: () => 200, buffer: () => body,
    }) };
    try {
      start(page, "body", own.url()); page.emit("request", own); page.emit("requestfinished", own); finish(page, "body");
      assert.equal(await awaitNetworkQuiet(tracker, 35), false);
      release(Buffer.from("self-authored resource"));
      assert.equal(await awaitNetworkQuiet(tracker, 350), true);
      assert.equal(tracker.resources[0]?.outcome, "loaded");
    } finally { release(Buffer.alloc(0)); if ("close" in tracker) await close(tracker); }
  });
  it("surfaces session disconnect, malformed events and cleanup failure", async () => {
    const { page, tracker } = await setup();
    page.session.emit("Network.requestWillBeSent", { requestId: 42 });
    page.session.emit("Disconnected");
    assert.match(tracker.errors.join("; "), /network lifecycle/u);
    page.session.failDetach = true;
    await assert.rejects(close(tracker), /detach refusal/u);
    assert.equal(page.session.detached, 1);
  });
});


describe("failed resource diagnostic identity", () => {
  it("uses the observed logical route and keeps status without exposing a host directory", () => {
    const local = { resolvedUri: "file:///fixture-host/private-root/absent.css", status: 404 };
    assert.equal(resourceFailureDetail(local, "/build/absent.css"), "/build/absent.css (404)");
    assert.equal(resourceFailureDetail(local), "absent.css (404)");
    assert.equal(resourceFailureDetail({ resolvedUri: "artifact:/favicon.ico", status: 403 }), "artifact:/favicon.ico (403)");
  });
  it("withholds URL credentials, query, fragment and inline resource payload", () => {
    assert.equal(resourceFailureDetail({ resolvedUri: "https://fixture-user:fixture-password@assets.example/absent.css?private=fixture-query#fixture-fragment", status: null }),
      "https://assets.example/absent.css (unknown status)");
    assert.equal(resourceFailureDetail({ resolvedUri: "data:text/css,body%7Bcolor:red%7D", status: null }),
      "data:[payload withheld] (unknown status)");
    assert.equal(resourceFailureDetail({ resolvedUri: "invalid identity fixture", status: null }),
      "[unavailable resource identity] (unknown status)");
  });
});

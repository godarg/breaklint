/**
 * The evidence rasteriser.
 *
 * Four decisions in this file are measured rather than chosen, and each of them was the answer
 * to a failed attempt:
 *
 *   1. `pdfjs-dist` runs in the browser, not in Node. In Node it wants a native canvas binding,
 *      which would make the tool depend on a system package. It does not need one where a
 *      browser is already running — and Paged.js means one always is. The rasteriser is a
 *      second page of the same instance.
 *
 *   2. Raw images do not cross the control bridge. One A5 page at 96 dpi is roughly 1.4 million
 *      numbers; transferring them runs into the driver's timeout. So the comparison happens
 *      where the images are, and only a verdict — page count, dimensions, number of differing
 *      pixels — comes back. A PNG does cross, because it is compressed, and that is the one
 *      shape the evidence path actually needs.
 *
 *   3. Rasterising must happen AFTER the content page is closed. Measured at the product, not
 *      inherited: with a paginated page open the rasteriser did not answer inside the live
 *      suite's 15 s window; with every page closed the same PDF came back with its pages in
 *      well under a second (84 ms and 119 ms on two runs). `contentPagesOpen` is therefore a
 *      REQUIRED argument. It was optional once, which meant the rule held for exactly one
 *      caller: the test that wired it.
 *
 *   4. The rasteriser is served over a loopback HTTP origin, not read from `file://`. Loading it
 *      from disk needs `--allow-file-access-from-files`, and that switch is browser-wide: it
 *      would also apply to the audited document, which is untrusted HTML. Measured: without the
 *      switch the `file://` arrangement does not load at all, so this is not a preference — it
 *      is the only way to have the rasteriser without widening what a hostile document may read.
 *
 * The version reported by `Rasterizer.version` is read from the library that was loaded, not
 * from a `package.json`. A silent skew between the declared and the loaded build would
 * otherwise be invisible, and `environment.rasterizerVersion` would be a claim about a file
 * nobody executed.
 *
 * What this file does NOT solve, stated rather than left to be discovered: it holds a whole
 * rasterised document in the page at once. Peak memory grows with the page count, and a long
 * book can exhaust the rasteriser page. The pixel buffers are dropped as soon as the comparison
 * is done and only the canvases are kept for encoding, which halves the peak after that point —
 * but the comparison itself still needs both documents resident.
 */

import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

import type { BrowserLike, PageLike } from "../acquire/browser.ts";
import { SUPPORTED_PDFJS_VERSION } from "../core/enums.ts";
import { ownServerLifecycle, resolvePackageRoot, type OwnedServerLifecycle } from "../acquire/browser.ts";
import type { Rasterizer as RasterizerName } from "../core/enums.ts";

/** Device pixels. What the rasteriser produced for one page, never the pixels themselves. */
export interface RasterPage {
  width: number;
  height: number;
}

export interface RasterDiff {
  pagesA: number;
  pagesB: number;
  /**
   * Differing pixels over RGB, or -1 when the two rasterisations are not comparable at all
   * (different page count, different dimensions). -1 is deliberately not folded into 0: a shape
   * mismatch is itself a difference, and a caller that tests `=== 0` must not read it as "same".
   * A caller testing `!== 0` must not read it as a counted difference either — that mistake was
   * in the first version of this project's own tests.
   */
  pixels: number;
}

/** One text item as the extractor found it, in PDF points, origin bottom-left. */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}

export interface PdfTextPage {
  heightPt: number;
  items: PdfTextItem[];
}

export interface Rasterizer {
  readonly name: RasterizerName;
  /** Read from the loaded library, never from a manifest. */
  readonly version: string;
  readonly declaredVersion: string | null;
  /** Rasterise and keep the pixels in the page under `key`. Returns dimensions only. */
  rasterise(key: string, pdf: Uint8Array, dpi?: number): Promise<RasterPage[]>;
  /** Compare two rasterisations already held under their keys. */
  diff(keyA: string, keyB: string): Promise<RasterDiff>;
  /** Drop the pixel buffers of a held rasterisation, keeping only what encoding needs. */
  dropPixels(key: string): Promise<void>;
  /** PNG bytes of one page of a held rasterisation. This is what `Evidence.path` points at. */
  encodePng(key: string, pageIndex: number): Promise<Uint8Array>;
  /** Text items with positions, for the mark extraction of §11.4.3. */
  textItems(pdf: Uint8Array): Promise<PdfTextPage[]>;
  /** Errors the rasteriser page reported. Cumulative, and read more than once by design. */
  pageErrors(): readonly string[];
  release(key: string): Promise<void>;
  close(): Promise<void>;
}

export interface RasterizerUnavailable {
  rasterizer: null;
  detail: string;
  fatal?: boolean;
}

export function pdfjsVersionIntegrity(
  declaredVersion: string | null,
  loadedVersion: string | null,
): { ok: boolean; detail: string } {
  const ok = declaredVersion === SUPPORTED_PDFJS_VERSION && loadedVersion === SUPPORTED_PDFJS_VERSION;
  return {
    ok,
    detail:
      `breaklint: pdfjs-dist version integrity failed (declared=${declaredVersion ?? "missing"}, ` +
      `loaded=${loadedVersion ?? "missing"}, supported=${SUPPORTED_PDFJS_VERSION}). ` +
      "Evidence binding is disabled fail-closed.",
  };
}

export type OpenRasterizerResult = { rasterizer: Rasterizer; detail: "" } | RasterizerUnavailable;

/** The page that the rasteriser is. Served over loopback, so ordinary module imports work. */
function loaderHtml(token: string): string {
  return `<!doctype html><meta charset="utf-8"><title>breaklint rasteriser</title><body>
<script type="module">
import * as pdfjs from "/${token}/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/${token}/pdf.worker.mjs";
window.__blVersion = pdfjs.version;
window.__blHeld = new Map();

window.__blRasterise = async (key, bytes, dpi) => {
  // The loading task owns the worker, not the document proxy, and it is destroyed in a finally:
  // a throw halfway through a long document would otherwise leave a worker behind for every
  // document that failed.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const width = Math.round(viewport.width), height = Math.round(viewport.height);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      // A PDF declares no background. Every viewer paints white before the page; so does this,
      // otherwise the untouched area would be transparent black and every comparison would be
      // dominated by it.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({ width, height, canvas, data: ctx.getImageData(0, 0, width, height).data });
    }
    window.__blHeld.set(key, pages);
    return pages.map((p) => ({ width: p.width, height: p.height }));
  } finally {
    await task.destroy();
  }
};

window.__blDiff = (keyA, keyB) => {
  const A = window.__blHeld.get(keyA), B = window.__blHeld.get(keyB);
  if (!A || !B) return { error: "not rasterised: " + (A ? keyB : keyA) };
  const out = { pagesA: A.length, pagesB: B.length, pixels: -1 };
  if (A.length !== B.length) return out;
  let n = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i], y = B[i];
    if (x.width !== y.width || x.height !== y.height) return out;
    if (!x.data || !y.data) return { error: "pixels already dropped for " + (x.data ? keyB : keyA) };
    const dx = x.data, dy = y.data;
    for (let p = 0, end = x.width * x.height * 4; p < end; p += 4) {
      if (dx[p] !== dy[p] || dx[p + 1] !== dy[p + 1] || dx[p + 2] !== dy[p + 2]) n++;
    }
  }
  out.pixels = n;
  return out;
};

window.__blDropPixels = (key) => {
  const held = window.__blHeld.get(key);
  if (!held) return 0;
  for (const page of held) page.data = null;
  return held.length;
};

window.__blPng = async (key, index) => {
  const held = window.__blHeld.get(key);
  if (!held || !held[index]) return { error: "no page " + index + " under " + key };
  const blob = await held[index].canvas.convertToBlob({ type: "image/png" });
  return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), type: blob.type };
};

window.__blText = async (bytes) => {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        heightPt: viewport.height,
        items: content.items.filter((it) => it.str !== undefined)
          .map((it) => ({ text: it.str, x: it.transform[4], y: it.transform[5] })),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
};

window.__blRelease = (key) => window.__blHeld.delete(key);
window.__blReady = true;
</script></body>`;
}

/**
 * A loopback server that serves exactly three things and nothing else.
 *
 * The path carries a random token. A hostile document in the same browser could reach
 * `127.0.0.1`, and while the three files it would find are a public library and a loader, a
 * guessable path is a habit worth not forming.
 */
function serveRasterizer(
  root: string,
  token: string,
): Promise<{ server: Server; origin: string; lifecycle: OwnedServerLifecycle }> {
  const files: Record<string, { type: string; body: () => Buffer }> = {
    [`/${token}/`]: { type: "text/html; charset=utf-8", body: () => Buffer.from(loaderHtml(token), "utf8") },
    [`/${token}/pdf.mjs`]: { type: "text/javascript", body: () => readFileSync(join(root, "build", "pdf.mjs")) },
    [`/${token}/pdf.worker.mjs`]: { type: "text/javascript", body: () => readFileSync(join(root, "build", "pdf.worker.mjs")) },
  };
  const server = createServer((req, res) => {
    const entry = req.url ? files[req.url] : undefined;
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = entry.body();
      res.writeHead(200, { "content-type": entry.type, "content-length": body.length }).end(body);
    } catch {
      res.writeHead(500).end();
    }
  });
  const lifecycle = ownServerLifecycle(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${address.port}`, lifecycle });
    });
  });
}

export interface OpenRasterizerOptions {
  /** Directory whose module resolution finds `pdfjs-dist`. Defaults to the working directory. */
  fromDir?: string;
  /**
   * How many content pages are open right now. REQUIRED, and not for tidiness: with one open,
   * the rasteriser does not answer. A caller that cannot say has to find out before it calls.
   */
  contentPagesOpen: () => number;
}

export async function openRasterizer(
  browser: BrowserLike,
  options: OpenRasterizerOptions,
): Promise<OpenRasterizerResult> {
  const fromDir = options.fromDir ?? process.cwd();
  const root = resolvePackageRoot("pdfjs-dist", fromDir);
  if (root === null) {
    return {
      rasterizer: null,
      detail:
        "breaklint: no rasteriser available, so no evidence image can be produced.\n" +
        "  install: npm i -D pdfjs-dist\n" +
        "  Findings are still reported; they carry no evidence and say so.",
    };
  }

  let declaredVersion: string | null = null;
  try {
    declaredVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    declaredVersion = null;
  }

  const token = randomBytes(9).toString("hex");
  const { origin, lifecycle } = await serveRasterizer(root, token);
  const closeServer = async (): Promise<void> => {
    const error = await lifecycle.close();
    if (error) throw new Error(`rasterizer loopback cleanup failed: ${error}`);
  };

  // From here the server is OWNED by this function until a `Rasterizer` is handed back. Every
  // throw in between has to give it up, or a failed start leaves a listening socket behind and
  // the process never exits. Measured before this guard existed: two failed starts left two
  // listening handles and the process was still alive twelve seconds after the script ended.
  let page: PageLike;
  try {
    page = await browser.newPage();
  } catch (error) {
    await closeServer();
    return { rasterizer: null, detail: `breaklint: could not open a rasteriser page: ${String(error).slice(0, 200)}` };
  }
  const errors: string[] = [];
  // Measured, not assumed: a rasteriser that throws inside the page still returns dimensions
  // for the pages it managed, and the run would look complete. The list is cumulative and is
  // read more than once — a fault during encoding arrives after the comparison has been judged.
  page.on("pageerror", (e: unknown) => errors.push(String(e).slice(0, 300)));

  const shutDown = async (): Promise<void> => {
    const results = await Promise.allSettled([page.close(), closeServer()]);
    const failures = results.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
    if (failures.length > 0) throw new Error(`rasterizer ownership cleanup failed: ${failures.join("; ")}`);
  };

  let version: string;
  try {
    await page.goto(`${origin}/${token}/`, { waitUntil: "load" });
    await page.waitForFunction("window.__blReady===true", { timeout: 30_000 });
    version = await page.evaluate<string>("window.__blVersion");
  } catch (error) {
    await shutDown();
    return {
      rasterizer: null,
      detail:
        `breaklint: pdfjs-dist was found at ${root} but did not load in the browser.\n` +
        `  ${String(error).slice(0, 200)}\n` +
        (errors.length ? `  the page reported: ${errors.join(" | ")}` : "  the page reported nothing."),
    };
  }

  const versionIntegrity = pdfjsVersionIntegrity(declaredVersion, version || null);
  if (!versionIntegrity.ok) {
    await shutDown();
    return {
      rasterizer: null,
      fatal: true,
      detail: versionIntegrity.detail,
    };
  }

  const rasterizer: Rasterizer = {
    name: "pdfjs-dist",
    version,
    declaredVersion,

    async rasterise(key, pdf, dpi = 96) {
      assertContentPagesClosed(options.contentPagesOpen, "rasterise");
      return page.evaluate(
        (k: string, bytes: number[], d: number) =>
          (window as unknown as { __blRasterise(k: string, b: number[], d: number): Promise<RasterPage[]> })
            .__blRasterise(k, bytes, d),
        key,
        Array.from(pdf),
        dpi,
      );
    },

    async diff(keyA, keyB) {
      // `diff` walks every pixel of two documents inside the page. It is the same call class as
      // `rasterise` and needs the same precondition; guarding two of five entry points and
      // calling the rule enforced was an overstatement an audit caught.
      assertContentPagesClosed(options.contentPagesOpen, "diff");
      const result = await page.evaluate(
        (a: string, b: string) =>
          (window as unknown as { __blDiff(a: string, b: string): RasterDiff & { error?: string } }).__blDiff(a, b),
        keyA,
        keyB,
      );
      if (result.error) throw new Error(`rasteriser: ${result.error}`);
      return { pagesA: result.pagesA, pagesB: result.pagesB, pixels: result.pixels };
    },

    async dropPixels(key) {
      assertContentPagesClosed(options.contentPagesOpen, "dropPixels");
      await page.evaluate((k: string) => (window as unknown as { __blDropPixels(k: string): number }).__blDropPixels(k), key);
    },

    async encodePng(key, pageIndex) {
      assertContentPagesClosed(options.contentPagesOpen, "encodePng");
      const result = await page.evaluate(
        (k: string, i: number) =>
          (window as unknown as { __blPng(k: string, i: number): Promise<{ bytes?: number[]; type?: string; error?: string }> })
            .__blPng(k, i),
        key,
        pageIndex,
      );
      if (result.error || !result.bytes) throw new Error(`rasteriser: ${result.error ?? "no bytes"}`);
      return Uint8Array.from(result.bytes);
    },

    async textItems(pdf) {
      assertContentPagesClosed(options.contentPagesOpen, "textItems");
      return page.evaluate(
        (bytes: number[]) =>
          (window as unknown as { __blText(b: number[]): Promise<PdfTextPage[]> }).__blText(bytes),
        Array.from(pdf),
      );
    },

    pageErrors() {
      return errors;
    },

    async release(key) {
      await page.evaluate((k: string) => (window as unknown as { __blRelease(k: string): boolean }).__blRelease(k), key);
    },

    close: shutDown,
  };

  return { rasterizer, detail: "" };
}

/**
 * The ordering rule of §11.4a.2, enforced instead of remembered.
 *
 * A comment saying "close the content page first" is a comment. This throws, because the
 * failure it prevents does not look like a failure: measured at this product, the rasteriser
 * page did not answer at all inside a 15 s window with a content page open, and answered in
 * well under a second without one. The symptom is a timeout that names nothing.
 */
function assertContentPagesClosed(open: () => number, what: string): void {
  const n = open();
  if (n > 0) {
    throw new Error(
      `breaklint: ${what}() was called while ${n} content page(s) are still open. ` +
        "Measured: the rasteriser page stops answering until the paginated page is closed, and the " +
        "symptom is a timeout that names nothing. Close the document page first.",
    );
  }
}

/** The PNG file that `Evidence.path` points at. Written by Node from bytes made in the page. */
export function writeEvidencePng(path: string, bytes: Uint8Array): void {
  writeFileSync(path, bytes, { flag: "wx" });
}

/**
 * Read a PNG header back out of the raw bytes.
 *
 * This exists so the claim "the file is the image the rasteriser measured" can be checked
 * outside the browser that wrote it. Asking the browser whether it wrote a PNG proves nothing.
 */
export function readPngHeader(bytes: Uint8Array): { signature: boolean; ihdr: boolean; width: number; height: number } {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const signature = bytes.length > 33 && SIGNATURE.every((v, i) => bytes[i] === v);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr =
    signature && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  return {
    signature,
    ihdr,
    width: ihdr ? view.getUint32(16) : 0,
    height: ihdr ? view.getUint32(20) : 0,
  };
}

/**
 * The browser seam.
 *
 * Two things are deliberate here. First, the shapes below are structural and local: the driver
 * is an optional peer, and a published `.d.ts` that names it would make an optional dependency
 * mandatory for anyone who merely wants the types. Second, nothing in this file decides
 * anything about a document — it launches, hands out pages, and closes. A file that both
 * manages a process and judges a layout is a file where a process failure can look like a clean
 * document.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Only the members this project actually calls. Anything else is the driver's business. */
export interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  setContent(html: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  evaluate<R>(fn: string): Promise<R>;
  evaluate<A extends readonly unknown[], R>(fn: (...args: A) => R | Promise<R>, ...args: A): Promise<R>;
  waitForFunction(fn: string, options?: { timeout?: number }): Promise<unknown>;
  emulateMediaType(type: string | null): Promise<void>;
  setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  pdf(options: { printBackground?: boolean; preferCSSPageSize?: boolean }): Promise<Uint8Array>;
  on(event: string, handler: (payload: unknown) => void): void;
  close(): Promise<void>;
}

export interface BrowserLike {
  newPage(): Promise<PageLike>;
  version(): Promise<string>;
  close(): Promise<void>;
}

const CHROME_CANDIDATES_BY_PLATFORM: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

/**
 * Where the browser is. The chain is explicit so that a failure can name every place it looked
 * rather than saying "not found" — a reader who sees the list can tell whether their browser is
 * simply somewhere else.
 */
export function resolveBrowser(): { path: string | null; searched: string[] } {
  const searched: string[] = [];
  const fromEnv = process.env.BREAKLINT_CHROME;
  if (fromEnv) {
    searched.push(`$BREAKLINT_CHROME (${fromEnv})`);
    if (existsSync(fromEnv)) return { path: fromEnv, searched };
  }
  for (const candidate of CHROME_CANDIDATES_BY_PLATFORM[process.platform] ?? []) {
    searched.push(candidate);
    if (existsSync(candidate)) return { path: candidate, searched };
  }
  return { path: null, searched };
}

/**
 * Where a package lives, resolved the way the running process would resolve it.
 *
 * `require.resolve(name)` is used rather than `require.resolve(name + "/some/file")` because
 * several of the packages involved declare no subpath exports; only the bare name resolves.
 * The root is then derived from the resolved entry. Reading a file from a directory guessed by
 * string concatenation would be the same class of mistake as reading a version from a
 * `package.json` other than the one that gets loaded.
 */
export function resolvePackageRoot(name: string, fromDir: string): string | null {
  const require = createRequire(join(fromDir, "noop.js"));
  const marker = `${join("node_modules", name)}${process.platform === "win32" ? "\\" : "/"}`;
  try {
    const entry = require.resolve(name);
    const at = entry.lastIndexOf(marker);
    return at === -1 ? null : entry.slice(0, at + marker.length);
  } catch {
    return null;
  }
}

export interface LaunchResult {
  browser: BrowserLike | null;
  /** Populated when `browser` is null. One copyable command, plus every path that was tried. */
  detail: string;
  executablePath: string | null;
}

/**
 * Start a browser, or say precisely why not.
 *
 * The failure path returns rather than throws because the caller turns it into exit 3 with an
 * infrastructure event. A thrown error here would arrive at the top level as a crash, and a
 * crash and a missing renderer are different things for the person reading the output.
 */
export async function launchBrowser(fromDir: string = process.cwd()): Promise<LaunchResult> {
  const found = resolveBrowser();
  if (!found.path) {
    return {
      browser: null,
      executablePath: null,
      detail:
        "breaklint: no renderer available.\n" +
        "  install: npm i -D puppeteer-core\n" +
        "  or point breaklint at a browser: BREAKLINT_CHROME=/path/to/chrome\n" +
        `  looked in: ${found.searched.join(", ") || "no candidates for this platform"}`,
    };
  }

  const driverRoot = resolvePackageRoot("puppeteer-core", fromDir);
  if (driverRoot === null) {
    return {
      browser: null,
      executablePath: found.path,
      detail:
        "breaklint: a browser was found but no driver to speak to it.\n" +
        `  found: ${found.path}\n` +
        "  install: npm i -D puppeteer-core",
    };
  }

  const driver = (await import("puppeteer-core")) as unknown as {
    default?: { launch(o: Record<string, unknown>): Promise<BrowserLike> };
    launch?(o: Record<string, unknown>): Promise<BrowserLike>;
  };
  const launch = driver.launch ?? driver.default?.launch;
  if (typeof launch !== "function") {
    return {
      browser: null,
      executablePath: found.path,
      detail: `breaklint: puppeteer-core resolved at ${driverRoot} but exposes no launch().`,
    };
  }

  const browser = await launch({
    executablePath: found.path,
    headless: true,
    // No `--allow-file-access-from-files`. It was here so the rasteriser page could import its
    // library over a `file://` URL, but the switch is browser-WIDE: it would also let the
    // audited document — untrusted HTML, often loaded from disk — read other local files. The
    // rasteriser is served over a loopback origin instead, which removes the need entirely.
    // Removing the reason for a switch and leaving the switch is not removing the switch; that
    // mistake was made here once and caught by an audit, not by a test.
    args: [],
    // Rasterising a many-page document is one long call over the control bridge. The driver's
    // default cuts it off well before a real book finishes, and the symptom then looks like a
    // renderer fault rather than a timeout.
    protocolTimeout: 300_000,
  });
  return { browser, executablePath: found.path, detail: "" };
}

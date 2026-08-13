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

import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  evaluateOnNewDocument?(source: string): Promise<unknown>;
  setRequestInterception?(enabled: boolean): Promise<void>;
  createCDPSession?(): Promise<CdpSessionLike>;
  close(): Promise<void>;
}

export interface RequestLike {
  url(): string;
  response?(): ResponseLike | null;
  redirectChain?(): RequestLike[];
  failure?(): { errorText?: string } | null;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface ResponseLike {
  url(): string;
  status(): number;
  headers?(): Record<string, string>;
  buffer(): Promise<Buffer>;
  request?(): RequestLike;
}

export interface CdpSessionLike {
  send<R = unknown>(method: string, params?: Record<string, unknown>): Promise<R>;
  detach(): Promise<void>;
}

export interface BrowserLike {
  newPage(): Promise<PageLike>;
  createBrowserContext?(): Promise<BrowserContextLike>;
  version(): Promise<string>;
  process?(): { pid?: number; kill?(signal?: NodeJS.Signals | number): boolean } | null;
  close(): Promise<void>;
}

export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface ResolvedDocumentUri {
  url: URL;
  filePath: string | null;
  insideDistributionRoot: boolean;
}

/** Canonical root-aware URI resolver shared by serving, collision scan and snapshot provenance. */
export function resolveDocumentUri(raw: string, file: string, distributionRoot: string): ResolvedDocumentUri {
  const trimmed = raw.trim();
  let root = resolve(distributionRoot);
  try { root = realpathSync(root); } catch { /* lexical root remains fail-closed for absent fixtures */ }
  const authoredScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed);
  let url: URL;
  if (authoredScheme) {
    url = new URL(trimmed);
  } else {
    const withoutSuffix = trimmed.split(/[?#]/u, 1)[0] ?? "";
    const lexical = withoutSuffix.startsWith("/")
      ? resolve(root, `.${withoutSuffix}`)
      : resolve(dirname(resolve(file)), withoutSuffix);
    url = pathToFileURL(lexical);
  }
  if (url.protocol !== "file:") {
    return { url, filePath: null, insideDistributionRoot: url.protocol === "data:" || url.protocol === "blob:" };
  }
  let candidate = fileURLToPath(url);
  if (existsSync(candidate)) candidate = realpathSync(candidate);
  else candidate = resolve(candidate);
  const rel = relative(root, candidate);
  const inside = rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
  return { url: pathToFileURL(candidate), filePath: candidate, insideDistributionRoot: inside };
}

export interface ProcessTreeTermination {
  rootPid: number;
  pgid: number | null;
  initialPids: number[];
  survivingPids: number[];
  groupSafe: boolean;
  termSent: boolean;
  killSent: boolean;
  verified: boolean;
}

type ProcessRow = { pid: number; ppid: number; pgid: number };
export type ProcessTableReader = () => ProcessRow[];

/** Ownership observed while the browser root still exists, retained across a later CDP close. */
export interface ProcessTreeOwnership {
  pgid: number | null;
  groupSafe: boolean;
  initialPids: number[];
}

function processTable(): ProcessRow[] {
  if (process.platform === "win32") throw new Error("POSIX process table unavailable on Windows");
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid="], { encoding: "utf8" }).trim();
  if (!output) throw new Error("ps returned no process rows");
  return output.split("\n").map((line) => {
    const values = line.trim().split(/\s+/u).map(Number);
    if (values.length !== 3 || values.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error(`unparseable ps row: ${line}`);
    }
    return { pid: values[0]!, ppid: values[1]!, pgid: values[2]! };
  });
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function descendantsOf(table: ProcessRow[], rootPid: number): number[] {
  const descendants = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table) {
      if (descendants.has(entry.ppid) && !descendants.has(entry.pid)) {
        descendants.add(entry.pid);
        changed = true;
      }
    }
  }
  return [...descendants].sort((a, b) => a - b);
}

function groupMembers(table: ProcessRow[], pgid: number | null): number[] {
  return pgid === null ? [] : table.filter((entry) => entry.pgid === pgid).map((entry) => entry.pid).sort((a, b) => a - b);
}

function ownershipFrom(table: ProcessRow[], rootPid: number, isAlive: (pid: number) => boolean = alive): ProcessTreeOwnership | null {
  const root = table.find((entry) => entry.pid === rootPid);
  if (!root) return null;
  const own = table.find((entry) => entry.pid === process.pid);
  const pgid = root.pgid;
  const groupSafe = process.platform !== "win32" && pgid === rootPid && pgid !== own?.pgid;
  // A detached Chrome helper is still owned if it remains a descendant of the root even when it
  // has changed process group.  The isolated group is an efficient signal target, not an identity
  // boundary that may discard an already-observed descendant.
  const observed = groupSafe
    ? [...groupMembers(table, pgid), ...descendantsOf(table, rootPid)]
    : descendantsOf(table, rootPid);
  return {
    pgid,
    groupSafe,
    initialPids: [...new Set(observed)].filter(isAlive),
  };
}

/**
 * Capture process-group ownership before `browser.close()` can reap the root and reparent a child.
 *
 * The later terminator still reads a fresh table to verify absence; this snapshot only preserves
 * the ownership relation that vanishes when the root exits first.
 */
export function captureProcessTreeOwnership(
  rootPid: number,
  readProcessTable: ProcessTableReader = processTable,
  isAlive: (pid: number) => boolean = alive,
): ProcessTreeOwnership | null {
  try {
    const table = readProcessTable();
    return ownershipFrom(table, rootPid, isAlive);
  } catch {
    return null;
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolveWait) => setTimeout(resolveWait, ms));

export interface OwnedServerLifecycle {
  close(timeoutMs?: number): Promise<string | null>;
  openSockets(): number;
}

/** Close one server and only the connections accepted by that server; callback delivery alone is not proof. */
export function ownServerLifecycle(server: Server): OwnedServerLifecycle {
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return {
    openSockets: () => [...sockets].filter((socket) => !socket.destroyed).length,
    async close(timeoutMs = 5_000): Promise<string | null> {
      let callbackReached = false;
      let closeError: Error | null = null;
      const callback = new Promise<void>((resolveClose) => {
        try {
          server.close((error) => {
            callbackReached = true;
            closeError = error ?? null;
            resolveClose();
          });
        } catch (error) {
          closeError = error instanceof Error ? error : new Error(String(error));
          resolveClose();
        }
      });
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      let timer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        callback,
        new Promise<void>((resolveTimeout) => { timer = setTimeout(resolveTimeout, timeoutMs); }),
      ]);
      if (timer) clearTimeout(timer);
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await wait(0);
      const survivors = [...sockets].filter((socket) => !socket.destroyed).length;
      const observedCloseError = closeError as Error | null;
      if (observedCloseError && (observedCloseError as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
        return `server.close failed: ${observedCloseError.message}`;
      }
      if (server.listening || survivors > 0 || !callbackReached) {
        return `loopback server cleanup unverified (listening=${server.listening}, sockets=${survivors}, callback=${callbackReached})`;
      }
      return null;
    },
  };
}

/** POSIX process-group termination with a post-signal existence check; signal delivery alone is not success. */
export async function terminateProcessTree(
  rootPid: number,
  readProcessTable: ProcessTableReader = processTable,
  operations: {
    alive(pid: number): boolean;
    signal(pid: number, signal: NodeJS.Signals): void;
    wait(ms: number): Promise<void>;
  } = { alive, signal: (pid, signal) => process.kill(pid, signal), wait },
  preservedOwnership: ProcessTreeOwnership | null = null,
): Promise<ProcessTreeTermination> {
  let table: ProcessRow[];
  try {
    table = readProcessTable();
  } catch {
    const initialPids = operations.alive(rootPid) ? [rootPid] : [];
    let termSent = false;
    let killSent = false;
    if (initialPids.length > 0) {
      try { operations.signal(rootPid, "SIGTERM"); termSent = true; } catch { /* alive recheck below is authoritative */ }
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline && operations.alive(rootPid)) await operations.wait(50);
      if (operations.alive(rootPid)) {
        try { operations.signal(rootPid, "SIGKILL"); killSent = true; } catch { /* final recheck below */ }
        await operations.wait(100);
      }
    }
    const survivingPids = operations.alive(rootPid) ? [rootPid] : [];
    return {
      rootPid, pgid: null, initialPids, survivingPids,
      groupSafe: false, termSent, killSent, verified: false,
    };
  }
  const ownership = preservedOwnership ?? ownershipFrom(table, rootPid, operations.alive);
  if (!ownership) {
    return {
      rootPid, pgid: null, initialPids: [], survivingPids: [],
      groupSafe: false, termSent: false, killSent: false, verified: false,
    };
  }
  const { pgid, groupSafe } = ownership;
  // A shared process group is never an ownership oracle. Only descendants of the browser root
  // belong to breaklint in that case; signalling every member could include this process, its
  // shell and unrelated CI siblings. Group membership is used only after isolation is proven.
  const owned = (): number[] => groupSafe
    ? [...new Set([...groupMembers(table, pgid), ...descendantsOf(table, rootPid)])]
    : descendantsOf(table, rootPid);
  const initialPids = [...new Set([...ownership.initialPids, ...owned()])].filter(operations.alive);
  let termSent = false;
  let killSent = false;
  try {
    if (groupSafe) {
      operations.signal(-rootPid, "SIGTERM");
      const inGroup = new Set(groupMembers(table, pgid));
      for (const pid of [...initialPids].reverse()) if (!inGroup.has(pid)) operations.signal(pid, "SIGTERM");
    } else for (const pid of [...initialPids].reverse()) operations.signal(pid, "SIGTERM");
    termSent = true;
  } catch { /* the recheck below decides whether this mattered */ }

  let processTableVerified = true;
  const refresh = (): number[] => {
    let current: number[] = [];
    try {
      const fresh = readProcessTable();
      current = (groupSafe
        ? [...new Set([...groupMembers(fresh, pgid), ...descendantsOf(fresh, rootPid)])]
        : descendantsOf(fresh, rootPid)).filter(operations.alive);
    } catch {
      processTableVerified = false;
    }
    return [...new Set([...initialPids.filter(operations.alive), ...current])].sort((a, b) => a - b);
  };
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && refresh().length > 0) await operations.wait(50);
  let survivors = refresh();
  if (survivors.length > 0) {
    try {
      if (groupSafe) operations.signal(-rootPid, "SIGKILL");
      killSent = true;
    } catch { /* individual fallback below */ }
    await operations.wait(100);
    survivors = refresh();
    for (const pid of [...survivors].reverse()) {
      try { operations.signal(pid, "SIGKILL"); killSent = true; } catch { /* final recheck decides */ }
    }
    await operations.wait(100);
  }
  // A new process can be born or reparented after the initial snapshot. Contract success is
  // therefore based on a fresh descendant/process-group table, not signal delivery or old PIDs.
  const survivingPids = refresh();
  return {
    rootPid, pgid, initialPids, survivingPids, groupSafe, termSent, killSent,
    verified: processTableVerified && survivingPids.length === 0,
  };
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
  /** Explicit profile owned by the caller; never Puppeteer's implicit, untracked temp directory. */
  userDataDir?: string | null;
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
      userDataDir: null,
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
      userDataDir: null,
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
      userDataDir: null,
      detail: `breaklint: puppeteer-core resolved at ${driverRoot} but exposes no launch().`,
    };
  }

  const userDataDir = mkdtempSync(join(tmpdir(), "breaklint-chrome-profile-"));
  let browser: BrowserLike;
  try {
    browser = await launch({
      executablePath: found.path,
      headless: true,
      userDataDir,
    // No `--allow-file-access-from-files`. It was here so the rasteriser page could import its
    // library over a `file://` URL, but the switch is browser-WIDE: it would also let the
    // audited document — untrusted HTML, often loaded from disk — read other local files. The
    // rasteriser is served over a loopback origin instead, which removes the need entirely.
    // Removing the reason for a switch and leaving the switch is not removing the switch; that
    // mistake was made here once and caught by an audit, not by a test.
    args: [],
    detached: process.platform !== "win32",
    // Rasterising a many-page document is one long call over the control bridge. The driver's
    // default cuts it off well before a real book finishes, and the symptom then looks like a
    // renderer fault rather than a timeout.
      protocolTimeout: 300_000,
    });
  } catch (error) {
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
  return { browser, executablePath: found.path, userDataDir, detail: "" };
}

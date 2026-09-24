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

import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
  /**
   * Owned pids that had already exited but were not yet collected by their parent when the final
   * table was read (zombies). They cannot run code and hold no descriptor, socket or file, so they
   * are recorded here and not counted as survivors. Only a reader that can prove the state sets
   * this; see `linuxProcessTable`.
   */
  defunctPids: number[];
  groupSafe: boolean;
  termSent: boolean;
  killSent: boolean;
  verified: boolean;
}

/**
 * One row of the POSIX process table. `defunct` is true only when the reader has PROVED that the
 * process has exited and merely awaits collection by its parent; a reader that cannot tell leaves
 * it unset, and the row then counts as alive.
 */
export type ProcessRow = { pid: number; ppid: number; pgid: number; defunct?: boolean };
export type ProcessTableReader = () => ProcessRow[];

/** Ownership observed while the browser root still exists, retained across a later CDP close. */
export interface ProcessTreeOwnership {
  pgid: number | null;
  groupSafe: boolean;
  initialPids: number[];
}

/**
 * Why a zombie is not a survivor, and why the proof is two reads rather than one.
 *
 * A process that has exited stays in the table as a zombie until its parent collects its exit
 * status. When its parent dies first, the orphan is collected by PID 1 or the nearest subreaper.
 * On an ordinary host that takes microseconds. Measured on a Linux VM whose PID 1 is not an init
 * system, an exited orphan stayed a zombie for 1.02–1.96 s (n = 40); under a parent that never
 * collects orphans — Docker without `--init`, a GitHub Actions `container:` job, a Kubernetes pod
 * whose entrypoint is node — it stays until the container ends. `kill(pid, 0)` succeeds on a
 * zombie, and `kill(-pgid, 0)` succeeds on a group whose only members are zombies, so the old
 * liveness check reported every such cleanup as a survivor: fail-closed, but every live run ended
 * exit 3 in those environments although nothing had survived.
 *
 * `Z` alone is not the proof. A thread-group leader that leaves with `pthread_exit()` while
 * another thread keeps running also reads `Z`, and that process still executes code. Measured on
 * Linux 6.18: a true zombie reads `Z` with `Threads: 1`; a leader that left a second thread
 * running reads `Z` with `Threads: 2`, and after SIGKILL `Z` with `Threads: 1`. Only `Z`
 * together with a single remaining thread therefore counts as defunct.
 *
 * Linux only. macOS offers neither file, and whether XNU answers `kill(pid, 0)` on a zombie with
 * success is not measured here; there the table is still read with `ps`, no row is ever marked
 * defunct, and the errno reading in the producer cleanup is unchanged.
 */
const PROC_ROOT = "/proc";

function vanished(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ESRCH";
}

/** A process the reader may not inspect: another user's, or hidden by `hidepid`. `ps` skips it too. */
function invisible(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

/**
 * `null` = unparseable. A process in state `X` ("dead", being released after its parent collected
 * it) is reported as `released`: its ppid and pgid already read 0 and -1, and it is gone. Measured
 * under process churn on Linux 6.18, before this case existed: one full table read in 215 and one
 * in 302 met such a row, and a strict parser turned it into an unreadable table, therefore a
 * cleanup that could not be verified. After it: 0 in 4 026.
 */
function parseLinuxStat(text: string): { state: string; ppid: number; pgid: number } | "released" | null {
  // `comm` is parenthesised and may itself contain spaces and parentheses; the fields that follow
  // start after the LAST closing parenthesis.
  const close = text.lastIndexOf(")");
  if (close === -1) return null;
  const fields = text.slice(close + 1).trim().split(/\s+/u);
  const state = fields[0] ?? "";
  if (state === "X" || state === "x") return "released";
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  if (!/^[A-Za-z]$/u.test(state) || !Number.isInteger(ppid) || ppid < 0 || !Number.isInteger(pgid) || pgid < 0) return null;
  return { state, ppid, pgid };
}

/** `true` = exited and only awaiting collection, or already gone; `false` = may still run code. */
function linuxDefunct(pid: number, state: string, procRoot: string): boolean {
  if (state !== "Z") return false;
  let status: string;
  try {
    status = readFileSync(join(procRoot, String(pid), "status"), "utf8");
  } catch (error) {
    return vanished(error); // collected between the two reads: gone; otherwise unprovable
  }
  return /^Threads:\s*1\s*$/mu.test(status);
}

/** The Linux process table read from `/proc` directly: no `ps` binary is needed, and zombies are proved. */
export function linuxProcessTable(procRoot: string = PROC_ROOT): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const name of readdirSync(procRoot)) {
    if (!/^[1-9][0-9]*$/u.test(name)) continue;
    const pid = Number(name);
    let text: string;
    try {
      text = readFileSync(join(procRoot, name, "stat"), "utf8");
    } catch (error) {
      if (vanished(error) || invisible(error)) continue;
      throw error;
    }
    const stat = parseLinuxStat(text);
    if (stat === "released") continue;
    if (!stat) throw new Error(`unparseable ${join(procRoot, name, "stat")}`);
    const row: ProcessRow = { pid, ppid: stat.ppid, pgid: stat.pgid };
    if (linuxDefunct(pid, stat.state, procRoot)) row.defunct = true;
    rows.push(row);
  }
  if (rows.length === 0) throw new Error(`${procRoot} returned no process rows`);
  return rows;
}

/** Linux only: has `pid` exited so that it can no longer run code? `false` wherever that is not proved. */
export function processIsDefunct(pid: number, platform: NodeJS.Platform = process.platform, procRoot: string = PROC_ROOT): boolean {
  if (platform !== "linux") return false;
  let text: string;
  try {
    text = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
  } catch (error) {
    return vanished(error); // collected after the caller's successful kill(pid, 0): gone
  }
  const stat = parseLinuxStat(text);
  if (stat === "released") return true;
  return stat !== null && linuxDefunct(pid, stat.state, procRoot);
}

function processTable(): ProcessRow[] {
  if (process.platform === "win32") throw new Error("POSIX process table unavailable on Windows");
  if (process.platform === "linux") return linuxProcessTable();
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

/**
 * Members of process group `pgid` with the reader's defunct proof, or `null` when this platform
 * cannot enumerate them with that proof (everything except Linux) or the table is unreadable.
 * `null` never means "empty"; a caller must read it as "present".
 */
export function processGroupMembers(pgid: number, platform: NodeJS.Platform = process.platform): { pid: number; defunct: boolean }[] | null {
  if (platform !== "linux") return null;
  try {
    return linuxProcessTable()
      .filter((row) => row.pgid === pgid)
      .map((row) => ({ pid: row.pid, defunct: row.defunct === true }))
      .sort((a, b) => a.pid - b.pid);
  } catch {
    return null;
  }
}

/** Can `pid` still run code? `EPERM` stays "alive" (another user's process); a proved zombie does not. */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  return !processIsDefunct(pid);
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

function defunctIn(table: ProcessRow[]): Set<number> {
  return new Set(table.filter((entry) => entry.defunct === true).map((entry) => entry.pid));
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
  const defunct = defunctIn(table);
  return {
    pgid,
    groupSafe,
    initialPids: [...new Set(observed)].filter((pid) => !defunct.has(pid) && isAlive(pid)),
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

/** The seam `terminateProcessTree` acts through. Production uses the kernel and the wall clock. */
export interface ProcessTreeOperations {
  alive(pid: number): boolean;
  signal(pid: number, signal: NodeJS.Signals): void;
  wait(ms: number): Promise<void>;
  /** Clock for the deadlines. Optional so that a seam written before it existed keeps working. */
  now?(): number;
}

/** After SIGTERM, how long the tree may take to leave before SIGKILL; then two 100 ms rechecks. */
export const TERMINATION_GRACE_MS = 2_000;

/** POSIX process-group termination with a post-signal existence check; signal delivery alone is not success. */
export async function terminateProcessTree(
  rootPid: number,
  readProcessTable: ProcessTableReader = processTable,
  operations: ProcessTreeOperations = { alive, signal: (pid, signal) => process.kill(pid, signal), wait, now: Date.now },
  preservedOwnership: ProcessTreeOwnership | null = null,
): Promise<ProcessTreeTermination> {
  const now = operations.now ?? Date.now;
  let table: ProcessRow[];
  try {
    table = readProcessTable();
  } catch {
    const initialPids = operations.alive(rootPid) ? [rootPid] : [];
    let termSent = false;
    let killSent = false;
    if (initialPids.length > 0) {
      try { operations.signal(rootPid, "SIGTERM"); termSent = true; } catch { /* alive recheck below is authoritative */ }
      const deadline = now() + TERMINATION_GRACE_MS;
      while (now() < deadline && operations.alive(rootPid)) await operations.wait(50);
      if (operations.alive(rootPid)) {
        try { operations.signal(rootPid, "SIGKILL"); killSent = true; } catch { /* final recheck below */ }
        await operations.wait(100);
      }
    }
    const survivingPids = operations.alive(rootPid) ? [rootPid] : [];
    return {
      rootPid, pgid: null, initialPids, survivingPids, defunctPids: [],
      groupSafe: false, termSent, killSent, verified: false,
    };
  }
  const ownership = preservedOwnership ?? ownershipFrom(table, rootPid, operations.alive);
  if (!ownership) {
    return {
      rootPid, pgid: null, initialPids: [], survivingPids: [], defunctPids: [],
      groupSafe: false, termSent: false, killSent: false, verified: false,
    };
  }
  const { pgid, groupSafe } = ownership;
  // A shared process group is never an ownership oracle. Only descendants of the browser root
  // belong to breaklint in that case; signalling every member could include this process, its
  // shell and unrelated CI siblings. Group membership is used only after isolation is proven.
  const ownedIn = (rows: ProcessRow[]): number[] => groupSafe
    ? [...new Set([...groupMembers(rows, pgid), ...descendantsOf(rows, rootPid)])]
    : descendantsOf(rows, rootPid);
  const initialDefunct = defunctIn(table);
  const initialPids = [...new Set([...ownership.initialPids, ...ownedIn(table)])]
    .filter((pid) => !initialDefunct.has(pid) && operations.alive(pid));
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
  let defunctPids: number[] = [];
  const refresh = (): number[] => {
    let current: number[] = [];
    // A pid proved defunct in THIS table is neither a survivor nor a signal target. A pid the
    // table cannot speak about keeps its old reading: alive until proved otherwise.
    let defunct = new Set<number>();
    try {
      const fresh = readProcessTable();
      defunct = defunctIn(fresh);
      const owned = ownedIn(fresh);
      defunctPids = [...new Set([...initialPids, ...owned])].filter((pid) => defunct.has(pid)).sort((a, b) => a - b);
      current = owned.filter((pid) => !defunct.has(pid) && operations.alive(pid));
    } catch {
      processTableVerified = false;
    }
    return [...new Set([...initialPids.filter((pid) => !defunct.has(pid) && operations.alive(pid)), ...current])].sort((a, b) => a - b);
  };
  const deadline = now() + TERMINATION_GRACE_MS;
  while (now() < deadline && refresh().length > 0) await operations.wait(50);
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
    rootPid, pgid, initialPids, survivingPids, defunctPids, groupSafe, termSent, killSent,
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

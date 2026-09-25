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

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, type ChildProcess } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import type { Socket } from "node:net";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { err } from "../cli/out.ts";

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

/**
 * breaklint's own handling of SIGINT, SIGTERM and SIGHUP while it owns a browser.
 *
 * Why not the driver's. Puppeteer installs handlers for all three by default. Measured on Linux
 * with the CLI signalled while its browser was up: SIGINT killed the browser and exited 130 but
 * left the profile directory behind (3 of 3); SIGTERM and SIGHUP closed the browser underneath the
 * running render, whose own cleanup then could not capture the process tree it had to verify and
 * reported `renderer-not-terminated` (10 of 18 runs); and one of nine SIGHUP runs, at load 19,
 * ended with exit 0 and no output at all — a clean exit for a run that measured nothing.
 *
 * The decision is taken when the signal arrives, not after the cleanup. breaklint's listener is
 * prepended, so it normally runs before any listener of the host process, and it counts those
 * listeners at that moment (a `process.once` listener that ran before it in the same emit counts
 * too: its removal is observed). Then:
 *
 *   - Nobody else listens (the CLI, or a host without a handler): what the signal means is
 *     "terminate". breaklint runs every hold's orderly `cleanup()` (for a render: the bounded,
 *     verified browser close and the profile removal) under INTERRUPT_CLEANUP_BOUND_MS, forcing a
 *     hold still busy at the bound or at a second signal, reports on stderr whatever was not
 *     verified, removes its listeners and raises the signal again — the process ends BY that
 *     signal, as it would have without breaklint (a shell sees 130, 143 or 129).
 *   - The host listens too: the host decides what the signal means. breaklint cleans up at once
 *     and synchronously (`force()`: SIGKILL of the browser's process group, profile removal), so
 *     the cleanup is done even when the host's listener exits the process on the spot, and removes
 *     its own listener for that signal before the host's listeners run, so they see exactly what
 *     they would see without breaklint — a signal-exit style listener that re-raises only when it
 *     is alone does re-raise. The interrupted render then reports exit 3.
 *
 * A delivered signal is never dropped. Node queues a signal for the listener's handle and
 * discards it if the last listener is removed before the queue is read; measured, a signal that
 * arrived during synchronous work was lost when the listener went synchronously (all three event
 * loop phases) and after one `setImmediate` when the removal ran in the I/O phase, and delivered
 * after two in every phase. So listeners outlive the last hold by two `setImmediate` hops, a
 * signal that arrives when no hold is left is raised again at once, a render drains pending
 * signals before it lets its hold go, and the CLI and the library API drain them once more before
 * they exit or return (drainPendingSignals).
 *
 * A process that ends while a hold is live (a host's `process.exit()` in the middle of a run)
 * runs no signal listener; an `exit` listener, installed with the signal listeners, forces every
 * live hold on the way out. Each hold is forced at most once.
 */
export type InterruptSignal = "SIGINT" | "SIGTERM" | "SIGHUP";
export const INTERRUPT_SIGNALS: readonly InterruptSignal[] = ["SIGINT", "SIGTERM", "SIGHUP"];
/** The longest an interrupted process spends on orderly cleanup before it forces it and ends. */
export const INTERRUPT_CLEANUP_BOUND_MS = 10_000;

export interface InterruptCleanup {
  /** Orderly, bounded cleanup; used when breaklint decides what the signal means. */
  cleanup(): Promise<void>;
  /** Synchronous: no protocol, no wait. Used when the host decides, at a second signal, at the bound. */
  force(): void;
  /** After cleanup or force: null when everything was verified, else what was not. */
  outcome?(): string | null;
}

export interface InterruptHold {
  /** The signal that interrupted this hold, or null. */
  interrupted(): InterruptSignal | null;
  /** Resolves once an interrupt's cleanup of this hold has finished (orderly or forced). */
  settled(): Promise<InterruptSignal>;
  release(): void;
}

type SignalListener = (signal: InterruptSignal) => void;
type RemovalListener = (event: string | symbol, listener: unknown) => void;

/** The part of `process` the registry uses; a test passes a fake. */
export interface SignalHost {
  readonly pid: number;
  prependListener(signal: InterruptSignal, listener: SignalListener): unknown;
  off(signal: InterruptSignal, listener: SignalListener): unknown;
  listenerCount(signal: InterruptSignal): number;
  kill(pid: number, signal: InterruptSignal): unknown;
  /** Observe listener removals (`process.on("removeListener")`); returns the unsubscribe. */
  watchRemovals(listener: RemovalListener): () => void;
  /** One line to stderr, flushed as far as the stream allows, before the process ends. */
  report(line: string): Promise<void>;
  /** Run `fn` after pending signal callbacks have been dispatched. */
  drain(fn: () => void): void;
  /** Observe the process's `exit` event (synchronous listeners only); returns the unsubscribe. */
  watchExit?(listener: () => void): () => void;
}

/** Two `setImmediate` hops: at least one complete poll phase, which dispatches queued signals. */
export function afterPendingSignals(fn: () => void): void {
  setImmediate(() => setImmediate(fn));
}

/** Resolve once every signal that was already queued has reached its listeners. */
export function drainPendingSignals(): Promise<void> {
  return new Promise((resolveDrain) => afterPendingSignals(resolveDrain));
}

async function reportToStderr(line: string): Promise<void> {
  err(line);
  // Pipes are asynchronous on macOS; give a queued line a bounded chance to leave.
  if (process.stderr.writableLength === 0) return;
  await new Promise<void>((resolveFlush) => {
    const timer = setTimeout(resolveFlush, 1_000);
    process.stderr.once("drain", () => { clearTimeout(timer); resolveFlush(); });
  });
}

const PROCESS_SIGNAL_HOST: SignalHost = {
  get pid() { return process.pid; },
  prependListener: (signal, listener) => process.prependListener(signal, listener as NodeJS.SignalsListener),
  off: (signal, listener) => process.off(signal, listener as NodeJS.SignalsListener),
  listenerCount: (signal) => process.listenerCount(signal),
  kill: (pid, signal) => process.kill(pid, signal),
  watchRemovals(listener) {
    process.on("removeListener", listener);
    return () => { process.off("removeListener", listener); };
  },
  report: reportToStderr,
  drain: afterPendingSignals,
  watchExit(listener) {
    process.on("exit", listener);
    return () => { process.off("exit", listener); };
  },
};

export function createInterruptRegistry(host: SignalHost = PROCESS_SIGNAL_HOST, boundMs: number = INTERRUPT_CLEANUP_BOUND_MS): {
  hold(cleanup: InterruptCleanup): InterruptHold;
} {
  interface Entry {
    cleanup: InterruptCleanup;
    signal: InterruptSignal | null;
    resolved: boolean;
    resolve(signal: InterruptSignal): void;
    settled: Promise<InterruptSignal>;
  }
  /** An orderly interrupt, from its first signal until it ends the process. */
  interface Episode {
    signal: InterruptSignal;
    entries: Entry[];
    timer: ReturnType<typeof setTimeout> | null;
    ended: boolean;
  }
  const entries = new Set<Entry>();
  const installed = new Set<InterruptSignal>();
  let stopWatching: (() => void) | null = null;
  let stopWatchingExit: (() => void) | null = null;
  /** Entries whose force() has run; forcing twice would only repeat a kill and a removal. */
  const forcedEntries = new WeakSet<Entry>();
  /** Signals for which a foreign listener was removed in the current synchronous turn. */
  const removedThisTurn = new Set<InterruptSignal>();
  let uninstallScheduled = false;
  let current: Episode | null = null;
  const listener: SignalListener = (signal) => { onSignal(signal); };
  const onRemoval: RemovalListener = (event, removed) => {
    if (removed === listener || !INTERRUPT_SIGNALS.includes(event as InterruptSignal)) return;
    // A `once` listener removes itself as it is called; if that happens in the emit that is about
    // to call breaklint, the host had a listener when the signal arrived.
    const signal = event as InterruptSignal;
    if (removedThisTurn.size === 0) queueMicrotask(() => removedThisTurn.clear());
    removedThisTurn.add(signal);
  };
  const install = (): void => {
    uninstallScheduled = false;
    if (!stopWatching) stopWatching = host.watchRemovals(onRemoval);
    if (!stopWatchingExit && host.watchExit) stopWatchingExit = host.watchExit(onExit);
    for (const signal of INTERRUPT_SIGNALS) {
      if (installed.has(signal)) continue;
      host.prependListener(signal, listener);
      installed.add(signal);
    }
  };
  const uninstall = (): void => {
    for (const signal of installed) host.off(signal, listener);
    installed.clear();
    stopWatching?.();
    stopWatching = null;
    stopWatchingExit?.();
    stopWatchingExit = null;
  };
  /** Never synchronously: a signal already queued for this listener would be discarded. */
  const uninstallWhenIdle = (): void => {
    if (uninstallScheduled || entries.size > 0 || current !== null) return;
    uninstallScheduled = true;
    host.drain(() => {
      if (uninstallScheduled && entries.size === 0 && current === null) uninstall();
      uninstallScheduled = false;
    });
  };
  const resolveEntry = (entry: Entry, signal: InterruptSignal): void => {
    if (entry.resolved) return;
    entry.resolved = true;
    entry.resolve(signal);
  };
  const force = (list: readonly Entry[]): void => {
    for (const entry of list) {
      if (forcedEntries.has(entry)) continue;
      forcedEntries.add(entry);
      try { entry.cleanup.force(); } catch { /* best effort; the next run's sweep remains */ }
    }
  };
  /**
   * The process is ending while a hold is live: a host's `process.exit()` in the middle of a run,
   * or any other exit that bypassed the release. Only synchronous work runs in an `exit` listener,
   * so this is force(): SIGKILL of the owned process group and removal of the profile.
   */
  const onExit = (): void => {
    if (entries.size > 0) force([...entries]);
  };
  const outcomes = (list: readonly Entry[]): string[] => list.flatMap((entry) => {
    try { const outcome = entry.cleanup.outcome?.() ?? null; return outcome ? [outcome] : []; } catch { return []; }
  });
  /** The signal is ours to act on: end by it, as the process would without breaklint. */
  const reraise = (signal: InterruptSignal): void => {
    uninstall();
    host.kill(host.pid, signal);
  };
  /**
   * Orderly cleanup under the bound. The bound's timer is deliberately NOT unref'd: a cleanup that
   * waits on something holding no handle would otherwise let the event loop drain, and a drained
   * loop ends the process with exit 0.
   */
  const clean = (episode: Episode): Promise<void> => new Promise<void>((resolveClean) => {
    let done = false;
    const complete = (forced: boolean): void => {
      if (done) return;
      done = true;
      if (forced) force(episode.entries);
      resolveClean();
    };
    episode.timer = setTimeout(() => complete(true), boundMs);
    void Promise.allSettled(episode.entries.map((entry) => Promise.resolve().then(() => entry.cleanup.cleanup())))
      .then(() => complete(false));
  });
  const end = async (episode: Episode): Promise<void> => {
    if (episode.ended) return;
    episode.ended = true;
    if (episode.timer) clearTimeout(episode.timer);
    for (const entry of episode.entries) resolveEntry(entry, episode.signal);
    const unverified = outcomes(episode.entries);
    if (unverified.length > 0) {
      try { await host.report(`breaklint: interrupted by ${episode.signal}; cleanup not verified: ${unverified.join("; ")}\n`); } catch { /* the signal still ends the process */ }
    }
    reraise(episode.signal);
  };
  const onSignal = (signal: InterruptSignal): void => {
    const hostListens = host.listenerCount(signal) - (installed.has(signal) ? 1 : 0) > 0 || removedThisTurn.has(signal);
    if (current !== null) {
      // A second signal while the first is being cleaned up: stop waiting, force, and end.
      const episode = current;
      force(episode.entries);
      void end(episode);
      return;
    }
    const list = [...entries];
    if (hostListens) {
      // The host decides what this signal means. Clean up now, synchronously, then step aside for
      // this signal so the host's own listeners see what they would see without breaklint.
      for (const entry of list) entry.signal = signal;
      force(list);
      host.off(signal, listener);
      installed.delete(signal);
      for (const entry of list) resolveEntry(entry, signal);
      return;
    }
    if (list.length === 0) {
      // No hold left, the deferred removal had not run yet: behave as if nobody had listened.
      reraise(signal);
      return;
    }
    const episode: Episode = { signal, entries: list, timer: null, ended: false };
    current = episode;
    for (const entry of list) entry.signal = signal;
    void clean(episode).then(() => end(episode));
  };
  return {
    hold(cleanup: InterruptCleanup): InterruptHold {
      let resolve!: (signal: InterruptSignal) => void;
      const settled = new Promise<InterruptSignal>((resolveSettled) => { resolve = resolveSettled; });
      const entry: Entry = { cleanup, signal: null, resolved: false, resolve, settled };
      entries.add(entry);
      install();
      if (current !== null) {
        // Registered while an interrupt is being cleaned up: interrupted too, forced at once.
        entry.signal = current.signal;
        current.entries.push(entry);
        force([entry]);
      }
      return {
        interrupted: () => entry.signal,
        settled: () => settled,
        release(): void {
          entries.delete(entry);
          uninstallWhenIdle();
        },
      };
    },
  };
}

const PROCESS_INTERRUPTS = createInterruptRegistry();

/** Register owned state that a SIGINT, SIGTERM or SIGHUP must clean up before the process ends. */
export function holdForInterrupt(cleanup: InterruptCleanup): InterruptHold {
  return PROCESS_INTERRUPTS.hold(cleanup);
}

/**
 * Profiles a killed run left behind, and why a sweep can never take a live run's profile.
 *
 * A process killed with SIGKILL (the OOM killer, a CI job cancelled after its grace period,
 * `docker kill`) runs no cleanup; its `breaklint-chrome-profile-*` directory stays in the
 * temporary directory. The browser itself goes with it, because it speaks to breaklint over a
 * pipe and exits on end-of-file. The next launch therefore sweeps the temporary directory — but it
 * removes a profile only when every one of these holds:
 *
 *   - it is a real directory (not a symlink) owned by this user, directly inside the resolved
 *     temporary directory, named with the breaklint prefix;
 *   - it carries the owner record breaklint writes into every profile it creates, and that record
 *     names this host, this boot and this PID namespace (a pid means nothing anywhere else);
 *   - the breaklint process named in the record is gone (a zombie counts as gone);
 *   - the browser it started is gone: the recorded browser process group has no live member, or,
 *     where no browser pid was recorded, Chrome's own `SingletonLock` names this host and a dead
 *     pid, or, where there is no lock either, the directory has not changed for
 *     STALE_PROFILE_MIN_AGE_MS.
 *
 * A concurrently running breaklint fails the third condition, because its pid is alive; a profile
 * from another container that shares this temporary directory fails the second; a directory that
 * predates the owner record, or whose record is unreadable, is never touched. Pid reuse can only
 * make a dead owner look alive, which keeps a directory; it can never make a live one look dead.
 */
export const PROFILE_PREFIX = "breaklint-chrome-profile-";
export const PROFILE_OWNER_FILE = "breaklint-owner.json";
/**
 * A lockless profile of a dead owner may still be written by a browser orphaned during its own
 * start-up. Such a browser exits on pipe end-of-file (measured: none left 1 s after its parent's
 * SIGKILL, 3 of 3); a minute is far past that and still short enough to clean on the next run.
 */
export const STALE_PROFILE_MIN_AGE_MS = 60_000;

export interface ProfileOwnerRecord {
  tool: "breaklint";
  pid: number;
  hostname: string;
  bootId: string | null;
  pidNamespace: string | null;
  browserPid: number | null;
  /** The browser's own temporary directory when it could not live inside the profile. */
  browserTmpDir?: string | null;
}

export interface ProfileSweepEnvironment {
  tmp: string;
  hostname: string;
  uid: number | null;
  bootId: string | null;
  pidNamespace: string | null;
  alive(pid: number): boolean;
  /** Does process group `pgid` still have a member that can run code? */
  groupAlive(pgid: number): boolean;
  now(): number;
}

export interface ProfileSweepResult {
  removed: string[];
  kept: { path: string; reason: string }[];
}

function readOptional(path: string): string | null {
  try { return readFileSync(path, "utf8").trim(); } catch { return null; }
}

function linkOptional(path: string): string | null {
  try { return readlinkSync(path); } catch { return null; }
}

/** This process's identity as the owner record states it. */
export function profileOwnerIdentity(platform: NodeJS.Platform = process.platform): Omit<ProfileOwnerRecord, "tool" | "pid" | "browserPid"> {
  return {
    hostname: hostname(),
    bootId: platform === "linux" ? readOptional(join(PROC_ROOT, "sys/kernel/random/boot_id")) : null,
    pidNamespace: platform === "linux" ? linkOptional(join(PROC_ROOT, "self/ns/pid")) : null,
  };
}

/** Does process group `pgid` still have a member that can run code? Zombies do not count. */
export function processGroupHasLiveMember(pgid: number): boolean {
  try { process.kill(-pgid, 0); } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
  const members = processGroupMembers(pgid);
  return !(members !== null && members.length > 0 && members.every((member) => member.defunct));
}

/** The environment the start-up sweep compares against; `null` means "sweep nothing". */
export function defaultSweepEnvironment(
  platform: NodeJS.Platform = process.platform,
  identity: ReturnType<typeof profileOwnerIdentity> = profileOwnerIdentity(platform),
): ProfileSweepEnvironment | null {
  if (platform === "win32") return null;
  // On Linux a pid is meaningful only inside its PID namespace and its boot. Without both, no
  // record can be compared, so nothing is swept.
  if (platform === "linux" && (!identity.bootId || !identity.pidNamespace)) return null;
  let tmp: string;
  try { tmp = realpathSync(tmpdir()); } catch { return null; }
  return {
    tmp, ...identity, uid: typeof process.getuid === "function" ? process.getuid() : null,
    alive, groupAlive: processGroupHasLiveMember, now: Date.now,
  };
}

function ownerRecord(text: string | null): ProfileOwnerRecord | null {
  if (text === null) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  const record = value as Partial<ProfileOwnerRecord> | null;
  const pid = (candidate: unknown): candidate is number => Number.isSafeInteger(candidate) && (candidate as number) > 1;
  const nullableString = (candidate: unknown): candidate is string | null => candidate === null || typeof candidate === "string";
  if (!record || record.tool !== "breaklint" || !pid(record.pid) || typeof record.hostname !== "string"
    || !nullableString(record.bootId) || !nullableString(record.pidNamespace)
    || !(record.browserPid === null || pid(record.browserPid))
    || !(record.browserTmpDir === undefined || nullableString(record.browserTmpDir))) return null;
  return record as ProfileOwnerRecord;
}

/** The owner record of a profile directory, or null when it has none or it is unreadable. */
export function readProfileOwner(userDataDir: string): ProfileOwnerRecord | null {
  return ownerRecord(readOptional(join(userDataDir, PROFILE_OWNER_FILE)));
}

export const BROWSER_TMP_PREFIX = "breaklint-chrome-tmp-";

/**
 * Remove a browser temporary directory created outside the profile, with the same guards as the
 * profile's own removal: our prefix, a real directory owned by this user, directly inside the
 * temporary directory or `/tmp`. `null` = removed or absent; otherwise why not.
 */
export function removeBrowserTmpDir(path: string | null | undefined): string | null {
  if (!path) return null;
  let entry: ReturnType<typeof lstatSync>;
  try { entry = lstatSync(path); } catch { return null; }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  let real: string;
  try { real = realpathSync(path); } catch { return null; }
  const bases = new Set<string>();
  for (const base of [tmpdir(), "/tmp"]) { try { bases.add(realpathSync(base)); } catch { /* absent */ } }
  if (!entry.isDirectory() || entry.isSymbolicLink() || (uid !== null && entry.uid !== uid)
    || !basename(real).startsWith(BROWSER_TMP_PREFIX) || !bases.has(dirname(real))) {
    return `refused to remove an unowned browser temporary directory: ${path}`;
  }
  try { rmSync(real, { recursive: true, force: true }); } catch (error) {
    return `browser temporary directory removal threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  return existsSync(real) ? `browser temporary directory still exists after removal: ${real}` : null;
}

function sweepVerdict(path: string, environment: ProfileSweepEnvironment): string | null {
  let entry: ReturnType<typeof lstatSync>;
  try { entry = lstatSync(path); } catch { return "vanished"; }
  if (!entry.isDirectory() || entry.isSymbolicLink()) return "not a real directory";
  if (environment.uid !== null && entry.uid !== environment.uid) return "owned by another user";
  let real: string;
  try { real = realpathSync(path); } catch { return "vanished"; }
  if (dirname(real) !== environment.tmp) return "not directly inside the temporary directory";
  const record = ownerRecord(readOptional(join(real, PROFILE_OWNER_FILE)));
  if (!record) return "no readable breaklint owner record";
  if (record.hostname !== environment.hostname || record.bootId !== environment.bootId || record.pidNamespace !== environment.pidNamespace) {
    return "owner record names another host, boot or pid namespace";
  }
  if (environment.alive(record.pid)) return "its breaklint process is still running";
  if (record.browserPid !== null) {
    return environment.groupAlive(record.browserPid) ? "its browser process group still has a live member" : null;
  }
  const lock = linkOptional(join(real, "SingletonLock"));
  if (lock !== null) {
    const match = /^(.*)-([1-9][0-9]*)$/u.exec(lock);
    if (!match || match[1] !== environment.hostname) return "browser lock names another host";
    return environment.alive(Number(match[2])) ? "its browser is still running" : null;
  }
  return environment.now() - entry.mtimeMs >= STALE_PROFILE_MIN_AGE_MS ? null : "no browser record and changed too recently";
}

/**
 * Remove the profiles of runs that ended without cleaning up (see the conditions above). Best
 * effort by design: it never fails a run, and a directory it cannot prove dead stays.
 */
export function sweepStaleBrowserProfiles(environment: ProfileSweepEnvironment | null = defaultSweepEnvironment()): ProfileSweepResult {
  const result: ProfileSweepResult = { removed: [], kept: [] };
  if (!environment) return result;
  let names: string[];
  try { names = readdirSync(environment.tmp); } catch { return result; }
  for (const name of names.filter((candidate) => candidate.startsWith(PROFILE_PREFIX)).sort()) {
    const path = join(environment.tmp, name);
    const reason = sweepVerdict(path, environment);
    if (reason !== null) {
      result.kept.push({ path, reason });
      continue;
    }
    removeBrowserTmpDir(readProfileOwner(path)?.browserTmpDir);
    try { rmSync(path, { recursive: true, force: true }); } catch { /* checked below */ }
    if (existsSync(path)) result.kept.push({ path, reason: "removal failed" });
    else result.removed.push(path);
  }
  return result;
}

/**
 * The profile's preferences before the browser first reads them.
 *
 * `webrtc.ip_handling_policy: disable_non_proxied_udp`: a document's RTCPeerConnection may use
 * UDP only through a proxy, and TCP only through a proxy. WebRTC is not a request that
 * interception sees, and it needs no host name, so neither the offline policy nor the browser-level
 * resolver lock stops it: measured on Chromium 141, a document's STUN server at an IP literal on a
 * non-loopback interface received 5 UDP packets within 5 s under the default offline launch. With
 * this preference and `--no-proxy-server` (offline mode) there is no proxy, so there is no UDP at
 * all. The switch that used to set this (`--force-webrtc-ip-handling-policy`) is absent from
 * Chromium 141, so the preference is the mechanism.
 */
export const PROFILE_PREFERENCES = { webrtc: { ip_handling_policy: "disable_non_proxied_udp" } } as const;

/**
 * The browser-wide preferences every profile starts with (`<profile>/Local State`): secure DNS
 * off. Secure DNS (DNS-over-HTTPS) sends its queries to a DoH server the browser addresses by IP
 * literal from its own provider table, so the resolver lock in the launch switches, which maps
 * host names, never sees them: on CI's Google Chrome 153 the offline net-log test recorded a
 * connection to [2001:4860:4860::8888]:443 under the lock. Measured on Chromium 141 through this
 * launch path, idle for 8 s: without this preference the net-log holds DOH_URL_REQUEST events (and,
 * without the lock, a connection to 8.8.8.8:443 after resolving dns.google); with it, none. The
 * browser's built-in ("async") DNS client needs no switch of its own: it resolves only names that
 * reach the resolver, and the lock maps those first (no DNS packet in the offline net-log). There
 * is no command-line switch for the secure DNS mode; an administrator's DnsOverHttpsMode policy
 * overrides this preference, and the net-log test is what would show it.
 */
export const PROFILE_LOCAL_STATE = { dns_over_https: { mode: "off" } } as const;

/** A fresh profile directory that carries its owner record before any browser uses it. */
export function createBrowserProfile(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  writeProfileOwner(userDataDir, null);
  writeFileSync(join(userDataDir, "Local State"), JSON.stringify(PROFILE_LOCAL_STATE), { mode: 0o600 });
  mkdirSync(join(userDataDir, "Default"), { mode: 0o700 });
  writeFileSync(join(userDataDir, "Default", "Preferences"), JSON.stringify(PROFILE_PREFERENCES), { mode: 0o600 });
  return userDataDir;
}

function writeProfileOwner(userDataDir: string, browserPid: number | null, browserTmpDir: string | null = readProfileOwner(userDataDir)?.browserTmpDir ?? null): void {
  const record: ProfileOwnerRecord = { tool: "breaklint", pid: process.pid, ...profileOwnerIdentity(), browserPid, ...(browserTmpDir ? { browserTmpDir } : {}) };
  try {
    writeFileSync(join(userDataDir, PROFILE_OWNER_FILE), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch {
    // Without a record the sweep never touches this profile; the run's own cleanup still removes it.
  }
}

/**
 * A live run must prove that its browser's process tree is gone and its profile removed, and that
 * proof rests on POSIX process groups. Windows has none, so a live run there could never pass its
 * own cleanup check. Before this refusal existed, such a run was only refused after a complete
 * render — the process table then failed and the result was `renderer-not-terminated` — and a
 * producer had already been started. Now nothing starts: the caller returns this message with
 * exit 3, an environment that cannot run the check, as for a missing renderer. `--demo` needs no
 * browser and no process group and keeps working there.
 */
export function unsupportedPlatformRefusal(platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return null;
  return (
    "breaklint: live runs are not supported on Windows.\n" +
    "  A run must prove that its browser's processes are gone and its profile removed, and that proof\n" +
    "  rests on POSIX process groups, which Windows does not have. Nothing was started.\n" +
    "  breaklint --demo needs no browser and works here."
  );
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

/**
 * Where the browser keeps its own temporary files: inside the profile, so the profile's removal
 * takes them too. Chrome creates its singleton socket directory there (`.org.chromium.Chromium.*`
 * for Chromium, `com.google.Chrome.*` for Google Chrome) and its component-download directories
 * (`com.google.Chrome.chrome_chrome_url_fetcher_*`), and it does not remove them when it is killed
 * — observed accumulating in a shared temporary directory. A Unix socket path is limited to 108
 * bytes on Linux and 104 on macOS including the terminator, and Chrome appends 46 bytes
 * (`/.org.chromium.Chromium.XXXXXX/SingletonSocket`, measured; Google Chrome's name is shorter);
 * with a 4-byte margin, a directory path longer than the limit less 50 bytes gets a short dedicated
 * directory instead, recorded in the profile's owner record and removed with the profile. The
 * margin is small on purpose: under `npm test`'s private temporary directory
 * (`/tmp/breaklint-suite-XXXXXX`, 27 bytes) the profile's `tmp` is 63 bytes and does not fit, and
 * the fallback (55 bytes) must still fit there rather than in `/tmp`, so that the suite's own
 * leftover check sees the browser's files.
 */
const CHROME_SOCKET_SUFFIX_BYTES = 50;
function socketPathLimit(platform: NodeJS.Platform = process.platform): number {
  return (platform === "darwin" ? 104 : 108) - 1;
}

export function browserTmpDirFor(userDataDir: string, platform: NodeJS.Platform = process.platform): { path: string; separate: boolean } {
  const inside = join(userDataDir, "tmp");
  if (Buffer.byteLength(inside) + CHROME_SOCKET_SUFFIX_BYTES <= socketPathLimit(platform)) {
    mkdirSync(inside, { mode: 0o700 });
    return { path: inside, separate: false };
  }
  let base = "/tmp";
  try {
    const temp = realpathSync(tmpdir());
    if (Buffer.byteLength(join(temp, `${BROWSER_TMP_PREFIX}XXXXXX`)) + CHROME_SOCKET_SUFFIX_BYTES <= socketPathLimit(platform)) base = temp;
  } catch { /* /tmp */ }
  return { path: mkdtempSync(join(base, BROWSER_TMP_PREFIX)), separate: true };
}

/**
 * Browser-level network switches. None of them touches the sandbox.
 *
 * In every mode: `--disable-component-update` (Chrome's component updater downloads at browser
 * level; puppeteer-core 25.8 no longer passes this switch, and the downloads left directories in
 * CI's temporary directory) and `--disable-background-networking` (the driver passes it today;
 * breaklint's network posture should not depend on a default list that has just changed).
 *
 * In every mode, too, a lock that holds whatever the browser or the document does outside request
 * interception: `--host-resolver-rules` (see `hostResolverRules`) maps every host, name or IP
 * literal, to "not found" before any DNS query, except the loopback address the document is served
 * from and, with `--allow-network`, the allowed origins' hosts; `--no-proxy-server` stops a
 * configured proxy from resolving and forwarding on the browser's behalf, which would bypass the
 * map. Measured on Chromium 141 through this launch path, idle for 8 s: without the lock, DNS to
 * the system resolver and connections to Google hosts for network time, the account list, AI-mode
 * eligibility, GCM check-in, DNS-over-HTTPS and a search preconnect, with both disable switches
 * present; with the lock, the only connection was to the loopback page. With `--allow-network`
 * the map used to be off, and a document's WebSocket, WebTransport and cross-site iframe reached
 * a host that was not allowed (measured: all three, to an IP literal on this machine's
 * non-loopback interface); interception never sees them. Now they fail to resolve unless the host
 * is an allowed one. What the map cannot see: the port and the scheme. A channel interception does
 * not see may reach any port of an allowed host. Secure DNS is off through the profile
 * (PROFILE_LOCAL_STATE), because its server is addressed by IP literal from the browser's own
 * table and never reaches the map.
 */
export const BROWSER_NETWORK_ARGS: readonly string[] = ["--disable-component-update", "--disable-background-networking"];

/** A host the rules may name: a DNS name as `URL` normalises it (IDN already in punycode) or an IPv4 literal. */
const RULE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
const RULE_IPV6 = /^\[[0-9a-f:.]+\]$/u;

/**
 * The value of `--host-resolver-rules`: every host maps to "not found", except 127.0.0.1 and the
 * hosts of the allowed origins. An origin whose host is neither a plain DNS name nor an IP literal
 * (a WHATWG URL admits, for instance, a comma, which separates rules) is left out: the browser then
 * cannot reach it, and a document that needs it fails as it would under a closed network, rather
 * than the value gaining a rule nobody wrote. An IPv6 literal is named in both of the forms the
 * browser compares against (with and without brackets); it is not measured here, because this
 * machine has no IPv6.
 */
export function hostResolverRules(allowedOrigins: readonly string[] = []): string {
  const hosts = new Set<string>();
  for (const origin of allowedOrigins) {
    let host: string;
    try { host = new URL(origin).hostname; } catch { continue; }
    if (host === "127.0.0.1") continue;
    if (RULE_HOST.test(host)) hosts.add(host);
    else if (RULE_IPV6.test(host)) { hosts.add(host); hosts.add(host.slice(1, -1)); }
  }
  return ["MAP * ~NOTFOUND", "EXCLUDE 127.0.0.1", ...[...hosts].sort().map((host) => `EXCLUDE ${host}`)].join(" , ");
}

/**
 * The whole start of the browser, from spawn to its first page target.
 *
 * It is a hang guard with a diagnosable message, not a start-up budget: the value is the driver's
 * previous implicit default, kept rather than tightened, and it is an order of magnitude above a
 * measured start (0.30–0.76 s alone; at most 2.4 s with twelve concurrent starts at load 20 on
 * four cores). It now bounds everything, because over a pipe the driver's own `timeout` covers
 * only the wait for the first page: with a 5 s `timeout`, a fake browser that never answered was
 * still being waited for when the probe gave up at 40 s; only the 300 s protocol timeout was
 * left to end it.
 */
export const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;
const STDERR_TAIL_LINES = 20;
const STDERR_TAIL_BYTES = 4_096;

interface SpawnWatch {
  pid(): number | null;
  tail(): string;
  stop(): void;
}

/**
 * Observe the browser process the driver spawns, for its pid and the tail of its stderr.
 *
 * Over a pipe, a browser that dies at start is reported by the driver as "Target closed" with
 * nothing of what the browser said (measured: a binary that cannot load a shared library). The
 * driver keeps its child to itself until the launch resolves, so the child is picked up from
 * Node's `child_process` diagnostics channel, matched by executable and by this run's own
 * `--user-data-dir`. Diagnostics only: if the channel is unavailable the message says so, and
 * nothing that decides a result depends on it.
 */
function watchBrowserSpawn(executablePath: string, userDataDir: string, onPid: (pid: number) => void): SpawnWatch {
  let child: ChildProcess | null = null;
  const lines: string[] = [];
  let partial = "";
  let bytes = 0;
  const onData = (chunk: Buffer | string): void => {
    const text = partial + String(chunk);
    const parts = text.split(/\r?\n/u);
    partial = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      lines.push(line);
      bytes += line.length;
      while (lines.length > STDERR_TAIL_LINES || bytes > STDERR_TAIL_BYTES) bytes -= lines.shift()!.length;
    }
  };
  const listener = (message: unknown): void => {
    const candidate = (message as { process?: ChildProcess } | null)?.process;
    if (!candidate || child) return;
    // The channel publishes from the ChildProcess constructor, before spawn() has filled in the
    // file, the arguments, the pid and the pipes; they are all set once the current call returns,
    // and no stderr byte can be read before then.
    queueMicrotask(() => {
      if (child || candidate.spawnfile !== executablePath) return;
      if (!candidate.spawnargs.includes(`--user-data-dir=${userDataDir}`)) return;
      child = candidate;
      candidate.stderr?.on("data", onData);
      if (candidate.pid) onPid(candidate.pid);
    });
  };
  let subscribed = false;
  try { subscribe("child_process", listener); subscribed = true; } catch { /* no channel: no tail */ }
  return {
    pid: () => child?.pid ?? null,
    tail(): string {
      if (!subscribed) return "browser stderr: not observable in this Node version";
      const all = [...lines, ...(partial.trim() ? [partial] : [])].map((line) =>
        line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, "?").slice(0, 300));
      if (!child) return "browser stderr: the browser process was not observed";
      return all.length === 0 ? "browser stderr: (empty)" : `browser stderr, last ${all.length} line(s):\n    ${all.join("\n    ")}`;
    },
    stop(): void {
      if (subscribed) unsubscribe("child_process", listener);
      child?.stderr?.off("data", onData);
    },
  };
}

export interface LaunchResult {
  browser: BrowserLike | null;
  /** Populated when `browser` is null. One copyable command, plus every path that was tried. */
  detail: string;
  executablePath: string | null;
  /** Explicit profile owned by the caller; never Puppeteer's implicit, untracked temp directory. */
  userDataDir?: string | null;
  /**
   * Set only when the launch was refused for the driver's environment: the refusal on one line.
   * It names variables and nothing of the host, so an API may pass it on where it withholds
   * other launch failures.
   */
  refusal?: string;
}

/**
 * Environment switches the driver reads at launch, from puppeteer-core 25.8's own source, and
 * breaklint's decision for each. The driver reads them from `process.env`, not from the `env`
 * launch option, so breaklint cannot neutralise them for the browser, and it does not edit a
 * library host's environment either. A launch with one of the REFUSED ones set does not start.
 *
 * Refused (they change the browser's switches):
 *   PUPPETEER_DANGEROUS_NO_SANDBOX  — the driver then adds the switch that turns the browser's
 *     sandbox off (ChromeLauncher.defaultArgs), which SECURITY.md says nothing can do.
 *   PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES — changes the `--disable-features` list the
 *     driver passes (site-isolation related features); an unmeasured browser configuration.
 * Harmless here, and why:
 *   PUPPETEER_WEBDRIVER_BIDI_ONLY   — read only on the WebDriver BiDi path; breaklint speaks CDP.
 *   PUPPETEER_EXECUTABLE_PATH       — not read by puppeteer-core 25.8 at all (only the full
 *     `puppeteer` package's configuration and @puppeteer/browsers' CLI text name it); breaklint
 *     always passes `executablePath` itself, from BREAKLINT_CHROME or its candidate list.
 *   NODE_DEBUG / DEBUG              — driver logging only.
 * Refused when present with any value: "set" is what a reader of the environment sees.
 */
export const REFUSED_DRIVER_ENVIRONMENT: Readonly<Record<string, string>> = {
  PUPPETEER_DANGEROUS_NO_SANDBOX: "it makes puppeteer-core start the browser with its sandbox off",
  PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES: "it makes puppeteer-core change the browser's feature switches",
};

/** `null`, or the exit-3 message naming every refused variable that is set. */
export function driverEnvironmentRefusal(environment: NodeJS.ProcessEnv = process.env): string | null {
  const set = Object.keys(REFUSED_DRIVER_ENVIRONMENT).filter((name) => environment[name] !== undefined);
  if (set.length === 0) return null;
  return (
    "breaklint: refusing to start the browser.\n" +
    set.map((name) => `  ${name} is set: ${REFUSED_DRIVER_ENVIRONMENT[name]}.\n`).join("") +
    "  Unset it for this run; breaklint keeps the browser sandbox on and has no way to turn it off."
  );
}

/**
 * The environment the browser is started with: the host's values of these names only, and
 * `TMPDIR` pointing into the profile. Everything else is left out, because the browser reads its
 * own switches and state from the environment: measured on Chromium 141, an inherited
 * `CHROME_EXTRA_FLAGS=--remote-debugging-port=9333` opened an unauthenticated DevTools port on a
 * launch that passed `{ ...process.env }`, and the same variable carries the sandbox-disabling switch
 * as easily.
 * Chromium 141's binary also names `CHROME_DEVEL_SANDBOX`, `CHROME_USER_DATA_DIR`,
 * `CHROME_CONFIG_HOME`, `CHROME_LOG_FILE`, `GOOGLE_API_KEY` and `SSLKEYLOGFILE` among the variables
 * it can read, and the dynamic loader reads `LD_*`; a run needs none of them. Proxy variables are not passed either: the launch always carries
 * `--no-proxy-server`. Nothing here edits the host's own environment.
 *
 * Kept, and why: `HOME`, `USER`, `LOGNAME` (the browser's per-user state and certificate store
 * live under the home directory); `PATH` (a wrapper script such as `google-chrome` runs
 * `readlink` and `dirname`); `LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TZDIR` (locale and time zone, which
 * a document's text and dates can depend on); the XDG base directories (where the browser keeps
 * per-user configuration and caches); `FONTCONFIG_FILE`, `FONTCONFIG_PATH`, `FONTCONFIG_SYSROOT`
 * (which fonts exist, which layout depends on). No display variable: the browser is headless.
 * A browser that needs anything else to start (a custom build that needs `LD_LIBRARY_PATH`) must
 * be started through its own wrapper script named by BREAKLINT_CHROME.
 */
export const BROWSER_ENVIRONMENT_NAMES: readonly string[] = [
  "HOME", "USER", "LOGNAME", "PATH", "LANG", "LANGUAGE", "TZ", "TZDIR",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_DIRS", "XDG_DATA_DIRS",
  "FONTCONFIG_FILE", "FONTCONFIG_PATH", "FONTCONFIG_SYSROOT",
];
/** Name prefixes kept as a family: the locale categories. */
export const BROWSER_ENVIRONMENT_PREFIXES: readonly string[] = ["LC_"];

export function browserEnvironment(host: NodeJS.ProcessEnv, browserTmpDir: string): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(host)) {
    if (value === undefined) continue;
    if (BROWSER_ENVIRONMENT_NAMES.includes(name) || BROWSER_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix) && /^[A-Z_]+$/u.test(name))) kept[name] = value;
  }
  kept.TMPDIR = browserTmpDir;
  return kept;
}

/** The refusal message on one line, for an API that reports a single-line reason. */
export function oneLineRefusal(message: string): string {
  return message.replace(/^breaklint: /u, "").replace(/\s*\n\s*/gu, " ").trim();
}

/** Launch options. `network` and `allowedOrigins` follow the run's network policy; the rest are unit-only seams. */
export interface LaunchSeams {
  /** The run's network mode. The browser-level lock is on in both; only its exceptions differ. */
  network?: "offline" | "allowlist";
  /** With "allowlist": the allowed origins, whose hosts the lock lets resolve. Ignored offline. */
  allowedOrigins?: readonly string[];
  /** Unit-only: write the browser's net-log to `<profile>/net-log.json`. */
  netLog?: boolean;
  launchTimeoutMs?: number;
}

/**
 * Start a browser, or say precisely why not.
 *
 * The failure path returns rather than throws because the caller turns it into exit 3 with an
 * infrastructure event. A thrown error here would arrive at the top level as a crash, and a
 * crash and a missing renderer are different things for the person reading the output.
 */
export async function launchBrowser(fromDir: string = process.cwd(), seams: LaunchSeams = {}): Promise<LaunchResult> {
  // Before anything is resolved or created: the driver would read these at launch.
  const refused = driverEnvironmentRefusal();
  if (refused) return { browser: null, executablePath: null, userDataDir: null, detail: refused, refusal: oneLineRefusal(refused) };
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

  // Profiles of earlier runs that were killed before they could clean up; see the sweep's rules.
  sweepStaleBrowserProfiles();
  const userDataDir = createBrowserProfile();
  const browserTmp = browserTmpDirFor(userDataDir);
  if (browserTmp.separate) writeProfileOwner(userDataDir, null, browserTmp.path);
  const removeProfile = (): void => {
    removeBrowserTmpDir(browserTmp.separate ? browserTmp.path : null);
    rmSync(userDataDir, { recursive: true, force: true });
  };
  const executablePath = found.path;
  const boundMs = seams.launchTimeoutMs ?? BROWSER_LAUNCH_TIMEOUT_MS;
  const abort = new AbortController();
  let timedOut = false;
  let launchSettled!: () => void;
  const settled = new Promise<void>((resolveSettled) => { launchSettled = resolveSettled; });
  const watch = watchBrowserSpawn(executablePath, userDataDir, (pid) => writeProfileOwner(userDataDir, pid));
  // An interrupt during start-up: stop the launch (the driver then kills the browser group), and
  // let the failure path below verify the group and remove the profile.
  let launchUnverified: string | null = null;
  const interrupt = holdForInterrupt({
    async cleanup() { abort.abort(); await settled; },
    force() {
      abort.abort();
      const pid = watch.pid();
      if (pid !== null) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
      removeProfile();
      launchUnverified ??= "browser start-up forced: SIGKILL of the starting browser's group; termination not verified";
    },
    outcome: () => launchUnverified,
  });
  const started = Date.now();
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, boundMs);
  let browser: BrowserLike;
  try {
    browser = await launch({
      executablePath,
      headless: true,
      userDataDir,
    // No `--allow-file-access-from-files`. It was here so the rasteriser page could import its
    // library over a `file://` URL, but the switch is browser-WIDE: it would also let the
    // audited document — untrusted HTML, often loaded from disk — read other local files. The
    // rasteriser is served over a loopback origin instead, which removes the need entirely.
    // Removing the reason for a switch and leaving the switch is not removing the switch; that
    // mistake was made here once and caught by an audit, not by a test.
    // Only network switches, and never one that touches the sandbox; see BROWSER_NETWORK_ARGS.
    args: [
      ...BROWSER_NETWORK_ARGS,
      `--host-resolver-rules=${hostResolverRules(seams.network === "allowlist" ? seams.allowedOrigins ?? [] : [])}`,
      "--no-proxy-server",
      ...(seams.netLog ? [`--log-net-log=${join(userDataDir, "net-log.json")}`] : []),
    ],
    // Only the allow-listed variables of the host's environment; see browserEnvironment.
    env: browserEnvironment(process.env, browserTmp.path),
    detached: process.platform !== "win32",
    // The control connection is a pair of pipes, not a DevTools port on loopback. A browser on
    // the websocket transport kept running when breaklint was killed (12–13 processes alive 30 s
    // after SIGKILL, 3 of 3); over a pipe it sees end-of-file and exits (none left after 1 s,
    // 3 of 3). It also leaves no unauthenticated debugging port for other local processes.
    pipe: true,
    // breaklint handles these signals itself (see holdForInterrupt); the driver's handlers
    // closed the browser underneath a running render and left the profile behind.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    timeout: boundMs,
    signal: abort.signal,
    // Rasterising a many-page document is one long call over the control bridge. The driver's
    // default cuts it off well before a real book finishes, and the symptom then looks like a
    // renderer fault rather than a timeout.
      protocolTimeout: 300_000,
    });
    // Aborted while the launch was resolving: the driver has already killed this browser.
    if (abort.signal.aborted) throw new Error("the launch was stopped");
  } catch (error) {
    clearTimeout(timer);
    const elapsed = Date.now() - started;
    const signal = interrupt.interrupted();
    const reason = timedOut
      ? `the browser did not finish starting within ${boundMs} ms`
      : signal
        ? `browser start-up interrupted by ${signal}`
        : `the browser failed to start: ${error instanceof Error ? error.message : String(error)}`;
    let tree = "";
    const pid = watch.pid();
    if (pid !== null && process.platform !== "win32") {
      // The browser leads its own group; verify that group gone before its profile is removed.
      const termination = await terminateProcessTree(pid, undefined, undefined, { pgid: pid, groupSafe: true, initialPids: [pid] });
      if (!termination.verified) {
        tree = `; its process group could not be verified terminated (survivors=${termination.survivingPids.join(",") || "none"})`;
        launchUnverified = `browser start-up: ${tree.slice(2)}`;
      } else launchUnverified = null;
    }
    removeProfile();
    const tail = watch.tail();
    watch.stop();
    launchSettled();
    // Interrupted: let the handler decide first. It ends the process by the signal as soon as this
    // cleanup has settled, and only a host that handles the signal itself gets the error below.
    // Without this wait the rejection could reach the CLI's exit(3) before the handler re-raised:
    // measured 1 of 3 SIGINT runs at load 10 ending with exit 3 instead of by the signal.
    if (interrupt.interrupted()) await interrupt.settled();
    interrupt.release();
    throw new Error(`${reason} (after ${elapsed} ms; launch bound ${boundMs} ms)${tree}\n  ${tail}`);
  }
  clearTimeout(timer);
  if (watch.pid() === null) writeProfileOwner(userDataDir, browser.process?.()?.pid ?? null);
  watch.stop();
  launchSettled();
  interrupt.release();
  return { browser, executablePath, userDataDir, detail: "" };
}

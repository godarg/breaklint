/** Host-owned read-only Git adapter. No command, executable or argv comes from a manifest. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { captureBoundedSourceFile } from "./bytes.ts";
import type { DocumentRevision } from "../core/types.ts";

const execute = promisify(execFile);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export interface HostGitRevisionOptions { repositoryRoot: string; sourcePrefix?: string; }
export interface GitCapture {
  root: string; prefix: string; repositoryId: string; projectId: string;
  head: string; tree: string; stateSha256: string;
  files: ReadonlyMap<string, { sha256: string; byteLength: number }>;
}
async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execute("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, windowsHide: true,
  });
  return result.stdout;
}
function validPrefix(prefix: string): boolean {
  return prefix === "" || (!isAbsolute(prefix) && !prefix.includes("\\") && !prefix.includes("\0") && prefix.split("/").every(p => p !== "" && p !== "." && p !== ".."));
}
export async function captureHostGit(options: HostGitRevisionOptions): Promise<GitCapture> {
  if (!options || Object.keys(options).some(k => k !== "repositoryRoot" && k !== "sourcePrefix") || typeof options.repositoryRoot !== "string" || (options.sourcePrefix !== undefined && typeof options.sourcePrefix !== "string")) throw new Error("invalid host revision options");
  const root = realpathSync(options.repositoryRoot); const prefix = options.sourcePrefix ?? "";
  if (!validPrefix(prefix)) throw new Error("invalid host source prefix");
  const top = realpathSync((await git(root, ["rev-parse", "--show-toplevel"])).trim());
  if (root !== top) throw new Error("host root must be a repository root");
  const common = realpathSync(resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim()));
  const head = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
  const tree = (await git(root, ["rev-parse", "--verify", "HEAD^{tree}"])).trim();
  if (!/^[a-f0-9]{40,64}$/u.test(head) || !/^[a-f0-9]{40,64}$/u.test(tree)) throw new Error("Git identity unavailable");
  const paths = [...new Set((await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", prefix || "."])).split("\0").filter(Boolean))].sort();
  if (paths.length > 2_000) throw new Error("host source inventory exceeds bound; select sourcePrefix");
  const files = new Map<string, { sha256: string; byteLength: number }>(); let total = 0;
  for (const path of paths) {
    const local = prefix ? relative(resolve(root, prefix), resolve(root, path)) : path;
    if (!validPrefix(local) || local === "") throw new Error("host source path escaped prefix");
    const bytes = captureBoundedSourceFile(root, path, 10 * 1024 * 1024, "host revision source");
    total += bytes.length; if (total > 256 * 1024 * 1024) throw new Error("host source bytes exceed bound");
    files.set(local, { sha256: sha(bytes), byteLength: bytes.length });
  }
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", prefix || "."]);
  const repositoryId = sha(common);
  return { root, prefix, repositoryId, projectId: sha(JSON.stringify([repositoryId, prefix])), head, tree,
    stateSha256: sha(JSON.stringify([head, tree, status, [...files]])), files };
}
export function bindCapturedRevision(before: GitCapture, after: GitCapture, inputs: readonly { file: string; sha256: string; byteLength: number; role: string }[], codeSha256: string, optionsSha256: string): DocumentRevision {
  if (before.projectId !== after.projectId || before.stateSha256 !== after.stateSha256) throw new Error("host repository changed during producer execution");
  for (const file of inputs) {
    const actual = before.files.get(file.file); const current = after.files.get(file.file);
    if (!actual || !current || actual.sha256 !== file.sha256 || actual.byteLength !== file.byteLength || current.sha256 !== file.sha256) throw new Error("captured source does not match host repository");
  }
  return { status: "verified", adapter: "host-local-git-v1", repositoryId: before.repositoryId, projectId: before.projectId,
    head: before.head, tree: before.tree, workingTreeSha256: before.stateSha256,
    capturedSourcesSha256: sha(JSON.stringify([...inputs].sort((a, b) => a.file.localeCompare(b.file, "en")))), codeSha256, optionsSha256, observedAt: new Date().toISOString() };
}
export async function verifyGitAncestry(repositoryRoot: string, before: DocumentRevision, after: DocumentRevision): Promise<boolean> {
  try {
    const root = realpathSync(repositoryRoot);
    const common = realpathSync(resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim()));
    if (sha(common) !== before.repositoryId || before.repositoryId !== after.repositoryId) return false;
    for (const revision of [before, after]) {
      if (!/^[a-f0-9]{40,64}$/u.test(revision.head) || !/^[a-f0-9]{40,64}$/u.test(revision.tree)) return false;
      if ((await git(root, ["rev-parse", "--verify", `${revision.head}^{tree}`])).trim() !== revision.tree) return false;
    }
    await git(root, ["merge-base", "--is-ancestor", before.head, after.head]); return true;
  } catch { return false; }
}

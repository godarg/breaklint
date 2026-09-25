/** Types for `action/run.mjs`, for the TypeScript tests that import it. */
export const PEERS: readonly (readonly [name: string, version: string])[];
export const INPUT_DEFAULTS: Readonly<Record<string, string>>;
export const ALWAYS_FAILING_EXITS: readonly number[];
export const EXIT_MEANING: Readonly<Record<number, string>>;
export const REPORT_FILES: Readonly<{ json: string; sarif: string; junit: string; markdown: string }>;
export const EVIDENCE_DIR: string;
export const SUMMARY_LIMIT_BYTES: number;

export class ActionFailure extends Error {
  constructor(exitCode: number, message: string);
  exitCode: number;
}

export interface ActionInputs {
  paths: string[];
  failOnExit: Set<number>;
  failOn: string;
  profile: string;
  config: string;
  allowNetwork: string[];
  outputDir: string;
  chromePath: string;
  useProjectInstall: boolean;
  tarball: string;
}

export function parseActionInputs(raw: string | undefined): ActionInputs;
export function splitLines(text: string): string[];
export function parseFailOnExit(text: string): Set<number>;
export function nodeSatisfies(version: string, range: string): boolean;
export function platformRefusal(platform: string): string | null;
export function expandPatterns(patterns: readonly string[], cwd: string): string[];
export function guardPath(path: string): string;
export function breaklintArguments(options: {
  cli: string;
  jsonPath: string;
  evidenceDir: string;
  inputs: ActionInputs;
  paths: readonly string[];
}): string[];
export function escapeData(text: string): string;
export function printUntrusted(text: string): void;
export function gateSentence(exitCode: number, failOnExit: ReadonlySet<number>): string;
export function summaryText(markdown: string, trailer: string, limit?: number): string;
export function shadowingPeers(cwd: string): { name: string; dir: string; version: string | null }[];
export function main(): Promise<void>;

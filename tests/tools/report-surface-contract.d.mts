export const REVIEW_INPUT_CONTRACT_VERSION: number;
export const REVIEW_INPUT_DOMAIN: string;
export const REVIEW_INPUT_ROOTS: readonly string[];
export const DEFAULT_REVIEW_INPUT_ROOT: string;
export const BROWSER_VERSION_PATTERN: RegExp;
export const REVIEW_ARTIFACT_CONTRACT_VERSION: number;
export const SCREEN_PIXEL_CONTRACT_VERSION: number;
export const REVIEW_LEDGER_SCHEMA_VERSION: number;
export const REQUIRED_BROWSER_RENDER_ARGS: readonly string[];
export const DECLARED_ENVIRONMENT_FIELDS: readonly string[];
export const OBSERVED_ENVIRONMENT_FIELDS: readonly string[];
export const HUMAN_REVIEW_ROLES: readonly string[];
export const REVIEWER_AUTHENTICATION_NOTE: string;

export interface ReviewInput {
  fingerprint: string;
  files: { path: string; bytes: number; sha256: string }[];
}

export function reviewInputFiles(root?: string): { path: string; relativePath: string }[];
export function computeReviewInput(root?: string): ReviewInput;
export function assertCurrentReviewInput(expected: string, root?: string, label?: string): ReviewInput;
export function runReviewInputMutationControl(expected: string, root?: string): { before: string; after: string; mutated: string };
export function isMeasurableBrowserVersion(value: unknown): boolean;
export function assertReviewEnvironment(environment: unknown, label: string, options?: { historical?: boolean }): void;
export function assertObservedEnvironment(observed: unknown, label: string): void;
export function validateReviewLedger(ledger: unknown, options?: { cellCount?: number }): { rounds: number; latest: ReviewRound };
export function isRosteredHuman(reviewer: unknown): boolean;
export function summarizeLatestRound(ledger: ReviewLedger): {
  latest: ReviewRound;
  reviewers: string[];
  passingCells: number;
  humanPassingCells: number;
  humanPass: boolean;
};
export function latestBindingStatus(ledger: ReviewLedger, manifest: unknown, currentFingerprint: string): {
  inputs: boolean;
  environmentAndArtifacts: boolean;
  bound: boolean;
  reason: string | null;
};
export function describeLatestRound(ledger: ReviewLedger, manifest: unknown, currentFingerprint: string): string;
export function assessHumanGate(ledger: ReviewLedger, manifest: unknown, currentFingerprint: string): ReviewRound;

export interface ReviewRound {
  round: number;
  record: "current" | "historical" | "historical-reconstruction";
  outcome: "pass" | "fail" | "pending";
  reviewedAt: string | null;
  reviewers: { handle: string | null; kind: "human" | "agent" | "not-recorded"; model?: string }[];
  binding: null | { reviewInputFingerprint: string; renderManifestGeneratedAt: string; reviewEnvironment: Record<string, unknown> };
  findings: { blocker: number; high: number; medium: number; low: number };
  cells: null | Record<string, Record<string, unknown> & { status: "pass" | "fail" | "not-reviewed" }>;
  note: string;
  [key: string]: unknown;
}

export interface ReviewLedger {
  schemaVersion: number;
  rounds: ReviewRound[];
  [key: string]: unknown;
}

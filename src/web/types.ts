/**
 * Public, browser-driver-neutral screen contract.  The API deliberately names only the
 * methods checkPage uses, so installing breaklint never imports or requires Playwright.
 */

import type { RunVerdict, Severity } from "../core/enums.ts";
import type { Box, StableTargetIdentity } from "../core/types.ts";

export const SCREEN_REPORT_SCHEMA_VERSION = 2 as const;
export const READABLE_SCREEN_REPORT_SCHEMA_VERSIONS: readonly number[] = Object.freeze([1, 2]);

export type ScreenRuleId =
  | "web/unexpected-horizontal-overflow"
  | "web/content-clipped"
  | "web/sibling-overlap"
  | "web/svg-text-overflows-viewport"
  | "web/small-text"
  | "web/small-touch-target";

export interface StructuralPage {
  /** Matches Playwright's callable evaluate surface without naming its optional package types. */
  evaluate<R>(fn: (...args: any[]) => R | Promise<R>, ...args: any[]): Promise<R>;
  screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array>;
  url(): string;
  viewportSize(): { width: number; height: number } | null;
  context(): { browser(): { version(): string } | null };
}

export interface NamedScreenException {
  selector: string;
  reason: string;
  /** "scenario" (default) emits screen-exception-unused when unmatched; "suite" suppresses unused-noise while retaining count. */
  scope?: "scenario" | "suite";
}

export interface ScreenOptInRules {
  /** `web/sibling-overlap` is uncalibrated and off unless set to true. Off, the sibling pass never runs. */
  siblingOverlap?: boolean;
  smallText?: boolean | { minFontSizePx?: number };
  smallTouchTarget?: boolean | { minSizePx?: number };
}

export type ScreenFailOn = "warn" | "error";

export interface HostBuildContainer { selector: string; file: string; }

/** A host may supply ingredients for verification, never a claimed verification result. */
export interface HostBuildContainerBinding {
  kind: "host-build-container";
  root: string;
  receiptPath: string;
  /** Optional for generic hosts; without it no completed compiled-output binding is asserted. */
  buildOutputReceiptPath?: string;
  compiledBuildSelector: string;
  compiledBuildAttribute: string;
  containers: readonly HostBuildContainer[];
}

export interface CheckPageOptions {
  trust: "host-controlled-page";
  networkPolicy: "host-owned";
  scenario: string;
  projectId?: string;
  documentId?: string;
  runId?: string;
  /** Lowest finding severity that turns the verdict into `findings`. Default `warn` (every finding gates). */
  failOn?: ScreenFailOn;
  output: { dir: string; screenshot: "viewport" | "full-page" };
  geometry?: {
    allowedScrollContainers?: readonly NamedScreenException[];
    intentionalOverlays?: readonly NamedScreenException[];
    maxTargets?: number;
    stabilizationTimeoutMs?: number;
    rules?: ScreenOptInRules;
  };
  sourceBinding?: HostBuildContainerBinding;
}

export interface ScreenTargetRef {
  selector: string;
  domPath: string;
  tag: string;
  box: Box | null;
  coordinateSystem: "css-viewport-pixels" | "css-document-pixels";
  scroll: { x: number; y: number };
}

export interface ScreenMeasurement {
  name: string;
  value: number | boolean | string | null;
  unit: "css-px" | "count" | null;
  operator: ">" | "<" | "=" | null;
  threshold: number | boolean | string | null;
  calibrated?: false;
}

export interface ScreenTargetEvaluation {
  id: string;
  ruleId: ScreenRuleId;
  target: ScreenTargetRef;
  status: "measured" | "excluded" | "not-measured";
  reason: string | null;
  measurements: ScreenMeasurement[];
  predicate: { connective: "single"; violated: boolean | null };
  evidenceBound: boolean;
  source: {
    status: "verified-container-only" | "declared" | "unknown";
    method: "build-bound-component-container" | null;
    file: string | null;
  };
  stableIdentity: StableTargetIdentity;
}

export interface ScreenFinding {
  id: string;
  ruleId: ScreenRuleId;
  severity: Severity;
  target: ScreenTargetRef;
  measurement: ScreenMeasurement;
  evaluationId: string;
  evidence: { bindsFinding: boolean; screenshot: string | null };
  repair: { nextCheck: "rerun-same-scenario-and-viewport" };
}

export interface ScreenInfrastructureEvent { kind: string; detail: string; fatal: boolean; }

export interface ScreenDriftDetail {
  phase: "pre-screenshot" | "post-screenshot";
  field: string;
  selector: string | null;
  before: string | number | null;
  after: string | number | null;
}

export interface ScreenArtifact {
  kind: "png";
  relativePath: string | null;
  sha256: string | null;
  byteLength: number | null;
  widthPx: number | null;
  heightPx: number | null;
  capture: "viewport" | "full-page";
  coordinateSystem: "css-viewport-pixels-with-scroll" | "css-document-pixels";
}

export interface ScreenCoverage {
  candidates: number;
  measured: number;
  excluded: number;
  notMeasured: number;
  allowedScrollContainers: { selector: string; reason: string; scope: "scenario" | "suite"; count: number }[];
  intentionalOverlays: { selector: string; reason: string; scope: "scenario" | "suite"; count: number }[];
}

export interface PublicScreenReport {
  schemaVersion: 1 | 2;
  profileKind: "screen";
  runId: string;
  runVerdict: RunVerdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  scope: {
    projectId: string | null;
    documentId: string | null;
    scenario: string;
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    browserVersion: string | null;
  };
  trust: "host-controlled-page";
  networkPolicy: "host-owned";
  /** The finding gate that decided between `findings` and `clean` (absent in reports before 0.11.1). */
  failOn?: ScreenFailOn;
  rulesEnabled?: ScreenRuleId[];
  targetInventory: { complete: boolean; omittedCount: number; reason: string | null };
  coverage: ScreenCoverage;
  capture: {
    before: string;
    stable: string;
    after: string;
    fontsReady: boolean;
    timedOut: boolean;
    drifted: boolean;
    stabilized?: boolean;
    stabilizationAttempts?: number;
    /** Why the stabilization loop ended: two identical samples, the time budget, or the attempt limit (0.11.1). */
    stabilizationEndedBy?: "stable" | "timeout" | "attempt-limit";
    /** Duration of the first page sample in ms; the stabilization budget starts after it (0.11.1). */
    firstSampleMs?: number;
    driftDetails?: ScreenDriftDetail[];
  };
  artifact: ScreenArtifact;
  evaluations: ScreenTargetEvaluation[];
  findings: ScreenFinding[];
  infrastructure: ScreenInfrastructureEvent[];
  events: { kind: string; detail: string }[];
}

export type ScreenCheckResult =
  | { ok: true; report: PublicScreenReport }
  | { ok: false; report: PublicScreenReport };

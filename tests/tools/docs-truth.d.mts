export interface Stamps {
  report: number;
  reportConstant: number;
  readable: number[];
  snapshot: number;
  context: number;
  comparison: number;
  config: number;
  packageVersion: string;
}

export interface PendingCorrection {
  file: string;
  kind: string;
  number: number | string;
  unit: string;
  reason: string;
}

export interface DocsTruthIssue {
  file: string;
  line: number;
  kind: string;
  number: number | string;
  unit: string;
  message: string;
}

export function scanIssues(file: string, text: string, stamps: Stamps): DocsTruthIssue[];

export function currentStamps(packageDir: string): Stamps;

export function scanText(file: string, text: string, stamps: Stamps): string[];

export function shippedDocuments(packageDir: string): string[];

export function checkDocsTruth(input: {
  packageDir: string;
  docsRoot?: string;
  extra?: string[];
  pending?: PendingCorrection[];
  stamps?: Stamps;
}): { valid: boolean; issues: string[]; scanned: number; stamps: Stamps };

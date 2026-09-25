export const SARIF_SCHEMA_PATH: string;
export const SARIF_SCHEMA_SHA256: string;
export const RUN_VERDICTS: readonly string[];
export function sarifValidator(): (document: unknown) => boolean;
export function sarifProblems(document: unknown): string[];
export function junitProblems(xml: string): string[];
export function markdownProblems(markdown: string, expectedVerdict?: string): string[];

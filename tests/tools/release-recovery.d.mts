export const REGISTRY_ATTEMPTS: number;

export function changelogSection(text: string, version: string): string;

export function ancestryVerdict(status: number | null): { onMain: boolean; reason?: string };

export type RegistryLookup =
  | { state: "absent" }
  | { state: "present"; metadata?: unknown }
  | { state: "error"; reason: string };

export function classifyLookup(
  run: { status: number | null; stdout: string; stderr: string },
  version: string,
): RegistryLookup;

export function decideRegistry(options: {
  lookup: () => Promise<RegistryLookup>;
  verify: (lookup: RegistryLookup) => Promise<boolean>;
  attempts: number;
  sleep: () => Promise<void>;
}): Promise<{ publishNeeded: boolean; attempts: number }>;

export interface GithubReleaseState {
  tagName: string;
  isDraft: boolean;
  assets: Record<string, string>;
}

export function planGithubRelease(input: {
  tag: string;
  release: GithubReleaseState | null;
  local: Record<string, string>;
}): { action: "create" | "complete-draft" | "verified"; upload: string[] };

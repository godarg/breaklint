export function testFilesIn(directories: string[]): string[];

export const defaultUnitOutputTarget: string;
export const defaultAggregateOutputTarget: string;

export function buildSuitePlan(): { unitFiles: string[]; aggregateFiles: string[] };

export function buildRunnerPlan(options?: {
  unitOutputTarget?: string;
  aggregateOutputTarget?: string;
}): {
  aggregate: { testFiles: string[]; outputTarget: string; mirrorStdout: true };
  unit: { testFiles: string[]; outputTarget: string; mirrorStdout: false };
};

export function isMainModule(argvPath: string | undefined, modulePath?: string): boolean;

export function lastTapTestCount(tapText: string): number | null;

export function runTapSuite(
  testFiles: string[],
  outputTarget: string,
  mirrorStdout: boolean,
  extraEnv?: Record<string, string>,
): Promise<{ code: number; testCount: number | null }>;

export const SUITE_TEMPORARY_ALLOWLIST: Readonly<Record<string, string>>;

export function strayTemporaryEntries(directory: string, allowlist?: Readonly<Record<string, string>>): string[];

export function privateTemporaryEnvironment(directory: string): { TMPDIR: string; TMP: string; TEMP: string };

export function runSuiteInPrivateTemporaryDirectory(
  plan: {
    aggregate: { testFiles: string[]; outputTarget: string; mirrorStdout: boolean };
    unit: { testFiles: string[]; outputTarget: string; mirrorStdout: boolean };
  },
  options?: { temporaryParent?: string; report?: (text: string) => void },
): Promise<number>;

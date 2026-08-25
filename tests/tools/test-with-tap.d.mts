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
): Promise<{ code: number; testCount: number | null }>;

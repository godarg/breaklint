export function testFilesIn(directories: string[]): string[];

export function buildSuitePlan(): { unitFiles: string[]; aggregateFiles: string[] };

export function runTapSuite(
  testFiles: string[],
  outputTarget: string,
  mirrorStdout: boolean,
): Promise<{ code: number; testCount: number | null }>;

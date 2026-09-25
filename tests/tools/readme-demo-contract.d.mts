export const FINDING_HEADER: RegExp;

export interface ReadmeDemoCheck {
  valid: boolean;
  issues: string[];
  countWord?: string;
  printed?: number;
}

export function checkReadmeDemo(readmeText: string, demoStdout: string, demoExit: number): ReadmeDemoCheck;

export function corruptions(readmeText: string): { name: string; text: string }[];

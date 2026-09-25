export interface WorkflowLine {
  number: number;
  text: string;
}

export interface WorkflowJob {
  name: string;
  startLine: number;
  lines: WorkflowLine[];
}

export function executablePart(line: string): string;
export function jobsOf(lines: string[]): WorkflowJob[];
export function stepsOf(jobLines: WorkflowLine[]): WorkflowLine[][];
export function conditionKeys(step: WorkflowLine[]): { number: number; key: string }[];

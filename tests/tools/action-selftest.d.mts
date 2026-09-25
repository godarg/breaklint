export interface ArmExpectation {
  outcome: "success" | "failure";
  exitCode: number;
  verdict: string;
  report: boolean;
  inputsFound?: number;
}
export const ARMS: Readonly<Record<"CLEAN" | "FINDINGS" | "UNGATED" | "INFRASTRUCTURE" | "USAGE" | "REFUSED", ArmExpectation>>;
export function checkArm(name: string, step: unknown, expected: ArmExpectation): string[];

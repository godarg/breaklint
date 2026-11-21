export const WORD_BUDGETS: Readonly<Record<string, number>>;

export function countWords(text: string): number;

export function checkWordBudgets(root?: string, budgets?: Record<string, number>): {
  valid: boolean;
  issues: string[];
  measured: { file: string; words: number; budget: number }[];
};

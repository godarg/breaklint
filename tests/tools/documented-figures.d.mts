export interface DocumentedFigures {
  unitTests: number;
  liveReportLeaves: number;
  s1RasterDiffPx: number;
  s1ForeignRasterDiffPx: number;
}

export interface DocumentedFiguresEvaluation {
  valid: boolean;
  documented: DocumentedFigures;
  measured: DocumentedFigures;
  issues: string[];
}

export function evaluateDocumentedFigures(input: {
  statusText: string;
  unitTapText: string;
  liveReport: unknown;
}): DocumentedFiguresEvaluation;

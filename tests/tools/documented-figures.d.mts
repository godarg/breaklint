export interface DocumentedFigures {
  unitTests: number;
  aggregateTests: number;
  liveTests: number;
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
  aggregateTapText: string;
  liveSummary: unknown;
  liveReport: unknown;
}): DocumentedFiguresEvaluation;

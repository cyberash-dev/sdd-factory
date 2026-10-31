import type { EarlierRun } from "../../domain/report.js";

export interface ReportTexts {
  readonly traceMd: string;
  readonly costsJson: string;
}

export interface PublishedTexts extends ReportTexts {
  readonly interventionsTail: string;
}

export interface TraceStore {
  appendRecord(line: string): void;
  createInterventions(firstLine: string): void;
  appendIntervention(line: string): void;
  writeReports(texts: ReportTexts): Promise<void>;
  publishTo(destinationDir: string, texts: PublishedTexts): Promise<void>;
}

export type ProductTextReader = (relativePath: string) => string | null;

/* The earlier runs of this run's resume chain, first run first; empty for a run that is not a resume. */
export type EarlierRunReader = () => readonly EarlierRun[];

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { writeTextAtomic } from "../../../shared/fs/text.js";
import type { Redactor } from "../../domain/redaction.js";
import type { ProductTextReader, PublishedTexts, ReportTexts, TraceStore } from "../../ports/outbound/trace-store.js";

export const TRACE_FILE_NAMES = {
  records: "trace.jsonl",
  report: "trace.md",
  interventions: "interventions.md",
  costs: "costs.json",
} as const;

export class TraceFiles implements TraceStore {
  constructor(
    private readonly directory: string,
    private readonly redactor: Redactor,
  ) {
    mkdirSync(directory, { recursive: true });
  }

  appendRecord(line: string): void {
    appendFileSync(this.path(TRACE_FILE_NAMES.records), `${this.redactor.text(line)}\n`, "utf8");
  }

  createInterventions(firstLine: string): void {
    writeFileSync(this.path(TRACE_FILE_NAMES.interventions), this.redactor.text(firstLine), "utf8");
  }

  appendIntervention(line: string): void {
    appendFileSync(this.path(TRACE_FILE_NAMES.interventions), this.redactor.text(line), "utf8");
  }

  async writeReports(texts: ReportTexts): Promise<void> {
    await writeTextAtomic(this.path(TRACE_FILE_NAMES.report), this.redactor.text(texts.traceMd));
    await writeTextAtomic(this.path(TRACE_FILE_NAMES.costs), this.redactor.text(texts.costsJson));
  }

  async publishTo(destinationDir: string, texts: PublishedTexts): Promise<void> {
    await mkdir(destinationDir, { recursive: true });
    await copyFile(this.path(TRACE_FILE_NAMES.records), join(destinationDir, TRACE_FILE_NAMES.records));
    const interventions = await readFile(this.path(TRACE_FILE_NAMES.interventions), "utf8");
    await writeTextAtomic(join(destinationDir, TRACE_FILE_NAMES.interventions), interventions + this.redactor.text(texts.interventionsTail));
    await writeTextAtomic(join(destinationDir, TRACE_FILE_NAMES.report), this.redactor.text(texts.traceMd));
    await writeTextAtomic(join(destinationDir, TRACE_FILE_NAMES.costs), this.redactor.text(texts.costsJson));
  }

  private path(name: string): string {
    return join(this.directory, name);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function productTextReader(productDir: string): ProductTextReader {
  return (relativePath: string): string | null => {
    try {
      return readFileSync(isAbsolute(relativePath) ? relativePath : join(productDir, relativePath), "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  };
}

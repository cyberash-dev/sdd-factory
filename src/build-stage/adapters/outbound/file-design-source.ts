import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTasksJson } from "../../../shared/design-files/tasks-json.js";
import { parseTechMd } from "../../../shared/design-files/tech-md.js";
import { parseVerificationMd } from "../../../shared/design-files/verification-md.js";
import type { DesignBundle, DesignSource } from "../../ports/outbound/design-source.js";

export const DESIGN_FILES = { tech: "design/tech.md", verification: "design/verification.md", tasks: "design/tasks.json" } as const;

export function createFileDesignSource(): DesignSource {
  return {
    async load(productDir: string): Promise<DesignBundle> {
      const [tech, verification, tasks] = await Promise.all([
        readFile(join(productDir, DESIGN_FILES.tech), "utf8"),
        readFile(join(productDir, DESIGN_FILES.verification), "utf8"),
        readFile(join(productDir, DESIGN_FILES.tasks), "utf8"),
      ]);
      return { tech: parseTechMd(tech), verification: parseVerificationMd(verification), tasks: parseTasksJson(tasks) };
    },
  };
}

import type { TasksFile } from "../../../shared/design-files/tasks-json.js";
import type { TechDesign } from "../../../shared/design-files/tech-md.js";
import type { VerificationDesign } from "../../../shared/design-files/verification-md.js";

export interface DesignBundle {
  readonly tech: TechDesign;
  readonly verification: VerificationDesign;
  readonly tasks: TasksFile;
}

export interface DesignSource {
  load(productDir: string): Promise<DesignBundle>;
}

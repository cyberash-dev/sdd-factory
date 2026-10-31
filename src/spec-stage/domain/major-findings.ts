import YAML from "yaml";
import { findingsYaml, type GaReview } from "./ga-review.js";

export const MAJOR_FINDINGS_PATH = "spec/review/ga-major.md";

const ASSUMPTIONS_SECTION = /^## Assumptions[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
const YAML_FENCE = /^```ya?ml\s*\n[\s\S]*?\n```/gm;
const FENCE_ID = /^id:\s*["']?([^"'\s]+)["']?\s*$/m;

/* Each finding's own source lines, from its "- " line to its end, so ga-major.md keeps the critic's text unchanged. */
function findingBlocks(yaml: string): readonly string[] {
  const document = YAML.parseDocument(yaml);
  const items = YAML.isSeq(document.contents) ? document.contents.items : [];
  return items.map((item) => {
    const [start, , end] = item.range;
    return yaml.slice(yaml.lastIndexOf("\n", start) + 1, end).trimEnd();
  });
}

function assumptionFences(text: string, ids: ReadonlySet<string>): readonly string[] {
  const section = ASSUMPTIONS_SECTION.exec(text)?.[1] ?? "";
  return [...section.matchAll(YAML_FENCE)].map((fence) => fence[0]).filter((fence) => ids.has(FENCE_ID.exec(fence)?.[1] ?? ""));
}

/* spec-stage:DLT-014: spec/review/ga-major.md, the ga.md of spec-stage:CTR-003 cut down to its major findings and their ASSUMPTION bodies. */
export function renderMajorFindings(text: string, review: GaReview): string {
  const blocks = findingBlocks(findingsYaml(text) ?? "");
  const isMajor = review.findings.map((finding) => finding.severity === "major");
  const majors = review.findings.filter((finding) => finding.severity === "major");
  const referenced = new Set(majors.flatMap((finding) => (finding.assumption === null ? finding.targetIds : [...finding.targetIds, finding.assumption])));
  const fences = assumptionFences(text, referenced);
  return [
    `# Spec review: ${review.slug}, round ${review.round}`,
    "",
    "decision: rework",
    "",
    "## Findings",
    "```yaml",
    ...blocks.filter((_, index) => isMajor[index] === true),
    "```",
    "",
    "## Assumptions",
    ...(fences.length === 0 ? ["none"] : fences.flatMap((fence) => ["", fence])),
    "",
  ].join("\n");
}

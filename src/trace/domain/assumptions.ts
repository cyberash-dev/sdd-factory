import { parse } from "yaml";
import { isRecord } from "./guards.js";

export interface AssumptionNote {
  readonly id: string;
  readonly text: string;
}

const YAML_FENCE = /```ya?ml\r?\n([\s\S]*?)```/g;

function assumptionOf(yamlText: string): AssumptionNote | null {
  let parsed: unknown;
  try {
    parsed = parse(yamlText);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed["type"] !== "ASSUMPTION") {
    return null;
  }
  const id = parsed["id"];
  const text = parsed["assumption"];
  return typeof id === "string" && typeof text === "string" ? { id, text: text.trim().replace(/\s+/g, " ") } : null;
}

export function assumptionsOf(markdown: string): readonly AssumptionNote[] {
  const notes: AssumptionNote[] = [];
  for (const match of markdown.matchAll(YAML_FENCE)) {
    const note = assumptionOf(match[1] ?? "");
    if (note !== null) {
      notes.push(note);
    }
  }
  return notes;
}

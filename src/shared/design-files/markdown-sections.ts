export interface MarkdownSection {
  readonly title: string;
  readonly lines: readonly string[];
}

const SECTION_HEADING = /^##\s+(?:\d+\.\s*)?(.+?)\s*$/;

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/* Splits on `## ` headings outside code fences; the preamble before the first heading has an empty title. */
export function splitSections(markdown: string): readonly MarkdownSection[] {
  const sections: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    }
    const heading = inFence ? null : SECTION_HEADING.exec(line);
    if (heading !== null && heading[1] !== undefined) {
      sections.push({ title: normaliseTitle(heading[1]), lines: [] });
      continue;
    }
    sections[sections.length - 1]?.lines.push(line);
  }
  return sections;
}

export function findSection(sections: readonly MarkdownSection[], matcher: (title: string) => boolean): MarkdownSection | null {
  return sections.find((section) => matcher(section.title)) ?? null;
}

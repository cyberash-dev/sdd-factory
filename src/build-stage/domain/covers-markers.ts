const MARKER = /@covers\s+([A-Za-z0-9_-]+:[A-Za-z0-9_-]+)/g;

export function coversMarkersIn(source: string): readonly string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(MARKER)) {
    const id = match[1];
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return [...ids];
}

export interface TreeSnapshot {
  readonly head: string | null;
  readonly tree: string;
}

export type FileChangeKind = "added" | "modified" | "deleted";

export interface FileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
}

export interface TreeChanges {
  readonly files: readonly FileChange[];
  readonly headMoved: boolean;
}

/* A directory's content (tracked, modified and untracked non-ignored files) and HEAD, captured without touching the real index. */
export interface WorkingTree {
  snapshot(directory: string): Promise<TreeSnapshot>;
  changesSince(directory: string, snapshot: TreeSnapshot): Promise<TreeChanges>;
  restore(directory: string, snapshot: TreeSnapshot, changes: TreeChanges): Promise<void>;
}

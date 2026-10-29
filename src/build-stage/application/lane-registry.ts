export interface LaneToken {
  readonly taskId: string;
  readonly generation: number;
}

/* Running `claude` subprocesses cannot be killed through the kernel runner; a lane generation lets late results be dropped instead. */
export class LaneRegistry {
  private readonly generations = new Map<string, number>();
  private allCancelled = false;

  tokenOf(taskId: string): LaneToken {
    return { taskId, generation: this.generations.get(taskId) ?? 0 };
  }

  isLive(token: LaneToken): boolean {
    return !this.allCancelled && (this.generations.get(token.taskId) ?? 0) === token.generation;
  }

  cancel(taskId: string): void {
    this.generations.set(taskId, (this.generations.get(taskId) ?? 0) + 1);
  }

  cancelAll(): void {
    this.allCancelled = true;
  }
}

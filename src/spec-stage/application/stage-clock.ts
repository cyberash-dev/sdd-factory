export interface StageClock {
  start(ms: number, onExpire: () => void): void;
  stop(): void;
}

export function createStageClock(): StageClock {
  let timer: NodeJS.Timeout | null = null;
  return {
    start(ms, onExpire) {
      this.stop();
      timer = setTimeout(() => {
        timer = null;
        onExpire();
      }, ms);
      timer.unref();
    },
    stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

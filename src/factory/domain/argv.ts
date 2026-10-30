export interface RunCommand {
  readonly kind: "run";
  readonly specPath: string;
  readonly operator: string | null;
  readonly push: boolean;
  readonly outDir: string | null;
  readonly maxParallelLanes: number | null;
}

export interface NudgeCommand {
  readonly kind: "nudge";
  readonly runId: string;
  readonly note: string;
}

export interface ResumeCommand {
  readonly kind: "resume";
  readonly runId: string;
  readonly note: string | null;
  readonly force: boolean;
  readonly push: boolean;
  readonly outDir: string | null;
  readonly maxParallelLanes: number | null;
}

export type ReplayTarget = { readonly kind: "seq"; readonly seq: number } | { readonly kind: "last" };

export interface ReplayCommand {
  readonly kind: "replay";
  readonly runId: string;
  readonly event: ReplayTarget;
}

export type FactoryCommand = RunCommand | NudgeCommand | ResumeCommand | ReplayCommand;

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export const USAGE = [
  "usage: factory run <spec.md> [--operator <identity>] [--no-push] [--out <dir>] [--max-parallel-lanes <1..8>]",
  "       factory nudge <runId> --note <text>",
  "       factory resume <runId> [--note <text>] [--force] [--no-push] [--out <dir>] [--max-parallel-lanes <1..8>]",
  "       factory replay <runId> (--event <seq> | --last)",
].join("\n");

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

function parseMaxParallelLanes(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new UsageError(`--max-parallel-lanes must be an integer between 1 and 8, got ${raw}`);
  }
  return parsed;
}

function parseRun(argv: readonly string[]): RunCommand {
  let specPath: string | null = null;
  let operator: string | null = null;
  let push = true;
  let outDir: string | null = null;
  let maxParallelLanes: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    switch (argument) {
      case "--operator":
        operator = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--no-push":
        push = false;
        break;
      case "--out":
        outDir = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--max-parallel-lanes":
        maxParallelLanes = parseMaxParallelLanes(takeValue(argv, index, argument));
        index += 1;
        break;
      default:
        if (argument.startsWith("--")) {
          throw new UsageError(`unknown flag ${argument}`);
        }
        if (specPath !== null) {
          throw new UsageError(`unexpected positional argument ${argument}`);
        }
        specPath = argument;
    }
  }
  if (specPath === null) {
    throw new UsageError("missing <spec.md>");
  }
  return { kind: "run", specPath, operator, push, outDir, maxParallelLanes };
}

function parseNudge(argv: readonly string[]): NudgeCommand {
  let runId: string | null = null;
  let note: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--note") {
      note = takeValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new UsageError(`unknown flag ${argument}`);
    } else if (runId === null) {
      runId = argument;
    } else {
      throw new UsageError(`unexpected positional argument ${argument}`);
    }
  }
  if (runId === null) {
    throw new UsageError("missing <runId>");
  }
  if (note === null) {
    throw new UsageError("--note is required");
  }
  return { kind: "nudge", runId, note };
}

function parseResume(argv: readonly string[]): ResumeCommand {
  let runId: string | null = null;
  let note: string | null = null;
  let force = false;
  let push = true;
  let outDir: string | null = null;
  let maxParallelLanes: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    switch (argument) {
      case "--note":
        note = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "--no-push":
        push = false;
        break;
      case "--out":
        outDir = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--max-parallel-lanes":
        maxParallelLanes = parseMaxParallelLanes(takeValue(argv, index, argument));
        index += 1;
        break;
      default:
        if (argument.startsWith("--")) {
          throw new UsageError(`unknown flag ${argument}`);
        }
        if (runId !== null) {
          throw new UsageError(`unexpected positional argument ${argument}`);
        }
        runId = argument;
    }
  }
  if (runId === null) {
    throw new UsageError("missing <runId>");
  }
  return { kind: "resume", runId, note, force, push, outDir, maxParallelLanes };
}

function parseSeq(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`--event must be a positive integer seq, got ${raw}`);
  }
  return parsed;
}

function parseReplay(argv: readonly string[]): ReplayCommand {
  let runId: string | null = null;
  let event: ReplayTarget | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--event" || argument === "--last") {
      if (event !== null) {
        throw new UsageError("--event and --last are mutually exclusive");
      }
      event = argument === "--last" ? { kind: "last" } : { kind: "seq", seq: parseSeq(takeValue(argv, index, argument)) };
      index += argument === "--event" ? 1 : 0;
    } else if (argument.startsWith("--")) {
      throw new UsageError(`unknown flag ${argument}`);
    } else if (runId === null) {
      runId = argument;
    } else {
      throw new UsageError(`unexpected positional argument ${argument}`);
    }
  }
  if (runId === null) {
    throw new UsageError("missing <runId>");
  }
  if (event === null) {
    throw new UsageError("one of --event <seq> or --last is required");
  }
  return { kind: "replay", runId, event };
}

export function parseArgv(argv: readonly string[]): FactoryCommand {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "run":
      return parseRun(rest);
    case "nudge":
      return parseNudge(rest);
    case "resume":
      return parseResume(rest);
    case "replay":
      return parseReplay(rest);
    case undefined:
      throw new UsageError("missing subcommand");
    default:
      throw new UsageError(`unknown subcommand ${subcommand}`);
  }
}

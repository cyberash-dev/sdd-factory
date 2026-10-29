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

export type FactoryCommand = RunCommand | NudgeCommand;

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export const USAGE = [
  "usage: factory run <spec.md> [--operator <identity>] [--no-push] [--out <dir>] [--max-parallel-lanes <1..8>]",
  "       factory nudge <runId> --note <text>",
].join("\n");

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
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
      case "--max-parallel-lanes": {
        const raw = takeValue(argv, index, argument);
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
          throw new UsageError(`--max-parallel-lanes must be an integer between 1 and 8, got ${raw}`);
        }
        maxParallelLanes = parsed;
        index += 1;
        break;
      }
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

export function parseArgv(argv: readonly string[]): FactoryCommand {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "run":
      return parseRun(rest);
    case "nudge":
      return parseNudge(rest);
    case undefined:
      throw new UsageError("missing subcommand");
    default:
      throw new UsageError(`unknown subcommand ${subcommand}`);
  }
}

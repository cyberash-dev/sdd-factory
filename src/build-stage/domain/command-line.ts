export class CommandLineError extends Error {
  override readonly name = "CommandLineError";
}

const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;

export function argvOf(commandLine: string): readonly string[] {
  const argv: string[] = [];
  for (const match of commandLine.matchAll(TOKEN)) {
    argv.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  if (argv.length === 0) {
    throw new CommandLineError(`empty command line: ${JSON.stringify(commandLine)}`);
  }
  return argv;
}

const HEREDOC_OPERATOR = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
const SHELL_TOKEN = /"([^"]*)"|'([^']*)'|(>>?)|([;|&\n]+)|([^\s;|&<>"']+)/g;
const PRINTING_COMMANDS = new Set(["echo", "printf"]);

interface ShellToken {
  readonly text: string;
  readonly kind: "word" | "redirect" | "separator";
}

/* Heredoc bodies are file content written by the command, not paths it touches. */
export function withoutHeredocBodies(command: string): string {
  const kept: string[] = [];
  const pendingTerminators: string[] = [];
  for (const line of command.split("\n")) {
    const terminator = pendingTerminators[0];
    if (terminator !== undefined) {
      if (line.trim() === terminator) pendingTerminators.shift();
      continue;
    }
    kept.push(line);
    for (const match of line.matchAll(HEREDOC_OPERATOR)) {
      pendingTerminators.push(match[3] ?? "");
    }
  }
  return kept.join("\n");
}

function shellTokens(command: string): readonly ShellToken[] {
  return [...command.matchAll(SHELL_TOKEN)].map((match): ShellToken => {
    if (match[3] !== undefined) return { text: match[3], kind: "redirect" };
    if (match[4] !== undefined) return { text: match[4], kind: "separator" };
    return { text: match[1] ?? match[2] ?? match[5] ?? "", kind: "word" };
  });
}

function segmentsOf(tokens: readonly ShellToken[]): readonly (readonly ShellToken[])[] {
  const segments: ShellToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "separator") segments.push([]);
    else segments[segments.length - 1]?.push(token);
  }
  return segments;
}

/* echo/printf arguments are printed text; only their redirect target is a path. */
function pathCandidatesOf(segment: readonly ShellToken[]): readonly string[] {
  const words = segment.filter((token) => token.kind === "word").map((token) => token.text);
  if (!PRINTING_COMMANDS.has(words[0] ?? "")) return words;
  return segment.filter((token, index) => token.kind === "word" && segment[index - 1]?.kind === "redirect").map((token) => token.text);
}

export function shellPathCandidates(command: string): readonly string[] {
  return segmentsOf(shellTokens(withoutHeredocBodies(command))).flatMap(pathCandidatesOf);
}

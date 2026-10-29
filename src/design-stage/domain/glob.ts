const REGEXP_SPECIALS = new Set(["\\", "^", "$", ".", "|", "?", "+", "(", ")", "[", "]", "{", "}"]);

/* Supports `**` (any depth, including none), `*` (within one segment) and literal paths. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    if (char !== "*") {
      source += REGEXP_SPECIALS.has(char) ? `\\${char}` : char;
      continue;
    }
    if (glob[index + 1] !== "*") {
      source += "[^/]*";
      continue;
    }
    if (glob[index + 2] === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else {
      source += ".*";
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

export function globMatches(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

export function anyGlobMatches(globs: readonly string[], path: string): boolean {
  return globs.some((glob) => globMatches(glob, path));
}

import type { TechExport, TechModule } from "../../shared/design-files/tech-md.js";

function notImplemented(name: string): string {
  return `throw new Error("not implemented: ${name}");`;
}

function withoutExportModifiers(signature: string): string {
  return signature.trim().replace(/^export\s+/, "").replace(/^declare\s+/, "");
}

function withoutExportKeyword(signature: string): string {
  return withoutExportModifiers(signature).replace(/;\s*$/, "");
}

function functionStub(name: string, signature: string): string {
  const declaration = withoutExportKeyword(signature).replace(/^async\s+/, "");
  const callForm = new RegExp(`^(?:function\\s+)?${name}\\s*(<[\\s\\S]*?>)?\\s*\\(`);
  const call = callForm.exec(declaration);
  if (call !== null) {
    const tail = declaration.slice(declaration.indexOf("(", call[0].length - 1));
    return `export function ${name}${call[1] ?? ""}${tail} {\n  ${notImplemented(name)}\n}`;
  }
  const typed = new RegExp(`^(?:const\\s+)?${name}\\s*:\\s*([\\s\\S]+)$`).exec(declaration);
  if (typed !== null) {
    return `export const ${name}: ${typed[1] ?? ""} = () => {\n  ${notImplemented(name)}\n};`;
  }
  if (declaration.startsWith("(")) {
    return `export const ${name}: ${declaration} = () => {\n  ${notImplemented(name)}\n};`;
  }
  return `export function ${name}(..._args: unknown[]): never {\n  ${notImplemented(name)}\n}`;
}

function classMembers(signature: string): string | null {
  const open = signature.indexOf("{");
  const close = signature.lastIndexOf("}");
  if (open === -1 || close <= open) {
    return null;
  }
  const members = signature
    .slice(open + 1, close)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(constructor|static|private|protected)\b/.test(line))
    .map((line) => line.replace(/^public\s+/, ""));
  return members.length === 0 ? null : members.map((line) => `  ${line}`).join("\n");
}

function classStub(name: string, signature: string): string {
  const members = classMembers(withoutExportKeyword(signature));
  const declaration = `export class ${name} {\n  constructor(..._args: unknown[]) {\n    ${notImplemented(name)}\n  }\n}`;
  return members === null ? declaration : `${declaration}\nexport interface ${name} {\n${members}\n}`;
}

function constStub(name: string, signature: string): string {
  const declaration = withoutExportKeyword(signature);
  const typed = new RegExp(`^(?:const\\s+)?${name}\\s*:\\s*([\\s\\S]+?)(?:\\s*=[\\s\\S]*)?$`).exec(declaration);
  const proxy = `new Proxy({}, { get: (_target, key) => { throw new Error("not implemented: ${name}." + String(key)); } })`;
  return typed === null ? `export const ${name} = ${proxy} as never;` : `export const ${name}: ${typed[1] ?? ""} = ${proxy} as unknown as ${typed[1] ?? ""};`;
}

function typeStub(keyword: "type" | "interface", name: string, signature: string): string {
  const verbatim = withoutExportModifiers(signature);
  if (verbatim.startsWith(`${keyword} `)) {
    return `export ${verbatim}`;
  }
  const declaration = withoutExportKeyword(signature);
  if (declaration.startsWith(name)) {
    return `export ${keyword} ${declaration}`;
  }
  return keyword === "type" ? `export type ${name} = ${declaration};` : `export interface ${name} ${declaration}`;
}

export function stubForExport(item: TechExport): string {
  switch (item.kind) {
    case "function":
      return functionStub(item.name, item.signature);
    case "class":
      return classStub(item.name, item.signature);
    case "const":
      return constStub(item.name, item.signature);
    case "type":
      return typeStub("type", item.name, item.signature);
    case "interface":
      return typeStub("interface", item.name, item.signature);
  }
}

/* A scaffold placeholder exporting nothing is not an implementation: the stub replaces it. */
export function isPlaceholderModule(source: string): boolean {
  const body = source.trim();
  return body.length === 0 || body === "export {};" || body === "export {}";
}

const IMPORT_END = /(?:\bfrom\s*|^import\s*)["'][^"']+["']\s*;?\s*$/;

function importStatements(interfaceSource: string): readonly string[] {
  const statements: string[] = [];
  let pending: string[] | null = null;
  for (const line of interfaceSource.split("\n")) {
    if (pending === null && /^import\b/.test(line.trimStart())) {
      pending = [];
    }
    if (pending === null) {
      continue;
    }
    pending.push(line);
    if (IMPORT_END.test(line.trim())) {
      statements.push(pending.join("\n").trim());
      pending = null;
    }
  }
  return statements;
}

export function stubSource(module: TechModule): string {
  if (module.exports.length === 0) {
    return "export {};\n";
  }
  const imports = importStatements(module.interfaceSource);
  const header = imports.length === 0 ? "" : `${imports.join("\n")}\n\n`;
  return `${header}${module.exports.map(stubForExport).join("\n\n")}\n`;
}

export function modulesOfTask(modules: readonly TechModule[], task: { readonly designRefs: readonly string[]; readonly covers: readonly string[] }): readonly TechModule[] {
  return modules.filter((module) => task.designRefs.includes(module.id) || module.covers.some((id) => task.covers.includes(id)));
}

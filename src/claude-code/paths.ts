// Path helpers for the mod runtime, which has no `node:path`. POSIX and Windows drive paths.

const DRIVE = /^[A-Za-z]:/;

export function isAbsolute(path: string): boolean {
  return /^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path);
}

/** Folds `.`, `..`, and repeated separators, keeping the path's own separator style. */
export function normalize(path: string): string {
  const separator = separatorOf(path);
  const drive = DRIVE.exec(path)?.[0] ?? "";
  const rest = path.slice(drive.length);
  const absolute = /^[\\/]/.test(rest);
  const parts: string[] = [];
  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  const body = parts.join(separator);
  if (absolute) return `${drive}${separator}${body}`;
  return `${drive}${body}` || ".";
}

export function resolve(base: string, target: string): string {
  return isAbsolute(target) ? normalize(target) : normalize(`${base}${separatorOf(base)}${target}`);
}

export function join(...parts: string[]): string {
  return normalize(parts.join(separatorOf(parts[0] ?? "/")));
}

export function dirname(path: string): string {
  const normalized = normalize(path);
  const separator = separatorOf(normalized);
  const index = normalized.lastIndexOf(separator);
  if (index === -1) return ".";
  const head = normalized.slice(0, index);
  if (head === "") return separator;
  if (DRIVE.test(head) && head.length === 2) return `${head}${separator}`;
  return head;
}

function separatorOf(path: string): "/" | "\\" {
  return /^[A-Za-z]:\\/.test(path) || (path.includes("\\") && !path.includes("/")) ? "\\" : "/";
}

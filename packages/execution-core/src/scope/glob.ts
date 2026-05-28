/**
 * Minimal gitignore-style glob matching, ported from `scope-validation` to keep
 * execution-core free of an external glob dependency. `**` matches across path
 * separators; `*` matches within a single segment.
 */

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegexChar(char ?? "");
    }
  }

  source += "$";
  return new RegExp(source, "u");
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(normalizePath(pattern)).test(normalizePath(path));
}

export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

function escapeRegexChar(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
}

const MAX_SLUG_LENGTH = 48;

export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const truncated = normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return truncated.length > 0 ? truncated : "workspace";
}

export function uniqueSlug(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) {
    return base;
  }

  let suffix = 2;
  // Reserve room for the suffix when the base is already near the limit.
  while (suffix < 1000) {
    const suffixStr = `-${suffix}`;
    const trimmedBase = base.slice(0, Math.max(1, MAX_SLUG_LENGTH - suffixStr.length)).replace(/-+$/g, "");
    const candidate = `${trimmedBase}${suffixStr}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }

  throw new Error(`Unable to derive a unique slug from base "${base}"`);
}

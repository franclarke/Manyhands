import { z } from "zod";

export const NonEmptyStringSchema = z.string().trim().min(1);

export const EntityIdSchema = NonEmptyStringSchema.regex(
  /^[A-Za-z0-9._:-]+$/,
  "ids may contain letters, digits, dots, underscores, colons and hyphens"
);

export type EntityId = z.infer<typeof EntityIdSchema>;

export const IsoTimestampSchema = NonEmptyStringSchema;

export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function intersectValues<T>(left: readonly T[], right: readonly T[]): T[] {
  const rightSet = new Set(right);
  return uniqueValues(left.filter((value) => rightSet.has(value)));
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function pairKey(left: string, right: string): string {
  return left <= right ? `${left}::${right}` : `${right}::${left}`;
}

/** Returns the most useful diagnostic preserved by the external oracle runner. */
export function formatOracleFailure(error) {
  for (const value of [error?.stderr, error?.stdout, error?.message]) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return String(error);
}

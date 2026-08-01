const SHA256_DIGEST = /^[a-f0-9]{64}$/u;

/**
 * Model output occasionally drops the canonical `sha256:` prefix from a
 * repository snapshot reference. Treat that form as equivalent only when it
 * is exactly the digest of the canonical identifier; unrelated identifiers
 * must remain strict mismatches.
 */
export function repositorySnapshotIdsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const leftDigest = withoutSha256Prefix(left);
  const rightDigest = withoutSha256Prefix(right);
  return leftDigest === rightDigest && SHA256_DIGEST.test(leftDigest);
}

export function canonicalRepositorySnapshotId(reference: string, canonical: string): string {
  return repositorySnapshotIdsMatch(reference, canonical) ? canonical : reference;
}

function withoutSha256Prefix(value: string): string {
  return value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

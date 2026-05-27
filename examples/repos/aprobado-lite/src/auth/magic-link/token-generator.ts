import type { MagicLinkToken } from "./token-schema";

export function generateMagicLinkToken(userId: string, now: Date): MagicLinkToken {
  return {
    id: `token-${userId}-${now.getTime()}`,
    userId,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    consumedAt: null
  };
}

import { validateMagicLinkToken } from "../magic-link/callback-validation";
import type { MagicLinkTokenStore } from "../magic-link/token-store";

export type Session = {
  userId: string;
  createdAt: Date;
};

export async function createSessionForMagicLink(
  tokenId: string,
  store: MagicLinkTokenStore,
  now: Date
): Promise<Session | null> {
  const result = await validateMagicLinkToken(tokenId, store, now);

  if (!result.ok) {
    return null;
  }

  return {
    userId: result.token.userId,
    createdAt: now
  };
}

export const createSessionForUser = (userId: string, now: Date): Session => ({
  userId,
  createdAt: now
});

import { buildMagicLinkEmail } from "./email-link";
import { generateMagicLinkToken } from "./token-generator";
import type { MagicLinkTokenStore } from "./token-store";

export async function requestMagicLink(
  email: string,
  store: MagicLinkTokenStore,
  now: Date
): Promise<{ tokenId: string; url: string }> {
  const userId = email.trim().toLowerCase();
  const token = generateMagicLinkToken(userId, now);
  await store.create(token);
  return {
    tokenId: token.id,
    url: buildMagicLinkEmail(token).url
  };
}

import { isMagicLinkTokenExpired, type MagicLinkToken } from "./token-schema";
import type { MagicLinkTokenStore } from "./token-store";

export type MagicLinkValidationResult =
  | { ok: true; token: MagicLinkToken }
  | { ok: false; reason: "missing" | "expired" | "consumed" };

export async function validateMagicLinkToken(
  tokenId: string,
  store: MagicLinkTokenStore,
  now: Date
): Promise<MagicLinkValidationResult> {
  const token = await store.findById(tokenId);

  if (!token) {
    return { ok: false, reason: "missing" };
  }

  if (token.consumedAt) {
    return { ok: false, reason: "consumed" };
  }

  if (isMagicLinkTokenExpired(token, now)) {
    return { ok: false, reason: "expired" };
  }

  const consumed = await store.consume(tokenId);
  return consumed ? { ok: true, token: consumed } : { ok: false, reason: "consumed" };
}

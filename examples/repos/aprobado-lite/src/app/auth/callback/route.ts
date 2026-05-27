import { validateMagicLinkToken } from "../../../auth/magic-link/callback-validation";
import type { MagicLinkTokenStore } from "../../../auth/magic-link/token-store";

export async function handleMagicLinkCallback(
  tokenId: string,
  store: MagicLinkTokenStore,
  now: Date
): Promise<{ status: "success" | "error" }> {
  const result = await validateMagicLinkToken(tokenId, store, now);
  return {
    status: result.ok ? "success" : "error"
  };
}

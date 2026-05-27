import { requestMagicLink } from "../../../../auth/magic-link/request-action";
import type { MagicLinkTokenStore } from "../../../../auth/magic-link/token-store";

export async function handleMagicLinkRequest(
  email: string,
  store: MagicLinkTokenStore,
  now: Date
): Promise<{ tokenId: string; url: string }> {
  return requestMagicLink(email, store, now);
}

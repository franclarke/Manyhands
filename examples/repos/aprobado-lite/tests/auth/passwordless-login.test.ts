import { requestMagicLink } from "../../src/auth/magic-link/request-action";
import { validateMagicLinkToken } from "../../src/auth/magic-link/callback-validation";
import { createSessionForMagicLink } from "../../src/auth/session/passwordless-session";
import { InMemoryMagicLinkTokenStore } from "../../src/auth/magic-link/token-store";

export async function passwordlessLoginFixture(): Promise<boolean> {
  const store = new InMemoryMagicLinkTokenStore();
  const issued = await requestMagicLink("person@example.com", store, new Date("2026-01-01T00:00:00.000Z"));
  const validation = await validateMagicLinkToken(issued.tokenId, store, new Date("2026-01-01T00:01:00.000Z"));
  const session = await createSessionForMagicLink(issued.tokenId, store, new Date("2026-01-01T00:02:00.000Z"));

  return validation.ok && session === null;
}

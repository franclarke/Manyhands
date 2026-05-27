import type { MagicLinkToken } from "./token-schema";

export function buildMagicLinkEmail(token: MagicLinkToken): { subject: string; url: string } {
  return {
    subject: "Your magic login link",
    url: `/auth/callback?token=${encodeURIComponent(token.id)}`
  };
}

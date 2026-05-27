export type MagicLinkToken = {
  id: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export function isMagicLinkTokenExpired(token: MagicLinkToken, now: Date): boolean {
  return token.expiresAt.getTime() <= now.getTime();
}

import type { MagicLinkToken } from "./token-schema";

export interface MagicLinkTokenStore {
  create(token: MagicLinkToken): Promise<void>;
  findById(tokenId: string): Promise<MagicLinkToken | null>;
  consume(tokenId: string): Promise<MagicLinkToken | null>;
}

export class InMemoryMagicLinkTokenStore implements MagicLinkTokenStore {
  private readonly tokens = new Map<string, MagicLinkToken>();

  async create(token: MagicLinkToken): Promise<void> {
    this.tokens.set(token.id, token);
  }

  async findById(tokenId: string): Promise<MagicLinkToken | null> {
    return this.tokens.get(tokenId) ?? null;
  }

  async consume(tokenId: string): Promise<MagicLinkToken | null> {
    const token = this.tokens.get(tokenId);

    if (!token || token.consumedAt) {
      return null;
    }

    const consumed = {
      ...token,
      consumedAt: new Date()
    };
    this.tokens.set(tokenId, consumed);
    return consumed;
  }
}

export type { MagicLinkToken };

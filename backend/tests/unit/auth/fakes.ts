import {
  EmailTakenError,
  type Account,
  type AccountProfile,
  type AccountRepository,
  type IdentityProvider,
  type NewAccount,
  type NewPasswordAccount,
  type Provider,
} from '../../../src/modules/auth/auth.service';
import type { ConsentRecord } from '../../../src/modules/auth/consents';

export class FakeAccountRepository implements AccountRepository {
  accounts: Account[] = [];
  identities: { provider: IdentityProvider; providerUserId: string; userId: string }[] = [];
  passwords: { userId: string; email: string; passwordHash: string }[] = [];
  onboardedAt = new Map<string, Date>();
  codes = new Map<string, { userId: string; expiresAt: Date }>();
  deletedReaders: string[] = [];
  consents: (ConsentRecord & { userId: string; agreedAt: Date })[] = [];

  async findByIdentity(provider: Provider, providerUserId: string): Promise<Account | null> {
    const identity = this.identities.find(
      (i) => i.provider === provider && i.providerUserId === providerUserId
    );
    return identity ? this.requireAccount(identity.userId) : null;
  }

  async findByUserId(userId: string): Promise<Account | null> {
    return this.accounts.find((a) => a.user_id === userId) ?? null;
  }

  async readerIdExists(readerId: string): Promise<boolean> {
    return this.accounts.some((a) => a.reader_id === readerId);
  }

  async createAccount(input: NewAccount): Promise<Account> {
    if (await this.readerIdExists(input.readerId)) throw new Error('unique violation: reader_id');
    const account: Account = {
      user_id: input.userId,
      reader_id: input.readerId,
      display_name: input.displayName,
    };
    this.accounts.push(account);
    this.identities.push({
      provider: input.provider,
      providerUserId: input.providerUserId,
      userId: input.userId,
    });
    return account;
  }

  async findPasswordByEmail(
    email: string
  ): Promise<{ user_id: string; password_hash: string } | null> {
    const row = this.passwords.find((p) => p.email === email);
    return row ? { user_id: row.userId, password_hash: row.passwordHash } : null;
  }

  async createPasswordAccount(input: NewPasswordAccount): Promise<Account> {
    if (this.passwords.some((p) => p.email === input.email)) throw new EmailTakenError();
    if (await this.readerIdExists(input.readerId)) throw new Error('unique violation: reader_id');
    const account: Account = {
      user_id: input.userId,
      reader_id: input.readerId,
      display_name: input.displayName,
    };
    this.accounts.push(account);
    this.identities.push({ provider: 'email', providerUserId: input.email, userId: input.userId });
    this.passwords.push({
      userId: input.userId,
      email: input.email,
      passwordHash: input.passwordHash,
    });
    await this.saveConsents(input.userId, input.consents, input.consentedAt);
    return account;
  }

  async getProfile(userId: string): Promise<AccountProfile> {
    return {
      email: this.passwords.find((p) => p.userId === userId)?.email ?? null,
      onboarded: this.onboardedAt.has(userId),
    };
  }

  async listConsents(userId: string): Promise<ConsentRecord[]> {
    return this.consents
      .filter((c) => c.userId === userId)
      .map(({ kind, version, agreed }) => ({ kind, version, agreed }));
  }

  async saveConsents(userId: string, records: ConsentRecord[], at: Date): Promise<void> {
    for (const record of records) {
      const existing = this.consents.find(
        (c) => c.userId === userId && c.kind === record.kind && c.version === record.version
      );
      if (existing) Object.assign(existing, { agreed: record.agreed, agreedAt: at });
      else this.consents.push({ ...record, userId, agreedAt: at });
    }
  }

  async markOnboarded(userId: string, at: Date): Promise<void> {
    if (!this.onboardedAt.has(userId)) this.onboardedAt.set(userId, at);
  }

  async listProviders(userId: string): Promise<IdentityProvider[]> {
    return this.identities.filter((i) => i.userId === userId).map((i) => i.provider);
  }

  async saveLoginCode(code: string, userId: string, expiresAt: Date): Promise<void> {
    this.codes.set(code, { userId, expiresAt });
  }

  async consumeLoginCode(code: string, now: Date): Promise<string | null> {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    return entry && entry.expiresAt > now ? entry.userId : null;
  }

  async deleteAccount(userId: string, readerId: string): Promise<void> {
    this.accounts = this.accounts.filter((a) => a.user_id !== userId);
    this.identities = this.identities.filter((i) => i.userId !== userId);
    this.passwords = this.passwords.filter((p) => p.userId !== userId);
    this.consents = this.consents.filter((c) => c.userId !== userId);
    this.deletedReaders.push(readerId);
  }

  private requireAccount(userId: string): Account {
    return this.accounts.find((a) => a.user_id === userId) as Account;
  }
}

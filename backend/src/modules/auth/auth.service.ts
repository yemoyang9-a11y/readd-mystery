import { randomBytes, randomUUID } from 'crypto';
import type { LoginInput, SignupInput } from './credentials';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password-hash';
import { signSessionToken } from './session-token';

const LOGIN_CODE_LIFETIME_MS = 60_000;

export type Provider = 'google' | 'kakao';
/** user_identities.provider — OAuth 제공자와 이메일(2026-11-18) */
export type IdentityProvider = Provider | 'email';

export interface OAuthProfile {
  providerUserId: string;
  displayName: string | null;
}

export interface Account {
  user_id: string;
  reader_id: string;
  display_name: string | null;
}

export interface NewAccount {
  userId: string;
  readerId: string;
  displayName: string | null;
  provider: Provider;
  providerUserId: string;
}

export interface NewPasswordAccount {
  userId: string;
  readerId: string;
  displayName: string;
  /** 소문자로 정규화한 이메일 */
  email: string;
  passwordHash: string;
}

export interface AccountProfile {
  email: string | null;
  onboarded: boolean;
}

export interface SessionResponse {
  token: string;
  display_name: string | null;
}

/** 이미 가입된 이메일 — 라우터가 409 EMAIL_TAKEN으로 바꾼다 */
export class EmailTakenError extends Error {
  constructor() {
    super('email already registered');
    this.name = 'EmailTakenError';
  }
}

export interface AccountRepository {
  findByIdentity(provider: Provider, providerUserId: string): Promise<Account | null>;
  findByUserId(userId: string): Promise<Account | null>;
  readerIdExists(readerId: string): Promise<boolean>;
  createAccount(input: NewAccount): Promise<Account>;
  listProviders(userId: string): Promise<IdentityProvider[]>;
  findPasswordByEmail(email: string): Promise<{ user_id: string; password_hash: string } | null>;
  /** 같은 이메일이 이미 있으면 EmailTakenError */
  createPasswordAccount(input: NewPasswordAccount): Promise<Account>;
  getProfile(userId: string): Promise<AccountProfile>;
  /** onboarded_at이 비어 있을 때만 채운다 */
  markOnboarded(userId: string, at: Date): Promise<void>;
  saveLoginCode(code: string, userId: string, expiresAt: Date): Promise<void>;
  consumeLoginCode(code: string, now: Date): Promise<string | null>;
  deleteAccount(userId: string, readerId: string): Promise<void>;
}

export class AuthService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async completeLogin(
    provider: Provider,
    profile: OAuthProfile,
    deviceId: string
  ): Promise<Account> {
    const existing = await this.accounts.findByIdentity(provider, profile.providerUserId);
    if (existing) return existing;

    return this.accounts.createAccount({
      userId: randomUUID(),
      readerId: await this.adoptReaderId(deviceId),
      displayName: profile.displayName,
      provider,
      providerUserId: profile.providerUserId,
    });
  }

  /**
   * 로그인 전 기기 id를 독자 id로 넘겨받아 그 기기의 독서 기록을 이어 쓴다.
   * 기기 id가 없거나 이미 다른 계정의 독자 id면 새 id를 만든다.
   */
  private async adoptReaderId(deviceId: string | null): Promise<string> {
    if (!deviceId || (await this.accounts.readerIdExists(deviceId))) return randomUUID();
    return deviceId;
  }

  // 2026-11-18 대표 지시 — 이메일 회원가입
  async signupWithPassword(
    input: SignupInput,
    deviceId: string | null
  ): Promise<SessionResponse & { is_new: true }> {
    if (await this.accounts.findPasswordByEmail(input.email)) throw new EmailTakenError();
    const account = await this.accounts.createPasswordAccount({
      userId: randomUUID(),
      readerId: await this.adoptReaderId(deviceId),
      displayName: input.displayName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });
    const token = await signSessionToken({ userId: account.user_id, readerId: account.reader_id });
    return { token, display_name: account.display_name, is_new: true };
  }

  /** 없는 이메일과 틀린 비밀번호를 구분하지 않고 null */
  async loginWithPassword(input: LoginInput): Promise<SessionResponse | null> {
    const stored = await this.accounts.findPasswordByEmail(input.email);
    if (!stored) {
      await burnPasswordCheck(input.password);
      return null;
    }
    if (!(await verifyPassword(input.password, stored.password_hash))) return null;

    const account = await this.accounts.findByUserId(stored.user_id);
    if (!account) return null;
    const token = await signSessionToken({ userId: account.user_id, readerId: account.reader_id });
    return { token, display_name: account.display_name };
  }

  markOnboarded(userId: string): Promise<void> {
    return this.accounts.markOnboarded(userId, this.now());
  }

  async issueLoginCode(userId: string): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + LOGIN_CODE_LIFETIME_MS);
    await this.accounts.saveLoginCode(code, userId, expiresAt);
    return code;
  }

  async redeemLoginCode(
    code: string
  ): Promise<{ token: string; display_name: string | null } | null> {
    const userId = await this.accounts.consumeLoginCode(code, this.now());
    if (!userId) return null;

    const account = await this.accounts.findByUserId(userId);
    if (!account) return null;

    const token = await signSessionToken({ userId, readerId: account.reader_id });
    return { token, display_name: account.display_name };
  }

  async getMe(userId: string): Promise<{
    display_name: string | null;
    providers: IdentityProvider[];
    email: string | null;
    onboarded: boolean;
  } | null> {
    const account = await this.accounts.findByUserId(userId);
    if (!account) return null;
    const profile = await this.accounts.getProfile(userId);
    return {
      display_name: account.display_name,
      providers: await this.accounts.listProviders(userId),
      email: profile.email,
      onboarded: profile.onboarded,
    };
  }

  withdraw(userId: string, readerId: string): Promise<void> {
    return this.accounts.deleteAccount(userId, readerId);
  }
}

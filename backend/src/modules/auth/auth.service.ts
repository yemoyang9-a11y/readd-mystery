import { randomBytes, randomUUID } from 'crypto';
import {
  consentRequired,
  isConsentComplete,
  marketingAgreed,
  toConsentRecords,
  type ConsentChoice,
  type ConsentRecord,
} from './consents';
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
  /** 대표 지시 2026-11-18 — 가입 약관 동의. 계정과 같은 트랜잭션에서 저장한다 */
  consents: ConsentRecord[];
  consentedAt: Date;
}

export interface AccountProfile {
  email: string | null;
  onboarded: boolean;
}

export interface SessionResponse {
  token: string;
  display_name: string | null;
}

/** 필수 약관 동의 없이 가입·동의 저장을 부름 — 라우터가 먼저 400 으로 거른다 */
export class ConsentMissingError extends Error {
  constructor() {
    super('required consents missing');
    this.name = 'ConsentMissingError';
  }
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
  listConsents(userId: string): Promise<ConsentRecord[]>;
  /** 같은 종류·버전이 있으면 동의 여부와 시각을 바꾼다 */
  saveConsents(userId: string, records: ConsentRecord[], at: Date): Promise<void>;
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
    deviceId: string | null,
    consents: ConsentChoice
  ): Promise<SessionResponse & { is_new: true }> {
    if (!isConsentComplete(consents)) throw new ConsentMissingError();
    if (await this.accounts.findPasswordByEmail(input.email)) throw new EmailTakenError();
    const account = await this.accounts.createPasswordAccount({
      userId: randomUUID(),
      readerId: await this.adoptReaderId(deviceId),
      displayName: input.displayName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      consents: toConsentRecords(consents),
      consentedAt: this.now(),
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

  /** 카카오·구글 첫 로그인, 이 변경 전 가입 계정이 동의 화면에서 보낸다 (대표 지시 2026-11-18) */
  async agreeConsents(userId: string, consents: ConsentChoice): Promise<void> {
    if (!isConsentComplete(consents)) throw new ConsentMissingError();
    await this.accounts.saveConsents(userId, toConsentRecords(consents), this.now());
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
    consent_required: boolean;
    marketing: boolean;
  } | null> {
    const account = await this.accounts.findByUserId(userId);
    if (!account) return null;
    const profile = await this.accounts.getProfile(userId);
    const consents = await this.accounts.listConsents(userId);
    return {
      display_name: account.display_name,
      providers: await this.accounts.listProviders(userId),
      email: profile.email,
      onboarded: profile.onboarded,
      consent_required: consentRequired(consents),
      marketing: marketingAgreed(consents),
    };
  }

  withdraw(userId: string, readerId: string): Promise<void> {
    return this.accounts.deleteAccount(userId, readerId);
  }
}

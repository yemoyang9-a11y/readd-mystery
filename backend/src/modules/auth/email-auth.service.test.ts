import { FakeAccountRepository } from '../../../tests/unit/auth/fakes';
import { AuthService, EmailTakenError } from './auth.service';
import { parseLogin, parseSignup } from './credentials';
import { hashPassword, verifyPassword } from './password-hash';
import { createRateLimiter } from './rate-limit';
import { verifySessionToken } from './session-token';

const DEVICE_A = '11111111-1111-4111-8111-111111111111';
const SIGNUP = { email: 'reader@example.com', password: 'secret-pass', displayName: '독자' };

describe('이메일 회원가입·로그인 — 2026-11-18 대표 지시', () => {
  let accounts: FakeAccountRepository;
  let clock: Date;
  let service: AuthService;

  beforeEach(() => {
    process.env.AUTH_TOKEN_SECRET = 'test-only-signing-value-aaaaaaaaaaaa';
    accounts = new FakeAccountRepository();
    clock = new Date('2026-11-18T00:00:00.000Z');
    service = new AuthService(accounts, () => clock);
  });

  afterAll(() => {
    delete process.env.AUTH_TOKEN_SECRET;
  });

  test('회원가입한 계정의 reader_id는 로그인 전 기기 id다', async () => {
    const session = await service.signupWithPassword(SIGNUP, DEVICE_A);
    expect(session.is_new).toBe(true);
    expect(session.display_name).toBe('독자');
    await expect(verifySessionToken(session.token)).resolves.toMatchObject({ readerId: DEVICE_A });
  });

  test('이미 다른 계정의 reader_id인 기기로 가입하면 새 reader_id를 받는다', async () => {
    await service.signupWithPassword(SIGNUP, DEVICE_A);
    const second = await service.signupWithPassword(
      { ...SIGNUP, email: 'other@example.com' },
      DEVICE_A
    );
    const claims = await verifySessionToken(second.token);
    expect(claims?.readerId).not.toBe(DEVICE_A);
  });

  test('기기 id가 없으면 새 reader_id로 가입한다', async () => {
    const session = await service.signupWithPassword(SIGNUP, null);
    const claims = await verifySessionToken(session.token);
    expect(claims?.readerId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('같은 이메일로 다시 가입하면 EmailTakenError', async () => {
    await service.signupWithPassword(SIGNUP, DEVICE_A);
    await expect(service.signupWithPassword(SIGNUP, null)).rejects.toBeInstanceOf(EmailTakenError);
  });

  test('비밀번호는 평문으로 저장하지 않는다', async () => {
    await service.signupWithPassword(SIGNUP, DEVICE_A);
    expect(accounts.passwords[0].passwordHash).not.toContain(SIGNUP.password);
    expect(accounts.passwords[0].passwordHash.startsWith('scrypt$')).toBe(true);
  });

  test('맞는 비밀번호로 로그인하면 가입 때와 같은 reader_id 토큰을 준다', async () => {
    await service.signupWithPassword(SIGNUP, DEVICE_A);
    const session = await service.loginWithPassword({
      email: SIGNUP.email,
      password: SIGNUP.password,
    });
    expect(session?.display_name).toBe('독자');
    await expect(verifySessionToken(session!.token)).resolves.toMatchObject({ readerId: DEVICE_A });
  });

  test('틀린 비밀번호와 없는 이메일은 둘 다 null이다', async () => {
    await service.signupWithPassword(SIGNUP, DEVICE_A);
    await expect(
      service.loginWithPassword({ email: SIGNUP.email, password: 'wrong-pass' })
    ).resolves.toBeNull();
    await expect(
      service.loginWithPassword({ email: 'nobody@example.com', password: SIGNUP.password })
    ).resolves.toBeNull();
  });

  test('getMe는 이메일과 안내 완료 여부를 준다', async () => {
    const session = await service.signupWithPassword(SIGNUP, DEVICE_A);
    const { userId } = (await verifySessionToken(session.token))!;
    await expect(service.getMe(userId)).resolves.toEqual({
      display_name: '독자',
      providers: ['email'],
      email: SIGNUP.email,
      onboarded: false,
    });

    await service.markOnboarded(userId);
    await expect(service.getMe(userId)).resolves.toMatchObject({ onboarded: true });
  });

  test('안내 완료는 처음 표시한 시각을 유지한다', async () => {
    const session = await service.signupWithPassword(SIGNUP, DEVICE_A);
    const { userId } = (await verifySessionToken(session.token))!;
    await service.markOnboarded(userId);
    const first = accounts.onboardedAt.get(userId);
    clock = new Date('2026-11-19T00:00:00.000Z');
    await service.markOnboarded(userId);
    expect(accounts.onboardedAt.get(userId)).toEqual(first);
  });

  test('탈퇴하면 비밀번호 기록도 지운다', async () => {
    const session = await service.signupWithPassword(SIGNUP, DEVICE_A);
    const claims = (await verifySessionToken(session.token))!;
    await service.withdraw(claims.userId, claims.readerId);
    expect(accounts.passwords).toHaveLength(0);
    await expect(
      service.loginWithPassword({ email: SIGNUP.email, password: SIGNUP.password })
    ).resolves.toBeNull();
  });
});

describe('비밀번호 해시', () => {
  test('같은 비밀번호도 매번 다른 소금으로 해시한다', async () => {
    const [a, b] = await Promise.all([hashPassword('password-1'), hashPassword('password-1')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('password-1', a)).resolves.toBe(true);
    await expect(verifyPassword('password-2', a)).resolves.toBe(false);
  });

  test('형식이 깨진 저장값은 false다', async () => {
    await expect(verifyPassword('password-1', 'plain')).resolves.toBe(false);
    await expect(verifyPassword('password-1', 'scrypt$x$8$1$aa$bb')).resolves.toBe(false);
  });
});

describe('입력 검사', () => {
  test('이메일은 앞뒤 공백을 빼고 소문자로 바꾼다', () => {
    expect(
      parseSignup({ email: '  Reader@Example.COM ', password: '12345678', display_name: ' 독자 ' })
    ).toEqual({
      ok: true,
      value: { email: 'reader@example.com', password: '12345678', displayName: '독자' },
    });
  });

  test.each([
    [{ email: 'not-an-email', password: '12345678', display_name: '독자' }],
    [{ email: 'a@b.co', password: '1234567', display_name: '독자' }],
    [{ email: 'a@b.co', password: '12345678', display_name: '   ' }],
    [{ email: 'a@b.co', password: '12345678', display_name: '가'.repeat(21) }],
    [{ email: 'a@b.co', password: 12345678, display_name: '독자' }],
    [null],
  ])('잘못된 회원가입 입력은 거절한다 %#', (body) => {
    expect(parseSignup(body).ok).toBe(false);
  });

  test('닉네임은 20자까지 허용한다', () => {
    expect(
      parseSignup({ email: 'a@b.co', password: '12345678', display_name: '가'.repeat(20) }).ok
    ).toBe(true);
  });

  test('로그인은 이메일과 비밀번호 문자열이 있어야 한다', () => {
    expect(parseLogin({ email: 'A@B.co', password: 'x' })).toEqual({
      ok: true,
      value: { email: 'a@b.co', password: 'x' },
    });
    expect(parseLogin({ email: 'a@b.co' }).ok).toBe(false);
  });
});

describe('시도 횟수 제한', () => {
  test('창 안에서 한도를 넘으면 막고 창이 지나면 다시 허용한다', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect([limiter.hit('ip'), limiter.hit('ip'), limiter.hit('ip')]).toEqual([true, true, false]);
    expect(limiter.hit('other-ip')).toBe(true);
    now = 1000;
    expect(limiter.hit('ip')).toBe(true);
  });
});

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto';

// 2026-11-18 대표 지시 — 이메일 로그인 비밀번호. 새 네이티브 의존성 없이 Node scrypt를 쓴다.
const SCHEME = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };
const MAX_MEMORY = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

/** 저장 형식: scrypt$N$r$p$<salt base64url>$<hash base64url> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = DEFAULT_PARAMS;
  const key = await scrypt(password, salt, { N, r, p });
  return [SCHEME, N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;

  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await scrypt(password, salt, { N, r, p });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/** 없는 이메일에도 같은 계산을 해서 응답 시간으로 가입 여부가 드러나지 않게 한다 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('readd-dummy-password');
  await verifyPassword(password, await dummyHash);
}

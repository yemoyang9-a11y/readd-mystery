import { defaultPassword } from '../admin-auth';

describe('관리자 비밀번호 환경변수 이름 (FR-ADM-006 🚦)', () => {
  const original = process.env;
  const withEnv = (env: Record<string, string>) => {
    Object.defineProperty(process, 'env', { value: env, configurable: true, writable: true });
  };

  afterEach(() => {
    Object.defineProperty(process, 'env', { value: original, configurable: true, writable: true });
  });

  it('ADMIN_PASSWORD 가 있으면 그것을 쓴다', () => {
    withEnv({ ADMIN_PASSWORD: 'first-secret', ADMIN: 'second', admin: 'third' });
    expect(defaultPassword()).toBe('first-secret');
  });

  it('ADMIN_PASSWORD 가 없으면 ADMIN 을 쓴다', () => {
    withEnv({ ADMIN: 'second-secret', admin: 'third' });
    expect(defaultPassword()).toBe('second-secret');
  });

  it('Fly 비밀값이 소문자 admin 으로 들어가 있어도 읽는다', () => {
    withEnv({ admin: 'lowercase-secret' });
    expect(defaultPassword()).toBe('lowercase-secret');
  });

  it('셋 다 없으면 비밀번호가 없다(로그인 막힘)', () => {
    withEnv({});
    expect(defaultPassword()).toBeUndefined();
  });
});

/**
 * public 폴더 파일(표지 등)의 루트 기준 경로에 배포 기준 경로(import.meta.env.BASE_URL)를 붙인다.
 * GitHub Pages 는 https://<계정>.github.io/<저장소>/ 아래에 올라가서, "/covers/x.webp" 를 그대로 쓰면
 * 저장소 이름이 빠진 주소를 찾아 404 가 난다(2026-11-18 공개 저장소·GitHub Pages 배포).
 */
export function withBase(path: string, base: string = import.meta.env.BASE_URL ?? '/'): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return path;
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!prefix || path.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path}`;
}

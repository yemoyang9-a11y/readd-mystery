export interface ShowcaseBook {
  slug: string;
  bookId: string | null;
  title: string;
  author: string;
  meta: string;
  cover: string;
  hook: [string, string, string];
}

export const HOME_SHOWCASE: ShowcaseBook[] = [
  {
    slug: 'gasangbeomin',
    bookId: 'bk-95898cdf13',
    title: '가상범인',
    author: '김내성',
    meta: '1937 · 미스터리 · 68쪽',
    cover: '/covers/gasangbeomin.webp',
    hook: ['경성의 극장, 해왕좌.', '무대 위에서 살인이 재연된다.', '범인으로 지목된 배우도 함께.'],
  },
  {
    slug: 'tawonhyeong',
    bookId: null,
    title: '타원형의 거울',
    author: '김내성',
    meta: '1938',
    cover: '/covers/tawonhyeong.webp',
    hook: ['추리잡지 《괴인》의 현상모집.', '상금은 삼백 원.', '문제는, 실제로 일어난 사건.'],
  },
  {
    slug: 'main',
    bookId: null,
    title: '마인',
    author: '김내성',
    meta: '1939 · 장편',
    cover: '/covers/main.webp',
    hook: ['한강 건너 명수대의 밤.', '세계적 무희의 가장무도회.', '가면 아래, 죄악이 시작된다.'],
  },
];

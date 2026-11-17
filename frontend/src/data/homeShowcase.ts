export interface ShowcaseBook {
  slug: string;
  bookId: string | null;
  title: string;
  author: string;
  meta: string;
  cover: string;
  /** 입체 책의 책등·뒷면 색과 책등 글자 색 */
  spine: string;
  spineText: string;
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
    spine: '#7a1c22',
    spineText: '#f1e4cf',
    hook: ['경성의 극장, 해왕좌.', '무대 위에서 살인이 재연된다.', '범인으로 지목된 배우도 함께.'],
  },
  {
    slug: 'tawonhyeong',
    bookId: null,
    title: '타원형의 거울',
    author: '김내성',
    meta: '1938',
    cover: '/covers/tawonhyeong.webp',
    spine: '#1f3527',
    spineText: '#f3efe6',
    hook: ['추리잡지 《괴인》의 현상모집.', '상금은 삼백 원.', '문제는, 실제로 일어난 사건.'],
  },
  {
    slug: 'main',
    bookId: null,
    title: '마인',
    author: '김내성',
    meta: '1939 · 장편',
    cover: '/covers/main.webp',
    spine: '#1c2333',
    spineText: '#f3efe6',
    hook: ['한강 건너 명수대의 밤.', '세계적 무희의 가장무도회.', '가면 아래, 죄악이 시작된다.'],
  },
];

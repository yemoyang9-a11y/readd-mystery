import type { GraphResponse } from '../../types';

/**
 * 아모 답변의 인물 이름·쪽 표시 — 2026-11-18 대표 승인 시안(인물 강조색, 쪽은 괄호 없는 키캡 ①).
 *
 * - 이름 목록은 서버가 기준점으로 거른 관계도 응답(nodes)만 쓴다. 새 조회·판정 없음 (FR-SPL-002 🚦, 절대 규칙 7).
 * - 쪽은 1 이상의 숫자를 링크로 만든다. 마지막 쪽 비교·기준점 초과 여부는 여기서 하지 않는다(FR-BRF-005 🚦 —
 *   쪽 범위 확인은 이동하는 쪽(useReadingSession 의 jumpToNote) 한 곳에서. 본문은 제한하지 않는다, R3).
 * - 답변 글자는 바꾸지 않는다. 쪽 언급을 감싼 괄호만 화면에서 뺀다 (절대 규칙 11 — 출력 검사는 서버 몫).
 */

export type MentionPart =
  | { kind: 'text'; text: string }
  | { kind: 'name'; text: string }
  | { kind: 'page'; page: number; label: string };

/** 대표명 + 대표명이 들어간 별칭("유불란 씨")만. "부인"·"배우" 같은 일반 명사 별칭은 강조하지 않는다. 긴 것부터 */
export function mentionNames(graph: GraphResponse | null): string[] {
  if (!graph) return [];
  const names = new Set<string>();
  for (const node of graph.nodes) {
    if (node.name.trim().length >= 2) names.add(node.name.trim());
    for (const alias of node.aliases) if (alias.includes(node.name)) names.add(alias.trim());
  }
  return [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "(p.13)" "p. 13" "pp.13-15" "13쪽" — 괄호로 감쌌으면 괄호까지 한 덩어리로 잡는다
const PAGE = String.raw`(\(\s*)?(?:pp?\.\s?(\d{1,4})(?:\s*[-–~]\s*(\d{1,4}))?|(\d{1,4})\s*쪽)(\s*\))?`;

export function splitMentions(text: string, names: string[]): MentionPart[] {
  const nameAlt = names.map(escapeRegExp).join('|');
  const pattern = new RegExp(nameAlt ? `${PAGE}|(${nameAlt})` : PAGE, 'gu');
  const parts: MentionPart[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = parts[parts.length - 1];
    if (prev && prev.kind === 'text') prev.text += value;
    else parts.push({ kind: 'text', text: value });
  };
  for (const match of text.matchAll(pattern)) {
    const [whole, open, from, to, plain, close, name] = match;
    const at = match.index ?? 0;
    if (name) {
      pushText(text.slice(last, at));
      parts.push({ kind: 'name', text: name });
      last = at + whole.length;
      continue;
    }
    const page = Number(from ?? plain);
    if (!Number.isSafeInteger(page) || page < 1) continue;
    // 괄호는 양쪽이 다 있을 때만 뺀다. 한쪽만 잡혔으면 글자로 돌려준다
    const paired = Boolean(open) && Boolean(close);
    const before = text.slice(last, at) + (open && !paired ? open : '');
    pushText(paired && before && !/\s$/u.test(before) ? `${before} ` : before);
    const label = to ? `p.${page}–${to}` : `p.${page}`;
    parts.push({ kind: 'page', page, label });
    if (close && !paired) pushText(close);
    last = at + whole.length;
  }
  pushText(text.slice(last));
  return parts.length > 0 ? parts : [{ kind: 'text', text }];
}

/* ---- react-markdown(rehype) 연결: 글자 마디를 amo-name·amo-page 요소로 나눈다 ---- */

interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const SKIP = new Set(['code', 'pre', 'a']);

export function rehypeAmoMentions(options: { names: string[] }) {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (!('children' in node) || !node.children) return;
      if (node.type === 'element' && SKIP.has((node as HastElement).tagName)) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type !== 'text') {
          walk(child);
          next.push(child);
          continue;
        }
        for (const part of splitMentions((child as HastText).value, options.names)) {
          if (part.kind === 'text') next.push({ type: 'text', value: part.text });
          else if (part.kind === 'name')
            next.push({
              type: 'element',
              tagName: 'amo-name',
              properties: {},
              children: [{ type: 'text', value: part.text }],
            });
          else
            next.push({
              type: 'element',
              tagName: 'amo-page',
              properties: { dataPage: String(part.page) },
              children: [{ type: 'text', value: part.label }],
            });
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}

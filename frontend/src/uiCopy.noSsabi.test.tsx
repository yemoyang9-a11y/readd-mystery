/**
 * 2026-11-19 대표 지시 — 독자·관리자 화면에 보이는 문장에서는 "싸비"를 쓰지 않고 "사이드 탭"이라고 쓴다.
 *
 * 화면 문구는 코드 안의 문자열(따옴표·템플릿)과 JSX 글자에서만 나온다. 그래서 src 아래 화면 코드(테스트 제외)를
 * TypeScript 구문 트리로 읽어 문자열·JSX 글자만 모아 "싸비"가 0건인지 본다.
 * 주석·식별자·파일명은 내부 이름이라 그대로 둔다 — 구문 트리에서 주석과 식별자는 문자열로 잡히지 않는다.
 * (홈 화면 앱 이름 index.html·manifest 는 별도 결정 대상이라 이 시험 범위 밖이다)
 */
// @ts-expect-error 이 프로젝트 tsconfig 에는 node 타입이 없다
import { readFileSync, readdirSync, statSync } from 'node:fs';
import ts from 'typescript';
import { render } from '@testing-library/react';
import SsabiToggleButton from './components/common/SsabiToggleButton';
import { GUIDE_STEPS, type GuideProgress } from './guide/guideSteps';

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const SRC = `${cwd}/src`;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir) as string[]) {
    const path = `${dir}/${name}`;
    if ((statSync(path) as { isDirectory(): boolean }).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** 파일 하나에서 화면에 나갈 수 있는 글자(문자열·템플릿 조각·JSX 글자)만 모은다 */
function visibleTexts(path: string): string[] {
  const text: string = readFileSync(path, 'utf-8');
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('2026-11-19 대표 지시: 화면 문구에 "싸비" 대신 "사이드 탭"', () => {
  test('화면 코드의 문자열·JSX 글자에 "싸비"가 0건이다', () => {
    const files = sourceFiles(SRC);
    // positive — 실제로 화면 코드를 읽었는지(빈 목록이면 항상 통과하므로) 확인한다
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((path) =>
      visibleTexts(path)
        .filter((t) => t.includes('싸비'))
        .map((t) => `${path.slice(SRC.length + 1)}: ${t.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  test('같은 방식으로 "사이드 탭" 문구는 잡힌다 (검사가 문자열을 실제로 읽는지)', () => {
    const texts = visibleTexts(`${SRC}/components/common/SsabiToggleButton.tsx`);
    expect(texts.some((t) => t.includes('사이드 탭'))).toBe(true);
  });

  test('여닫기 버튼 이름과 가이드 문구가 "사이드 탭"으로 렌더된다', () => {
    const { container, rerender } = render(<SsabiToggleButton open={false} onToggle={() => {}} />);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('사이드 탭 열기');
    rerender(<SsabiToggleButton open onToggle={() => {}} />);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('사이드 탭 닫기');
    expect(container.textContent ?? '').not.toContain('싸비');

    const stepTexts = GUIDE_STEPS.map((s) =>
      typeof s.text === 'function' ? s.text({ page: 1 } as GuideProgress) : s.text,
    );
    expect(stepTexts.some((t) => t.includes('사이드 탭'))).toBe(true);
    expect(stepTexts.filter((t) => t.includes('싸비'))).toEqual([]);
  });
});

// @ts-expect-error 이 프로젝트 tsconfig 에는 node 타입이 없다
import { readFileSync } from 'node:fs';

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const css: string = readFileSync(`${cwd}/src/assets/styles/index.css`, 'utf-8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('}', start));
}

function toHex(channels: string): string {
  return `#${channels
    .trim()
    .split(/\s+/)
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function colorVars(selector: ':root' | '[data-night]' | '[data-mobile]'): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [, name, value] of block(selector).matchAll(/--([\w-]+):\s*([\d\s]+);/g)) {
    vars[name] = toHex(value);
  }
  return vars;
}

import type { ReactNode } from 'react';
import type { GraphNode, GraphResponse } from '../../types';
import {
  EGO_CANVAS,
  EGO_CENTER,
  egoCandidates,
  egoPositions,
  egoView,
  type EgoRelation,
} from './graphEgo';
import { withParticle } from './RelationDetails';

const initialOf = (name: string) => Array.from(name.trim())[0] ?? '';

function objectOf(name: string): string {
  const last = name.charCodeAt(name.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${name}${hasFinal ? '을' : '를'}`;
}

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

const CHIP_BASE =
  'inline-flex h-[26px] shrink-0 items-center rounded-[7px] px-[9px] font-dashSans text-xs font-semibold text-brief-accent';
const CHIP_FILLED = `${CHIP_BASE} bg-brief-accent-soft`;
const CHIP_DASHED = `${CHIP_BASE} border border-dashed border-brief-accent/55`;

function RelationChip({
  filled,
  label,
  small = false,
}: {
  filled: boolean;
  label: string;
  small?: boolean;
}) {
  return (
    <span
      data-relation-chip={filled ? 'fact' : 'claim'}
      className={`${filled ? CHIP_FILLED : CHIP_DASHED} ${small ? '!h-[22px] !px-2 !text-[11px]' : ''}`}
    >
      {label}
    </span>
  );
}

export function CenterChips({
  graph,
  centerId,
  all,
  onPick,
  onAll,
}: {
  graph: GraphResponse;
  centerId: string | null;
  all: boolean;
  onPick: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <div>
      <h3 className="m-0 mb-2.5 font-dashSans text-base font-bold text-brief-ink">
        누구를 중심으로 볼까요
      </h3>
      <div
        role="group"
        aria-label="중심 인물"
        className="-mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1 py-1"
      >
        {egoCandidates(graph).map((node) => {
          const on = !all && node.id === centerId;
          return (
            <button
              key={node.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(node.id)}
              className={`relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border bg-brief-card py-0 pl-1 pr-3 font-dashSans text-[13px] font-semibold before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent ${
                on ? 'border-brief-accent text-brief-accent' : 'border-brief-rule text-brief-ink'
              }`}
            >
              <i
                aria-hidden="true"
                className={`grid h-8 w-8 place-items-center rounded-full text-[13px] not-italic ${
                  on
                    ? 'bg-brief-accent text-brief-on-accent'
                    : 'bg-brief-accent-soft text-brief-ink'
                }`}
              >
                {initialOf(node.name)}
              </i>
              {node.name}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={all}
          onClick={onAll}
          className={`relative inline-flex h-10 shrink-0 items-center rounded-full border bg-brief-card px-3.5 font-dashSans text-[13px] font-semibold before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent ${
            all ? 'border-brief-accent text-brief-accent' : 'border-brief-rule text-brief-ink'
          }`}
        >
          모두
        </button>
      </div>
    </div>
  );
}

function PageKeycap({ page, onJump }: { page: number; onJump?: (page: number) => void }) {
  const className =
    'relative ml-auto inline-flex h-6 shrink-0 items-center rounded-full bg-brief-accent-soft px-2 font-mono text-xs text-brief-ink';
  if (!onJump) return <span className={className}>p.{page}</span>;
  return (
    <button
      type="button"
      aria-label={`p.${page} 쪽으로 이동`}
      onClick={() => onJump(page)}
      className={`${className} before:absolute before:-inset-2.5 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent`}
    >
      p.{page}
    </button>
  );
}

function RelationItem({
  relation,
  onJump,
}: {
  relation: EgoRelation;
  onJump?: (page: number) => void;
}) {
  return (
    <div className="grid gap-1.5 pt-2.5 [&+&]:mt-2.5 [&+&]:border-t [&+&]:border-brief-rule">
      <div className="flex items-center gap-1.5 font-dashSans text-xs font-semibold text-brief-ink">
        <RelationChip filled={relation.filled} label={relation.label} small />
        {relation.source}
        {relation.page !== null ? <PageKeycap page={relation.page} onJump={onJump} /> : null}
      </div>
      {relation.evidence ? (
        <div className="grid grid-cols-[2.5rem_1fr] items-baseline gap-2">
          <span className="font-dashSans text-xs font-bold text-brief-accent">원문</span>
          <q
            style={{ quotes: '"“" "”"' }}
            className="line-clamp-2 font-dashSans text-sm leading-relaxed text-brief-ink [word-break:keep-all]"
          >
            {relation.evidence}
          </q>
        </div>
      ) : null}
      {relation.explanation ? (
        <div className="grid grid-cols-[2.5rem_1fr] items-baseline gap-2">
          <span className="font-dashSans text-xs font-bold text-brief-accent">설명</span>
          <p
            data-relation-explanation
            className="font-dashSans text-sm leading-relaxed text-brief-ink [word-break:keep-all]"
          >
            {relation.explanation}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function uniqueChips(relations: EgoRelation[]): EgoRelation[] {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const key = `${relation.filled}:${relation.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function RelationshipEgoView({
  graph,
  centerId,
  scrubber,
  onPickCenter,
  onJump,
}: {
  graph: GraphResponse;
  centerId: string;
  scrubber?: ReactNode;
  onPickCenter: (id: string) => void;
  onJump?: (page: number) => void;
}) {
  const ego = egoView(graph, centerId);
  if (!ego) return null;
  const { center, neighbors, others } = ego;
  const positions = egoPositions(neighbors.length);
  const { width, height } = EGO_CANVAS;

  const summary = neighbors.map((n) => `${withParticle(n.node.name)}는 ${n.lineLabel}`).join(', ');
  const describe = `${objectOf(center.name)} 중심으로 직접 이어진 ${neighbors.length}명${summary ? `. ${summary}` : ''}`;

  return (
    <div className="font-dashSans text-brief-ink">
      <div
        role="img"
        aria-label={describe}
        className="relative h-[300px] overflow-hidden rounded-2xl border border-brief-rule bg-brief-card"
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {neighbors.map((n, i) => (
            <line
              key={n.node.id}
              x1={EGO_CENTER.x}
              y1={EGO_CENTER.y}
              x2={positions[i].x}
              y2={positions[i].y}
              strokeWidth="2"
              strokeDasharray={n.lineFilled ? undefined : '6 5'}
              vectorEffect="non-scaling-stroke"
              className="stroke-brief-accent"
            />
          ))}
        </svg>
        {neighbors.map((n, i) => (
          <div
            key={n.node.id}
            aria-hidden="true"
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[3px] text-xs text-brief-muted"
            style={{ left: pct(positions[i].x, width), top: pct(positions[i].y, height) }}
          >
            <span className="grid h-[46px] w-[46px] place-items-center rounded-[14px] border-[1.5px] border-brief-rule bg-brief-card text-[17px] font-bold text-brief-ink">
              {initialOf(n.node.name)}
            </span>
            {n.node.name}
          </div>
        ))}
        <div
          aria-hidden="true"
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[3px] text-xs text-brief-muted"
          style={{ left: pct(EGO_CENTER.x, width), top: pct(EGO_CENTER.y, height) }}
        >
          <span className="grid h-16 w-16 place-items-center rounded-[14px] border-[1.5px] border-brief-accent bg-brief-accent-soft text-2xl font-bold text-brief-accent">
            {initialOf(center.name)}
          </span>
          {center.name}
        </div>
        {neighbors.map((n, i) => (
          <div
            key={n.node.id}
            aria-hidden="true"
            data-edge-label
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-brief-card px-2 py-0.5 text-[11px] font-semibold text-brief-accent ${
              n.lineFilled ? 'border-brief-accent/40' : 'border-dashed border-brief-accent/55'
            }`}
            style={{
              left: pct(EGO_CENTER.x + (positions[i].x - EGO_CENTER.x) * 0.55, width),
              top: pct(EGO_CENTER.y + (positions[i].y - EGO_CENTER.y) * 0.55, height),
            }}
          >
            {n.lineLabel}
          </div>
        ))}
      </div>
      {scrubber}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <RelationChip filled label="사실" small />
          본문에 쓰인 관계
        </span>
        <span className="inline-flex items-center gap-1.5">
          <RelationChip filled={false} label="말·생각" small />
          인물이 말하거나 짐작한 관계
        </span>
      </div>
      <div className="mt-3.5 grid gap-1.5">
        {neighbors.map((n) => (
          <details
            key={n.node.id}
            className="group rounded-xl border border-brief-rule bg-brief-card open:border-brief-accent/35"
          >
            <summary data-character-id={n.node.id} className="grid min-h-12 cursor-pointer list-none grid-cols-[58px_1fr_20px] items-center gap-2.5 rounded-xl px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent [&::-webkit-details-marker]:hidden">
              <b className="text-sm">{n.node.name}</b>
              <div className="flex flex-wrap gap-[5px]">
                {uniqueChips(n.relations).map((relation) => (
                  <RelationChip
                    key={`${relation.filled}:${relation.label}`}
                    filled={relation.filled}
                    label={relation.label}
                  />
                ))}
              </div>
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="justify-self-end stroke-brief-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              >
                <path d="M3 5l4 4 4-4" />
              </svg>
            </summary>
            <div className="mx-3 border-t border-brief-rule pb-3">
              {n.relations.map((relation) => (
                <RelationItem
                  key={relation.edge.id ?? relation.label}
                  relation={relation}
                  onJump={onJump}
                />
              ))}
            </div>
          </details>
        ))}
      </div>
      {others.length > 0 ? (
        <p className="m-0 mt-3 flex flex-wrap items-center gap-x-1 text-xs leading-relaxed text-brief-muted">
          <span>{withParticle(center.name)} 직접 이어지지 않은 인물:</span>
          {others.map((node: GraphNode, index) => (
            <span key={node.id} className="inline-flex items-center">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <button
                type="button"
                onClick={() => onPickCenter(node.id)}
                className="inline-flex min-h-11 items-center px-1.5 font-bold text-brief-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brief-accent"
              >
                {node.name}
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

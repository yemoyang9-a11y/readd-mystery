import { useId } from 'react';

export type AmoExpression = 'default' | 'think';

const STROKE = '#4a2f1c';

// FR-QNA-004 🚦
export default function AmoSherlock({
  expression = 'default',
  className,
}: {
  expression?: AmoExpression;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const plaid = `${uid}-plaid`;
  const clip = `${uid}-clip`;
  const body = 'M34 78Q34 66 46 66H114Q126 66 126 78V172L80 150L34 172Z';
  const hat = 'M26 70Q26 30 80 28Q134 30 134 70Z';
  const thinking = expression === 'think';

  return (
    <svg viewBox="0 0 160 200" aria-hidden="true" focusable="false" data-amo={expression} className={className}>
      <defs>
        <pattern id={plaid} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#b58a5c" />
          <rect width="12" height="2.2" fill="#8c6239" opacity="0.55" />
          <rect width="2.2" height="12" fill="#8c6239" opacity="0.55" />
          <rect y="6" width="12" height="1" fill="#f3dcc0" opacity="0.55" />
          <rect x="6" width="1" height="12" fill="#f3dcc0" opacity="0.55" />
        </pattern>
        <clipPath id={clip}>
          <path d={body} />
        </clipPath>
      </defs>
      <ellipse cx="30" cy="148" rx="7.5" ry="10.5" transform="rotate(20 30 148)" fill="#f9dcbc" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="130" cy="148" rx="7.5" ry="10.5" transform="rotate(-20 130 148)" fill="#f9dcbc" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
      <path d={body} fill="#f9dcbc" />
      <rect x="0" y="150" width="160" height="50" fill="#efc08e" clipPath={`url(#${clip})`} />
      <path d={body} fill="none" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
      <g transform={thinking ? 'translate(3,-3)' : undefined}>
        <circle cx="60" cy="104" r="8.5" fill="#2a1a12" />
        <circle cx="100" cy="104" r="8.5" fill="#2a1a12" />
        <circle cx="57.2" cy="100.8" r="2.8" fill="#fff" />
        <circle cx="97.2" cy="100.8" r="2.8" fill="#fff" />
        <circle cx="62.6" cy="107.6" r="1.3" fill="#fff" />
        <circle cx="102.6" cy="107.6" r="1.3" fill="#fff" />
      </g>
      <ellipse cx="46" cy="122" rx="8" ry="5" fill="#f2a38e" opacity="0.85" />
      <ellipse cx="114" cy="122" rx="8" ry="5" fill="#f2a38e" opacity="0.85" />
      {thinking ? (
        <circle cx="80" cy="123" r="3.2" fill="none" stroke={STROKE} strokeWidth="3" />
      ) : (
        <path d="M71 120Q80 129 89 120" fill="none" stroke={STROKE} strokeWidth="3.2" strokeLinecap="round" />
      )}
      <g transform="rotate(-5 80 72)">
        <path d="M54 72Q80 94 106 72Z" fill="#5a3d26" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
        <path d={hat} fill="#b58a5c" />
        <path d={hat} fill={`url(#${plaid})`} />
        <path d={hat} fill="none" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
        <path d="M28 72C22 56 26 40 38 36C46 34 50 44 50 54L50 72Z" fill="#a77d50" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
        <path d="M132 72C138 56 134 40 122 36C114 34 110 44 110 54L110 72Z" fill="#a77d50" stroke={STROKE} strokeWidth="3" strokeLinejoin="round" />
        <rect x="25" y="63" width="110" height="11" rx="5.5" fill="#7a5230" stroke={STROKE} strokeWidth="3" />
        <ellipse cx="68" cy="24" rx="8.5" ry="4.8" transform="rotate(-22 68 24)" fill="#7a5230" stroke={STROKE} strokeWidth="2.6" />
        <ellipse cx="92" cy="24" rx="8.5" ry="4.8" transform="rotate(22 92 24)" fill="#7a5230" stroke={STROKE} strokeWidth="2.6" />
        <circle cx="80" cy="26.5" r="4.4" fill="#5a3d26" stroke={STROKE} strokeWidth="2.6" />
      </g>
    </svg>
  );
}

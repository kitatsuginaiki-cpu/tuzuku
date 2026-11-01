import { useId } from 'react';
import { CHARACTER_NAME, LEVELS, MOOD_LABEL, type CharaAccessory, type CharaColor, type Mood } from '../lib/character';

/**
 * 「つづきぼし」：続ける力をあらわす小さな彗星（本人のデザイン案 A を SVG で再構成）。
 * - 成長（Lv.1〜5）：尾が伸び、Lv.2 で軌道の輪、Lv.3 で輪の星、Lv.4 できらめき、Lv.5 で光の輪。
 * - 表情は目・眉・口・小物の形で区別し、色だけに頼らない。
 */
const PALETTE: Record<CharaColor, { hair: string; tail: string; ring: string; star: string }> = {
  standard: { hair: '#2b4466', tail: '#8db66a', ring: '#5b8f4a', star: '#e7b93f' },
  blue: { hair: '#24508f', tail: '#7fb3e6', ring: '#3a74c0', star: '#e7b93f' },
  orange: { hair: '#b8502a', tail: '#f0ac4f', ring: '#d0752c', star: '#e7b93f' },
};

/** 尾の長さ（段階ごと） */
const TAIL = [0.42, 0.72, 0.9, 1.0, 1.08];
/** からだの大きさ（段階ごと） */
const GROW = [0.8, 0.88, 0.95, 1, 1];

export interface CharacterProps {
  mood: Mood;
  level?: number;
  size?: number;
  color?: CharaColor;
  accessory?: CharaAccessory;
  decorative?: boolean;
  /** まだ到達していない段階（影だけ） */
  locked?: boolean;
  label?: string;
}

export function CharacterFace({ mood, level = 1, size = 96, color = 'standard', accessory = 'none', decorative = false, locked = false, label }: CharacterProps) {
  const uid = useId().replace(/:/g, '');
  const lv = Math.min(5, Math.max(1, level));
  const c = locked ? { hair: '#c9cfd4', tail: '#dde2e5', ring: '#c9cfd4', star: '#dde2e5' } : PALETTE[color];
  const body = locked ? '#e9ecee' : '#fbf6e8';
  const ink = locked ? '#b5bcc2' : '#22344d';
  const rest = mood === 'rest';
  const tail = TAIL[lv - 1] * (mood === 'worried' || rest ? 0.85 : 1);
  const droop = mood === 'worried' ? 10 : rest ? 16 : 0;
  const name = label ?? `${CHARACTER_NAME} Lv.${lv}（${LEVELS[lv - 1].name}）：${MOOD_LABEL[mood]}`;
  const a11y = decorative ? ({ 'aria-hidden': true } as const) : ({ role: 'img', 'aria-label': name } as const);
  return (
    <svg className={`chara is-${mood} lv-${lv}${locked ? ' is-locked' : ''}`} width={size} height={(size * 150) / 176} viewBox="-6 -8 176 150" {...a11y} data-mood={mood} data-level={lv}>
      <defs>
        <linearGradient id={`t${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={c.tail} stopOpacity="0.95" />
          <stop offset="1" stopColor={c.tail} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`h${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0.35" stopColor={c.hair} />
          <stop offset="1" stopColor={c.tail} stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={`g${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.9" />
          <stop offset="0.7" stopColor="#fff3cf" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff3cf" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`b${uid}`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor={body} />
        </radialGradient>
      </defs>

      <g transform={`translate(70 128) scale(${GROW[lv - 1]}) translate(-70 -128)`}>
      {/* Lv.5：光の輪 */}
      {lv >= 5 && !locked && (
        <g>
          <circle cx="76" cy="70" r="64" fill={`url(#g${uid})`} />
          <circle cx="76" cy="70" r="56" fill="none" stroke="#efd27a" strokeWidth="1.5" opacity="0.7" />
        </g>
      )}

      {/* 影 */}
      <ellipse cx="70" cy={rest ? 126 : 128} rx={rest ? 44 : 34} ry="5" fill="#22344d" opacity="0.08" />

      {/* 尾（彗星の流れ）：段階で伸びる */}
      <g transform={`rotate(${droop} 100 50) translate(100 50) scale(${tail}) translate(-100 -50)`}>
        <path d="M92 44 C112 26 134 10 162 0 C148 18 138 28 128 36 C142 32 156 34 166 40 C148 50 128 58 106 62 Z" fill={`url(#t${uid})`} />
        <path d="M88 44 C104 32 120 20 142 12 C130 26 122 34 114 40 C127 37 139 37 152 36 C136 47 121 54 106 60 Z" fill={`url(#h${uid})`} />
      </g>

      {/* 軌道の輪（後ろ半分） */}
      {lv >= 2 && (
        <g transform="rotate(-12 70 92)">
          <path d="M16 92 A54 14 0 0 1 124 92" fill="none" stroke={c.ring} strokeWidth={lv >= 3 ? 4.5 : 3} opacity="0.9" />
        </g>
      )}

      {/* からだ */}
      <g transform={rest ? 'translate(0 14) scale(1 0.86) translate(0 -14)' : undefined}>
        <ellipse cx="57" cy="117" rx="7" ry="4.5" fill={ink} />
        <ellipse cx="82" cy="118" rx="7" ry="4.5" fill={ink} />
        <path d="M30 84 C30 58 50 46 72 46 C96 46 112 62 111 86 C110 106 94 116 70 116 C46 116 30 106 30 84 Z" fill={`url(#b${uid})`} stroke={locked ? '#d5dadd' : '#efe5cf'} strokeWidth="1.2" />
        {/* 前髪（彗星の頭） */}
        <path d="M31 78 C30 56 50 42 76 42 C94 42 106 50 112 60 C98 54 80 52 62 56 C50 59 40 66 31 78 Z" fill={c.hair} />
        {!locked && <Face mood={mood} ink={ink} />}
        {accessory === 'scarf' && !locked && (
          <g>
            <path d="M33 98 C50 108 90 108 109 96 L110 104 C90 116 50 116 33 106 Z" fill="#d9663e" />
            <path d="M92 106 L98 126 L88 126 L84 108 Z" fill="#c4552f" />
            <path d="M40 101 L42 109 M52 104 L53 112 M64 106 L64 113 M76 106 L76 113" stroke="#f3a07d" strokeWidth="1.6" />
          </g>
        )}
      </g>

      {/* 軌道の輪（前半分）と星 */}
      {lv >= 2 && (
        <g transform="rotate(-12 70 92)">
          <path d="M16 92 A54 14 0 0 0 124 92" fill="none" stroke={c.ring} strokeWidth={lv >= 3 ? 4.5 : 3} />
          {lv >= 3 && <Star x={110} y={101} r={12} fill="#ffffff" stroke={c.ring} />}
        </g>
      )}

      {accessory === 'cap' && !locked && (
        <g transform="rotate(-14 52 40)">
          <path d="M26 38 L54 28 L82 38 L54 48 Z" fill="#1d2a3d" />
          <path d="M40 43 L40 52 C48 56 60 56 68 52 L68 43 L54 48 Z" fill="#2b3a52" />
          <path d="M54 38 L76 46 L76 58" stroke="#e7b93f" strokeWidth="2" fill="none" />
          <circle cx="76" cy="60" r="3" fill="#e7b93f" />
        </g>
      )}

      {/* きらめき（段階） */}
      {!locked && lv >= 3 && <Star x={20} y={40} r={6} fill={c.star} />}
      {!locked && lv >= 4 && (
        <g>
          <Star x={146} y={74} r={5} fill={c.star} />
          <Star x={128} y={8} r={4} fill={c.star} />
        </g>
      )}
      {!locked && lv >= 5 && (
        <g>
          <Star x={14} y={98} r={5} fill={c.star} />
          <Star x={66} y={6} r={6} fill={c.star} />
        </g>
      )}

      <MoodExtras mood={mood} ink={ink} star={c.star} locked={locked} />
      </g>
    </svg>
  );
}

function Star({ x, y, r, fill, stroke }: { x: number; y: number; r: number; fill: string; stroke?: string }) {
  const k = r * 0.2;
  return (
    <path
      d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r} Z`}
      fill={fill}
      stroke={stroke}
      strokeWidth={stroke ? 2 : 0}
      strokeLinejoin="round"
    />
  );
}

function Face({ mood, ink }: { mood: Mood; ink: string }) {
  const blushOn = mood === 'happy' || mood === 'angry';
  return (
    <g>
      <ellipse cx="47" cy="94" rx="6.5" ry="4" fill={mood === 'angry' ? '#ec8c7a' : '#f4aaa2'} opacity={blushOn ? 0.85 : 0.5} />
      <ellipse cx="90" cy="94" rx="6.5" ry="4" fill={mood === 'angry' ? '#ec8c7a' : '#f4aaa2'} opacity={blushOn ? 0.85 : 0.5} />
      <Eyes mood={mood} ink={ink} />
      <Mouth mood={mood} ink={ink} />
    </g>
  );
}

function Eyes({ mood, ink }: { mood: Mood; ink: string }) {
  const sw = { stroke: ink, strokeWidth: 3.4, strokeLinecap: 'round' as const, fill: 'none' };
  switch (mood) {
    case 'happy':
      return (
        <g {...sw}>
          <path d="M51 85 q5.5 -8 11 0" />
          <path d="M74 85 q5.5 -8 11 0" />
        </g>
      );
    case 'focus':
      return (
        <g {...sw}>
          <path d="M51 81 q5.5 5 11 0" />
          <path d="M74 81 q5.5 5 11 0" />
        </g>
      );
    case 'rest':
      return (
        <g {...sw}>
          <path d="M51 84 q5.5 3 11 0" />
          <path d="M74 84 q5.5 3 11 0" />
        </g>
      );
    case 'waiting':
      return (
        <g fill={ink}>
          <ellipse cx="57" cy="78" rx="3.6" ry="5.4" />
          <ellipse cx="80" cy="78" rx="3.6" ry="5.4" />
          <circle cx="58.2" cy="75.6" r="1.4" fill="#fff" />
          <circle cx="81.2" cy="75.6" r="1.4" fill="#fff" />
        </g>
      );
    case 'worried':
      return (
        <g>
          <g stroke={ink} strokeWidth="2.8" strokeLinecap="round">
            <path d="M50 73 L61 69" />
            <path d="M75 69 L86 73" />
          </g>
          <g fill={ink}>
            <ellipse cx="56" cy="83" rx="3" ry="4.4" />
            <ellipse cx="80" cy="83" rx="3" ry="4.4" />
          </g>
        </g>
      );
    case 'angry':
      return (
        <g>
          <g stroke={ink} strokeWidth="3.2" strokeLinecap="round">
            <path d="M49 69 L62 75" />
            <path d="M74 75 L87 69" />
          </g>
          <g fill={ink}>
            <ellipse cx="57" cy="82" rx="3.4" ry="4.6" />
            <ellipse cx="80" cy="82" rx="3.4" ry="4.6" />
          </g>
        </g>
      );
    default:
      return (
        <g fill={ink}>
          <ellipse cx="57" cy="81" rx="3.6" ry="5.4" />
          <ellipse cx="80" cy="81" rx="3.6" ry="5.4" />
        </g>
      );
  }
}

function Mouth({ mood, ink }: { mood: Mood; ink: string }) {
  const line = { stroke: ink, strokeWidth: 2.8, strokeLinecap: 'round' as const, fill: 'none' };
  switch (mood) {
    case 'happy':
      return <path d="M61 92 q7.5 10 15 0 z" fill="#d06a63" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />;
    case 'focus':
    case 'normal':
      return <path d="M63 93 q5.5 4.5 11 0" {...line} />;
    case 'rest':
      return <path d="M65 95 h7" {...line} />;
    case 'waiting':
      return <ellipse cx="68.5" cy="95" rx="3" ry="3.6" {...line} strokeWidth={2.4} />;
    case 'worried':
      return <path d="M61 97 q3.75 -3 7.5 0 q3.75 3 7.5 0" {...line} />;
    case 'angry':
      return <path d="M61 99 q7.5 -7 15 0" {...line} />;
  }
}

function MoodExtras({ mood, ink, star, locked }: { mood: Mood; ink: string; star: string; locked: boolean }) {
  if (locked) return null;
  switch (mood) {
    case 'happy':
      return (
        <g fill={star}>
          <Star x={24} y={66} r={5} fill={star} />
          <Star x={118} y={112} r={4} fill={star} />
        </g>
      );
    case 'normal':
      // やるぞ！
      return (
        <g stroke={ink} strokeWidth="3" strokeLinecap="round">
          <path d="M22 50 L26 60" />
          <circle cx="27.5" cy="66" r="1.6" fill={ink} stroke="none" />
        </g>
      );
    case 'waiting':
      return (
        <g fill={ink} opacity="0.7">
          <circle cx="16" cy="64" r="2.3" />
          <circle cx="23" cy="58" r="2.3" />
          <circle cx="30" cy="53" r="2.3" />
        </g>
      );
    case 'rest':
      return (
        <g fill={ink} fontFamily="sans-serif" fontWeight="700">
          <text x="10" y="70" fontSize="13">
            z
          </text>
          <text x="18" y="56" fontSize="17">
            z
          </text>
        </g>
      );
    case 'worried':
      return <path d="M22 66 C25 71 27 74 27 77 A5 5 0 0 1 17 77 C17 74 19 71 22 66 Z" fill="#a5cdea" stroke={ink} strokeWidth="1.4" />;
    case 'angry':
      return (
        <g stroke="#c4553f" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M18 52 q4 4 0 8" />
          <path d="M26 52 q-4 4 0 8" />
          <path d="M17 62 q5 -4 10 0" />
        </g>
      );
    default:
      return null;
  }
}

import { CHARACTER_NAME, MOOD_LABEL, type Mood } from '../lib/character';

/**
 * オリジナルキャラクター「つづ」：芽の出たおもち。積み上げると芽が育つイメージ。
 * 表情は5種類（嬉しい・ふつう・待っている・心配・怒っている）。色だけに頼らず、目・眉・口の形で区別する。
 */
export function CharacterFace({ mood, size = 96, decorative = false }: { mood: Mood; size?: number; decorative?: boolean }) {
  const ink = '#24384f';
  const body = mood === 'angry' ? '#ffe6da' : mood === 'happy' ? '#fff3dc' : '#fbf4e6';
  const leaf = '#5d9a7f';
  const blush = mood === 'angry' ? '#e8907f' : '#f2a7a0';
  // 芽の向き：嬉しい＝上向き、心配＝しおれ、怒り＝ピンと立つ
  const leafL = mood === 'happy' ? 'rotate(-38 60 26)' : mood === 'worried' ? 'rotate(-8 60 26)' : mood === 'angry' ? 'rotate(-52 60 26)' : 'rotate(-26 60 26)';
  const leafR = mood === 'happy' ? 'rotate(38 60 26)' : mood === 'worried' ? 'rotate(8 60 26)' : mood === 'angry' ? 'rotate(52 60 26)' : 'rotate(26 60 26)';
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': `${CHARACTER_NAME}：${MOOD_LABEL[mood]}` } as const);
  return (
    <svg className={`chara is-${mood}`} width={size} height={size} viewBox="0 0 120 120" {...a11y} data-mood={mood}>
      {/* 芽 */}
      <path d="M60 32 V20" stroke={leaf} strokeWidth="4" strokeLinecap="round" fill="none" />
      <ellipse cx="60" cy="14" rx="6" ry="11" fill={leaf} transform={leafL} />
      <ellipse cx="60" cy="14" rx="6" ry="11" fill={leaf} transform={leafR} />
      {/* からだ */}
      <path
        d="M60 30 C88 30 104 52 104 77 C104 99 86 109 60 109 C34 109 16 99 16 77 C16 52 32 30 60 30 Z"
        fill={body}
        stroke={ink}
        strokeWidth="3"
      />
      {/* ほっぺ */}
      <ellipse cx="34" cy="84" rx="7" ry="4.5" fill={blush} opacity={mood === 'happy' || mood === 'angry' ? 0.85 : 0.45} />
      <ellipse cx="86" cy="84" rx="7" ry="4.5" fill={blush} opacity={mood === 'happy' || mood === 'angry' ? 0.85 : 0.45} />
      <Eyes mood={mood} ink={ink} />
      <Mouth mood={mood} ink={ink} />
      {mood === 'worried' && (
        // 汗
        <path d="M96 50 C99 55 101 58 101 61 A5 5 0 0 1 91 61 C91 58 93 55 96 50 Z" fill="#9cc7e6" stroke={ink} strokeWidth="1.5" />
      )}
      {mood === 'angry' && (
        // むっ（怒りマーク）
        <g stroke="#c4553f" strokeWidth="3.2" strokeLinecap="round" fill="none">
          <path d="M88 36 q4 4 0 8" />
          <path d="M96 36 q-4 4 0 8" />
          <path d="M86 46 q4 -4 8 0" transform="translate(1 2)" />
        </g>
      )}
      {mood === 'waiting' && (
        <g fill={ink}>
          <circle cx="92" cy="40" r="2.4" />
          <circle cx="100" cy="36" r="2.4" />
          <circle cx="108" cy="32" r="2.4" />
        </g>
      )}
      {mood === 'happy' && (
        <g fill="#e8b84a">
          <path d="M100 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
          <path d="M18 44 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 z" />
        </g>
      )}
    </svg>
  );
}

function Eyes({ mood, ink }: { mood: Mood; ink: string }) {
  if (mood === 'happy')
    return (
      <g stroke={ink} strokeWidth="3.6" strokeLinecap="round" fill="none">
        <path d="M38 72 q7 -9 14 0" />
        <path d="M68 72 q7 -9 14 0" />
      </g>
    );
  if (mood === 'waiting')
    return (
      <g fill={ink}>
        <circle cx="47" cy="68" r="5" />
        <circle cx="75" cy="68" r="5" />
        <circle cx="48.5" cy="66" r="1.6" fill="#fff" />
        <circle cx="76.5" cy="66" r="1.6" fill="#fff" />
      </g>
    );
  const brows =
    mood === 'worried' ? (
      <g stroke={ink} strokeWidth="3" strokeLinecap="round">
        <path d="M37 62 L51 57" />
        <path d="M69 57 L83 62" />
      </g>
    ) : mood === 'angry' ? (
      <g stroke={ink} strokeWidth="3.4" strokeLinecap="round">
        <path d="M37 57 L52 63" />
        <path d="M68 63 L83 57" />
      </g>
    ) : null;
  return (
    <g>
      {brows}
      <g fill={ink}>
        <circle cx="45" cy="72" r={mood === 'worried' ? 4 : 4.6} />
        <circle cx="75" cy="72" r={mood === 'worried' ? 4 : 4.6} />
      </g>
    </g>
  );
}

function Mouth({ mood, ink }: { mood: Mood; ink: string }) {
  switch (mood) {
    case 'happy':
      return <path d="M49 83 q11 14 22 0 z" fill="#c75f5a" stroke={ink} strokeWidth="2.8" strokeLinejoin="round" />;
    case 'normal':
      return <path d="M52 85 q8 7 16 0" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />;
    case 'waiting':
      return <ellipse cx="60" cy="88" rx="4" ry="4.6" fill="none" stroke={ink} strokeWidth="2.8" />;
    case 'worried':
      return <path d="M50 90 q5 -4 10 0 q5 4 10 0" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />;
    case 'angry':
      return <path d="M50 92 q10 -9 20 0" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />;
  }
}

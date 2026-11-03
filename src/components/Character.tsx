import { CHARACTER_INFO, LEVELS, MOOD_LABEL, moodToState, type CharacterKind, type CharacterState, type Mood } from '../lib/character';

/**
 * キャラクターは、提供された PNG 素材（public/assets/characters/{kind}__{state}.png）をそのまま表示する。
 * 加工・再描画・SVG での作り直しはしない。段階（Lv）ごとの絵は素材にないため、段階で絵は変えない。
 */

/** 素材の URL（GitHub Pages のサブパスでも動くよう、ビルドの base からの相対） */
export function characterSrc(kind: CharacterKind, state: CharacterState): string {
  return `${import.meta.env.BASE_URL}assets/characters/${kind}__${state}.png`;
}

export interface CharacterProps {
  mood: Mood;
  kind?: CharacterKind;
  level?: number;
  size?: number;
  decorative?: boolean;
  /** まだ届いていない段階（CSS で色を抜いて薄く見せる。素材そのものは変えない） */
  locked?: boolean;
  label?: string;
}

export function CharacterFace({ mood, kind = 'tsuzukiboshi', level = 1, size = 96, decorative = false, locked = false, label }: CharacterProps) {
  const lv = Math.min(5, Math.max(1, level));
  const alt = label ?? `${CHARACTER_INFO[kind].name} Lv.${lv}（${LEVELS[lv - 1].name}）：${MOOD_LABEL[mood]}`;
  return (
    <CharacterImage
      kind={kind}
      state={moodToState(mood)}
      size={size}
      alt={alt}
      decorative={decorative}
      className={`chara is-${mood}${locked ? ' is-locked' : ''}`}
      mood={mood}
    />
  );
}

export function CharacterImage({
  kind,
  state,
  size,
  alt,
  decorative = false,
  className = 'chara',
  mood,
}: {
  kind: CharacterKind;
  state: CharacterState;
  size: number;
  alt: string;
  decorative?: boolean;
  className?: string;
  mood?: Mood;
}) {
  return (
    <img
      className={`${className} chara-img`}
      src={characterSrc(kind, state)}
      width={size}
      height={size}
      alt={decorative ? '' : alt}
      aria-hidden={decorative || undefined}
      decoding="async"
      draggable={false}
      data-kind={kind}
      data-state={state}
      data-mood={mood}
    />
  );
}

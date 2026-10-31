/**
 * アプリ全体の定数。
 * 基準値（確認済み累計）はユーザーが確認した実績であり、ここから個別の記録を生成してはいけない。
 */
export const BASELINE = Object.freeze({
  /** 2026-10-07 時点で確認済みの累計学習時間（分）= 17時間36分 */
  minutes: 1056,
  /** 基準日（この日までの学習は基準値に含まれる） */
  asOf: '2026-10-07',
});

/**
 * 「また、ここから。」に切り替える空白日数のしきい値（仮説）。
 * 最終学習日から N 日以上経過したら再開ホームを表示する。
 */
export const RESUME_GAP_DAYS = 2;

export const DEFAULT_TARGET_MINUTES = 20;
export const TWO_MINUTE_TARGET_MINUTES = 2;
export const DEFAULT_SUBJECT = '簿記3級';

export const LIMITS = Object.freeze({
  subject: 30,
  nextAction: 80,
  cue: 60,
  title: 100,
  note: 200,
  minutesMin: 1,
  minutesMax: 1440,
  targetMin: 1,
  targetMax: 180,
  records: 20000,
  backupBytes: 10 * 1024 * 1024,
});

/** 計測時間がこの分数を超えたら、終了画面で修正を強めに案内する */
export const LONG_SESSION_WARN_MINUTES = 180;

/** 画面を離れていた時間がこれ以上なら、復帰時に注意を表示する（ミリ秒） */
export const AWAY_NOTICE_MS = 60_000;

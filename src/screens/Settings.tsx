import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../lib/config';
import { formatJpDate, formatMinutes, formatShortDate, localDate } from '../lib/dates';
import { buildBackup, ImportError, parseImportText, parseLegacyV3, type LegacyCandidates, type ParsedBackup } from '../lib/backup';
import { readLegacyV3 } from '../lib/storage';
import { DEFAULT_APP_SETTINGS, type Strictness } from '../lib/model';
import { MOOD_LABEL, type Mood } from '../lib/character';
import { CharacterFace } from '../components/Character';
import { todayOf, useStore } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, TopBar, useFocusHeading } from '../components/common';
import { IconDownload, IconUpload } from '../components/Icons';

export function Settings({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const [restore, setRestore] = useState<ParsedBackup | null>(null);
  const [legacy, setLegacy] = useState<LegacyCandidates | null>(null);
  const [legacyFound, setLegacyFound] = useState<Record<string, unknown> | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [copyText, setCopyText] = useState<string | null>(null);
  // 切り替えは即座に画面へ反映し、保存に失敗したら元に戻す
  const [support, setSupport] = useState(state.settings.supportMode);
  const [weekly, setWeekly] = useState(state.settings.weeklyReview);
  useEffect(() => {
    setSupport(state.settings.supportMode);
    setWeekly(state.settings.weeklyReview);
  }, [state.settings.supportMode, state.settings.weeklyReview]);
  function changeSupport(v: 'plan' | 'simple', label: string) {
    const prev = support;
    setSupport(v);
    actions
      .updateSettings({ supportMode: v })
      .then(() => actions.toast(`「${label}」に切り替えました。`))
      .catch(() => {
        setSupport(prev);
        actions.toast('保存できませんでした。', { tone: 'error' });
      });
  }
  function changeWeekly(v: boolean) {
    setWeekly(v);
    actions.updateSettings({ weeklyReview: v }).catch(() => {
      setWeekly(!v);
      actions.toast('保存できませんでした。', { tone: 'error' });
    });
  }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    readLegacyV3().then(setLegacyFound);
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  function exportJson() {
    const data = buildBackup(state.habits, state.settings, state.records, state.reviews);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tsuzuku-backup-${localDate()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    actions.toast(`バックアップを書き出しました（記録${state.records.length}件）。`);
  }

  /** 読み込んだ文字列を解析し、確認ダイアログへ。成功なら true */
  function openImport(text: string): boolean {
    try {
      const parsed = parseImportText(text, todayOf(state.settings));
      if (parsed.kind === 'backup') setRestore(parsed);
      else setLegacy(parsed.legacy);
      return true;
    } catch (e) {
      actions.toast(e instanceof ImportError ? `読み込めませんでした：${e.message}` : '読み込めませんでした。', { tone: 'error' });
      return false;
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.backupBytes) {
      actions.toast('読み込めませんでした：ファイルが大きすぎます（10MBまで）。', { tone: 'error' });
      return;
    }
    openImport(await file.text());
  }

  /** ダウンロードできない環境（埋め込み表示など）向け：バックアップをクリップボードへ */
  function copyJson() {
    const text = JSON.stringify(buildBackup(state.habits, state.settings, state.records, state.reviews));
    const fallback = () => setCopyText(text);
    try {
      navigator.clipboard
        .writeText(text)
        .then(() => actions.toast(`バックアップをコピーしました（記録${state.records.length}件）。メモ等に貼り付けて保管できます。`))
        .catch(fallback);
    } catch {
      fallback();
    }
  }

  const v = state.storageKind;
  return (
    <div className="screen settings">
      <div className="mobile-only">
        <TopBar title="設定" onBack={() => navigate('/')} backLabel="今日に戻る" />
      </div>
      <section className="hero settings-hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          設定
        </h1>
      </section>

      <section className="settings-block" aria-labelledby="s-support">
        <h2 id="s-support" className="section-title">支援の表示</h2>
        <p className="help">きっかけ・しおり・できない日の組は、習慣ごとに今日の画面の ✎ から決めます。</p>
        <div className="radio-list" role="radiogroup" aria-labelledby="s-support">
          {(
            [
              ['plan', 'プラン表示（おすすめ）', '習慣ごとのきっかけ（もし〜したら）と、週の見直しを表示します。'],
              ['simple', '記録中心', 'しおり・開始・記録だけの簡素な表示にします。2つの使い方を比べたいときに。'],
            ] as const
          ).map(([v, l, d]) => (
            <label key={v} className={`radio${support === v ? ' is-on' : ''}`}>
              <input type="radio" name="support" value={v} checked={support === v} onChange={() => changeSupport(v, l.replace('（おすすめ）', ''))} />
              <span>
                <span className="radio-label">{l}</span>
                <span className="help">{d}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={weekly} onChange={(e) => changeWeekly(e.target.checked)} />
          <span>週に1度、見直しをホームで提案する（任意・1分）</span>
        </label>
      </section>

      <CharacterSettings />

      <DaySettings />

      <section className="settings-block" aria-labelledby="s-data">
        <h2 id="s-data" className="section-title">データ</h2>
        <p className={`storage-note${v === 'memory' ? ' is-warn' : ''}`} role={v === 'memory' ? 'alert' : undefined}>
          {v === 'indexeddb' && 'この端末のブラウザ内（IndexedDB）に保存しています。'}
          {v === 'localStorage' && 'この端末のブラウザ内（localStorage）に保存しています。'}
          {v === 'memory' && 'このブラウザでは保存領域を使えません。画面を閉じると記録は消えます。プライベートブラウズを解除するか、別のブラウザでお使いください。'}
          {v !== 'memory' &&
            (state.account
              ? ' ログイン中のため、PCとスマホのあいだで自動で同期しています。'
              : ' ログインしない限り、PCとスマホのデータは同期されません（「仲間」タブからログインできます）。ブラウザのデータ削除で消えることがあるため、ときどきバックアップを書き出してください。')}
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-outline" onClick={exportJson}>
            <IconDownload size={18} />
            バックアップを書き出す
          </button>
          <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}>
            <IconUpload size={18} />
            バックアップから復元
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={copyJson}>バックアップをコピー</button>
          <button type="button" className="btn btn-quiet" onClick={() => { setPasteText(''); setPasteOpen(true); }}>貼り付けて復元</button>
        </div>
        <p className="help">ファイルを保存できない環境では「コピー」と「貼り付けて復元」を使えます（例：PCでコピー → 自分宛てのメモで送る → スマホで貼り付け）。以前の試作版（v3.1）のバックアップにも対応しています。</p>

        {state.v6Backup && (
          <div className="legacy-box">
            <p className="dialog-text">v6 から自動で移行しました。移行前のデータ（記録{state.v6Backup.records.length}件）も書き出せます。</p>
            <button type="button" className="btn btn-outline" onClick={() => {
              const blob = new Blob([JSON.stringify({ format: 'tsuzuku-v6-premigration', exportedAt: new Date().toISOString(), ...state.v6Backup }, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `tsuzuku-v6-before-migration-${localDate()}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }}>
              <IconDownload size={18} />
              移行前のデータを書き出す
            </button>
          </div>
        )}

        {legacyFound && (
          <div className="legacy-box">
            <p className="dialog-text">このブラウザに以前の試作版（v3.1）のデータが見つかりました。自動では取り込みません。</p>
            <button type="button" className="btn btn-outline" onClick={() => {
              try { setLegacy(parseLegacyV3(legacyFound, localDate())); } catch (e) { actions.toast(e instanceof Error ? e.message : '読み込めませんでした。', { tone: 'error' }); }
            }}>
              内容を確認して取り込む
            </button>
          </div>
        )}
      </section>

      <section className="settings-block" aria-labelledby="s-about">
        <h2 id="s-about" className="section-title">このアプリについて</h2>
        <ul className="about-list">
          <li>確認済みの累計：{formatJpDate('2026-10-07')}時点で17時間36分（1,056分）。この期間の個別の記録はありません。</li>
          <li>広告・解析ツールはありません。ログインは任意で、仲間と同期を使うときだけ必要です。</li>
          <li>ホーム画面に追加すると、オフラインでも起動できます。</li>
        </ul>
        {installEvt && (
          <button type="button" className="btn btn-outline" onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }}>
            ホーム画面に追加
          </button>
        )}
      </section>

      <section className="settings-block danger-zone" aria-labelledby="s-reset">
        <h2 id="s-reset" className="section-title">記録の消去</h2>
        <p className="help">この端末の習慣・記録・設定をすべて消去します。{state.account ? 'ログイン中のため、同期先の記録も消えます。' : ''}確認済みの累計17時間36分は、簿記の習慣を作り直すと再び土台になります。</p>
        <button type="button" className="btn btn-danger-ghost" onClick={() => setResetStep(1)} disabled={!!state.active}>
          記録と設定を消去…
        </button>
        {state.active && <p className="help">学習中は消去できません。</p>}
      </section>

      <Dialog open={copyText !== null} onClose={() => setCopyText(null)} title="バックアップの内容"
        description="自動でコピーできませんでした。下の文字をすべて選択してコピーし、メモなどに保管してください。">
        <label className="sr-only" htmlFor="copy-json">バックアップ（JSON）</label>
        <textarea id="copy-json" className="input textarea code" readOnly rows={6} value={copyText ?? ''} data-autofocus
          onFocus={(e) => e.currentTarget.select()} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCopyText(null)}>閉じる</button>
        </div>
      </Dialog>

      <Dialog open={pasteOpen} onClose={() => setPasteOpen(false)} title="貼り付けて復元"
        description="「バックアップをコピー」で控えた内容、またはバックアップファイルの中身を貼り付けてください。次の画面で内容を確認してから復元します。">
        <form onSubmit={(e) => { e.preventDefault(); if (openImport(pasteText.trim())) setPasteOpen(false); }} noValidate>
          <label className="field-label" htmlFor="paste-json">バックアップ（JSON）</label>
          <textarea id="paste-json" className="input textarea code" rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            placeholder='{"format":"tsuzuku-backup", …}' spellCheck={false} />
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen(false)}>キャンセル</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!pasteText.trim()}>内容を確認する</button>
          </div>
        </form>
      </Dialog>

      <RestoreDialog data={restore} onClose={() => setRestore(null)} onExport={exportJson} />
      <LegacyDialog data={legacy} onClose={() => setLegacy(null)} />

      <Dialog open={resetStep === 1} onClose={() => setResetStep(0)} title="記録と設定を消去しますか？" role="alertdialog"
        description={`習慣${state.habits.length}件・記録${state.records.length}件（${formatMinutes(state.records.reduce((s, r) => s + r.minutes, 0))}）と設定を消去します。バックアップがないと元に戻せません。`}>
        <div className="dialog-actions stacked">
          <button type="button" className="btn btn-outline" onClick={exportJson} data-autofocus>先にバックアップを書き出す</button>
          <button type="button" className="btn btn-danger" onClick={async () => {
            try {
              await actions.replaceAll({ habits: [], settings: { ...DEFAULT_APP_SETTINGS }, records: [], reviews: [] });
              setResetStep(0);
              actions.toast('記録と設定を消去しました。');
              navigate('/');
            } catch {
              actions.toast('消去できませんでした。', { tone: 'error' });
            }
          }}>消去する</button>
          <button type="button" className="btn btn-ghost" onClick={() => setResetStep(0)}>やめる</button>
        </div>
      </Dialog>
    </div>
  );
}

function RestoreDialog({ data, onClose, onExport }: { data: ParsedBackup | null; onClose: () => void; onExport: () => void }) {
  const { state, actions } = useStore();
  const [busy, setBusy] = useState(false);
  if (!data) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  return (
    <Dialog open onClose={onClose} title="バックアップから復元しますか？" role="alertdialog" busy={busy}
      description={<>
        <p>ファイル：習慣{data.habits.length}件・記録{data.records.length}件{data.exportedAt ? `（${formatShortDate(localDate(new Date(data.exportedAt)))}に書き出し）` : ''}</p>
        <p>現在：習慣{state.habits.length}件・記録{state.records.length}件</p>
        <p>現在の習慣・記録・設定は、ファイルの内容に置き換わります。</p>
      </>}>
      <div className="dialog-actions stacked">
        <button type="button" className="btn btn-outline" onClick={onExport} disabled={busy} data-autofocus>先に現在のデータを書き出す</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await actions.replaceAll({ habits: data.habits, settings: data.settings, records: data.records, reviews: data.reviews });
            onClose();
            actions.toast(`復元しました（記録${data.records.length}件）。`);
          } catch {
            actions.toast('復元できませんでした。現在のデータは変更されていません。', { tone: 'error' });
          } finally {
            setBusy(false);
          }
        }}>{busy ? '復元中…' : '置き換えて復元する'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>やめる</button>
      </div>
    </Dialog>
  );
}

function LegacyDialog({ data, onClose }: { data: LegacyCandidates | null; onClose: () => void }) {
  const { state, actions } = useStore();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [takeSettings, setTakeSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setSel(new Set(data.candidates.filter((c) => c.include).map((c) => c.record.id)));
  }, [data]);
  if (!data) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  const chosen = data.candidates.filter((c) => !c.blocked && sel.has(c.record.id));
  const target = state.habits.find((h) => h.baseline) ?? state.habits.find((h) => h.trackingType === 'time' && !h.archived);
  const hasSettings = !!(data.nextAction || data.cue);
  return (
    <Dialog open onClose={onClose} title="試作版（v3.1）から取り込む" busy={busy}
      description="取り込む記録を選んでください。2026年10月7日以前の記録は確認済みの累計に含まれるため取り込めません。">
      {data.candidates.length === 0 ? (
        <p className="dialog-text">取り込める学習記録はありません。</p>
      ) : (
        <ul className="legacy-list">
          {data.candidates.map((c, i) => (
            <li key={c.record.id || i} className={c.blocked ? 'is-blocked' : ''}>
              <label>
                <input type="checkbox" disabled={c.blocked} checked={!c.blocked && sel.has(c.record.id)}
                  onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(c.record.id); else s.delete(c.record.id); setSel(s); }} />
                <span>
                  <span className="record-date">{/^\d{4}-\d{2}-\d{2}$/.test(c.record.studyDate) ? formatShortDate(c.record.studyDate) : '日付不明'} · {Number.isFinite(c.record.minutes) ? `${c.record.minutes}分` : '時間不明'}</span>
                  <span className="record-title">{c.record.title || '（内容なし）'}</span>
                  {c.reason && <span className="help">{c.reason}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!target && <p className="save-error" role="alert">取り込み先の「時間で記録」の習慣がありません。先に簿記の習慣を作ってください。</p>}
      {hasSettings && (
        <label className="check-row">
          <input type="checkbox" checked={takeSettings} onChange={(e) => setTakeSettings(e.target.checked)} />
          <span>次にやること・きっかけも引き継ぐ（現在未設定の項目のみ）</span>
        </label>
      )}
      <FieldError id="legacy-err">{null}</FieldError>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>やめる</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !target || (chosen.length === 0 && !(takeSettings && hasSettings))} onClick={async () => {
          if (!target) return;
          setBusy(true);
          try {
            const n = await actions.addRecords(
              chosen.map((c) => ({ ...c.record, habitId: target.id, kind: 'done' as const })),
              takeSettings ? { habitId: target.id, nextAction: data.nextAction, cue: data.cue } : undefined,
            );
            onClose();
            actions.toast(`${n}件の記録を取り込みました。`);
          } catch {
            actions.toast('取り込めませんでした。現在のデータは変更されていません。', { tone: 'error' });
          } finally {
            setBusy(false);
          }
        }}>{busy ? '取り込み中…' : `${chosen.length}件を取り込む`}</button>
      </div>
    </Dialog>
  );
}

const STRICT: [Strictness, string, string][] = [
  ['gentle', 'やさしい', '心配・怒った顔は出しません。間があいても「待っている」まで。'],
  ['normal', 'ふつう（おすすめ）', '予定の日に2日あくと心配そうにします。怒りません。'],
  ['strict', 'きびしい', '予定の日に3日あくと怒ります。再開すればすぐに嬉しそうな顔に戻ります。'],
];
const MOODS: Mood[] = ['happy', 'normal', 'waiting', 'worried', 'angry'];

function CharacterSettings() {
  const { state, actions } = useStore();
  const [on, setOn] = useState(state.settings.characterEnabled);
  const [strict, setStrict] = useState(state.settings.strictness);
  useEffect(() => {
    setOn(state.settings.characterEnabled);
    setStrict(state.settings.strictness);
  }, [state.settings.characterEnabled, state.settings.strictness]);
  const fail = () => actions.toast('保存できませんでした。', { tone: 'error' });
  return (
    <section className="settings-block" aria-labelledby="s-chara">
      <h2 id="s-chara" className="section-title">キャラクター「つづ」</h2>
      <label className="check-row">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => {
          const v = e.target.checked;
          setOn(v);
          actions.updateSettings({ characterEnabled: v }).catch(() => { setOn(!v); fail(); });
        }} />
        <span>今日の画面にキャラクターを表示する</span>
      </label>
      <p className="help">表情は実際の記録だけで決まります（予定の曜日・やった日・休むと決めた日）。予定のない日と休むと決めた日は、途切れに数えません。</p>
      <ul className="mood-gallery" aria-label="表情の一覧">
        {MOODS.map((m) => (
          <li key={m}>
            <CharacterFace mood={m} size={56} decorative />
            <span>{MOOD_LABEL[m]}</span>
          </li>
        ))}
      </ul>
      <fieldset disabled={!on}>
        <legend className="field-label">厳しさ</legend>
        <div className="radio-list" role="radiogroup" aria-label="厳しさ">
          {STRICT.map(([v, l, d]) => (
            <label key={v} className={`radio${strict === v ? ' is-on' : ''}`}>
              <input type="radio" name="strictness" value={v} checked={strict === v} onChange={() => {
                const prev = strict;
                setStrict(v);
                actions.updateSettings({ strictness: v }).catch(() => { setStrict(prev); fail(); });
              }} />
              <span>
                <span className="radio-label">{l}</span>
                <span className="help">{d}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function parseList(s: string): number[] | null {
  const xs = s.split(/[,、\s]+/).filter(Boolean).map(Number);
  if (!xs.length || xs.length > 12 || xs.some((x) => !Number.isInteger(x) || x < 1 || x > 10000)) return null;
  return [...new Set(xs)].sort((a, b) => a - b);
}

function DaySettings() {
  const { state, actions } = useStore();
  const [hour, setHour] = useState(state.settings.dayStartHour);
  const [mt, setMt] = useState(state.settings.milestonesTime.join(', '));
  const [md, setMd] = useState(state.settings.milestonesDays.join(', '));
  const [err, setErr] = useState<{ mt?: string; md?: string }>({});
  useEffect(() => setHour(state.settings.dayStartHour), [state.settings.dayStartHour]);
  async function saveMilestones(e: React.FormEvent) {
    e.preventDefault();
    const t = parseList(mt);
    const d = parseList(md);
    const errs = { mt: t ? undefined : '1〜10000の整数をカンマ区切りで入力してください。', md: d ? undefined : '1〜10000の整数をカンマ区切りで入力してください。' };
    setErr(errs);
    if (!t || !d) return;
    try {
      await actions.updateSettings({ milestonesTime: t, milestonesDays: d });
      setMt(t.join(', '));
      setMd(d.join(', '));
      actions.toast('節目を保存しました。');
    } catch {
      actions.toast('保存できませんでした。', { tone: 'error' });
    }
  }
  return (
    <section className="settings-block" aria-labelledby="s-day">
      <h2 id="s-day" className="section-title">1日の区切りと節目</h2>
      <label className="field-label" htmlFor="s-hour">1日の区切り</label>
      <select id="s-hour" className="input select" value={hour} onChange={(e) => {
        const v = Number(e.target.value);
        setHour(v);
        actions.updateSettings({ dayStartHour: v }).catch(() => actions.toast('保存できませんでした。', { tone: 'error' }));
      }} aria-describedby="s-hour-help">
        {[0, 1, 2, 3, 4].map((h) => (
          <option key={h} value={h}>{h === 0 ? '0時（ふつう）' : `${h}時（${h}時までは前の日）`}</option>
        ))}
      </select>
      <p id="s-hour-help" className="help">夜ふかしの日も、寝る前の記録を「その日」として数えたいときに。</p>
      <form onSubmit={saveMilestones} noValidate className="spaced">
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor="s-mt">時間で記録する習慣の節目（時間）</label>
            <input id="s-mt" className="input" value={mt} onChange={(e) => setMt(e.target.value)} inputMode="numeric" aria-invalid={!!err.mt} aria-describedby="s-mt-err" />
            <FieldError id="s-mt-err">{err.mt}</FieldError>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="s-md">日数で記録する習慣の節目（日）</label>
            <input id="s-md" className="input" value={md} onChange={(e) => setMd(e.target.value)} inputMode="numeric" aria-invalid={!!err.md} aria-describedby="s-md-err" />
            <FieldError id="s-md-err">{err.md}</FieldError>
          </div>
        </div>
        <button type="submit" className="btn btn-outline btn-sm">節目を保存</button>
      </form>
    </section>
  );
}

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
  }
}

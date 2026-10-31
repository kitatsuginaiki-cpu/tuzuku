import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../lib/config';
import { formatJpDate, formatMinutes, formatShortDate, localDate } from '../lib/dates';
import { buildBackup, ImportError, parseImportText, parseLegacyV3, type LegacyCandidates } from '../lib/backup';
import { DEFAULT_SETTINGS, totalMinutes, type Settings as SettingsT, type StudyRecord } from '../lib/records';
import { readLegacyV3 } from '../lib/storage';
import { useStore } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, TopBar, useFocusHeading } from '../components/common';
import { IconDownload, IconUpload } from '../components/Icons';

export function Settings({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const [form, setForm] = useState(() => toForm(state.settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ settings: SettingsT; records: StudyRecord[]; exportedAt: string | null } | null>(null);
  const [legacy, setLegacy] = useState<LegacyCandidates | null>(null);
  const [legacyFound, setLegacyFound] = useState<Record<string, unknown> | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [copyText, setCopyText] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => setForm(toForm(state.settings)), [state.settings]);
  useEffect(() => {
    readLegacyV3().then(setLegacyFound);
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const t = Number(form.targetMinutes);
    if (!Number.isInteger(t) || t < LIMITS.targetMin || t > LIMITS.targetMax) errs.targetMinutes = `${LIMITS.targetMin}〜${LIMITS.targetMax}分の整数で入力してください。`;
    if (form.subject.trim().length > LIMITS.subject) errs.subject = `${LIMITS.subject}文字以内で入力してください。`;
    if (form.nextAction.trim().length > LIMITS.nextAction) errs.nextAction = `次の一歩は${LIMITS.nextAction}文字以内で入力してください。`;
    if (form.cue.trim().length > LIMITS.cue) errs.cue = `きっかけは${LIMITS.cue}文字以内で入力してください。`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await actions.updateSettings({
        subject: form.subject.replace(/\s+/g, ' ').trim(),
        nextAction: form.nextAction.replace(/\s+/g, ' ').trim(),
        cue: form.cue.replace(/\s+/g, ' ').trim(),
        targetMinutes: t,
      });
      actions.toast('設定を保存しました。');
    } catch {
      actions.toast('保存できませんでした。入力は保持しています。もう一度お試しください。', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    const data = buildBackup(state.settings, state.records);
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
      const parsed = parseImportText(text, localDate());
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
    const text = JSON.stringify(buildBackup(state.settings, state.records));
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

      <form className="settings-block" onSubmit={saveForm} noValidate aria-labelledby="s-study">
        <h2 id="s-study" className="section-title">学習</h2>
        <SettingField id="s-subject" label="学習対象" help="ホームと学習中の画面に表示します（空欄可）" error={errors.subject}>
          <input id="s-subject" className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} aria-invalid={!!errors.subject} aria-describedby="s-subject-help s-subject-err" />
        </SettingField>
        <SettingField id="s-next" label="次にやること" help={`すぐ手をつけられる行動を1つ（${LIMITS.nextAction}文字以内）`} error={errors.nextAction}>
          <input id="s-next" className="input" value={form.nextAction} placeholder="例：仕訳の基本を3問解く" onChange={(e) => setForm({ ...form, nextAction: e.target.value })} aria-invalid={!!errors.nextAction} aria-describedby="s-next-help s-next-err" />
        </SettingField>
        <SettingField id="s-cue" label="学習のきっかけ" help="例：昼食後にコーヒーを淹れたら（任意）" error={errors.cue}>
          <input id="s-cue" className="input" value={form.cue} placeholder="〇〇したら、学習を始める" onChange={(e) => setForm({ ...form, cue: e.target.value })} aria-invalid={!!errors.cue} aria-describedby="s-cue-help s-cue-err" />
        </SettingField>
        <SettingField id="s-target" label="「学習を始める」の目標時間（分）" help="目安です。時間になっても自動では終了・記録しません。" error={errors.targetMinutes}>
          <input id="s-target" className="input input-num" type="number" inputMode="numeric" min={LIMITS.targetMin} max={LIMITS.targetMax} value={form.targetMinutes} onChange={(e) => setForm({ ...form, targetMinutes: e.target.value })} aria-invalid={!!errors.targetMinutes} aria-describedby="s-target-help s-target-err" />
        </SettingField>
        <button type="submit" className="btn btn-primary btn-sm settings-save" disabled={busy}>
          {busy ? '保存中…' : '保存する'}
        </button>
      </form>

      <section className="settings-block" aria-labelledby="s-data">
        <h2 id="s-data" className="section-title">データ</h2>
        <p className={`storage-note${v === 'memory' ? ' is-warn' : ''}`} role={v === 'memory' ? 'alert' : undefined}>
          {v === 'indexeddb' && 'この端末のブラウザ内（IndexedDB）に保存しています。'}
          {v === 'localStorage' && 'この端末のブラウザ内（localStorage）に保存しています。'}
          {v === 'memory' && 'このブラウザでは保存領域を使えません。画面を閉じると記録は消えます。プライベートブラウズを解除するか、別のブラウザでお使いください。'}
          {v !== 'memory' && ' PCとスマホのデータは自動では同期されません。ブラウザのデータ削除で消えることがあるため、ときどきバックアップを書き出してください。'}
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
          <li>ログイン・広告・解析ツールはありません。データは外部に送信しません。</li>
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
        <p className="help">このアプリで追加した記録と設定をすべて消去します。確認済みの累計17時間36分は残ります。</p>
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
        description={`このアプリでの記録${state.records.length}件（${formatMinutes(state.records.reduce((s, r) => s + r.minutes, 0))}）と設定を消去します。バックアップがないと元に戻せません。`}>
        <div className="dialog-actions stacked">
          <button type="button" className="btn btn-outline" onClick={exportJson} data-autofocus>先にバックアップを書き出す</button>
          <button type="button" className="btn btn-danger" onClick={async () => {
            try {
              await actions.replaceAll({ ...DEFAULT_SETTINGS }, []);
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

function toForm(s: SettingsT) {
  return { subject: s.subject, nextAction: s.nextAction, cue: s.cue, targetMinutes: String(s.targetMinutes) };
}

function SettingField({ id, label, help, error, children }: { id: string; label: string; help: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
      <p id={`${id}-help`} className="help">{help}</p>
      <FieldError id={`${id}-err`}>{error}</FieldError>
    </div>
  );
}

function RestoreDialog({ data, onClose, onExport }: { data: { settings: SettingsT; records: StudyRecord[]; exportedAt: string | null } | null; onClose: () => void; onExport: () => void }) {
  const { state, actions } = useStore();
  const [busy, setBusy] = useState(false);
  if (!data) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  return (
    <Dialog open onClose={onClose} title="バックアップから復元しますか？" role="alertdialog" busy={busy}
      description={<>
        <p>ファイル：記録{data.records.length}件・累計 {formatMinutes(totalMinutes(data.records))}{data.exportedAt ? `（${formatShortDate(localDate(new Date(data.exportedAt)))}に書き出し）` : ''}</p>
        <p>現在：記録{state.records.length}件・累計 {formatMinutes(totalMinutes(state.records))}</p>
        <p>現在の記録と設定は、ファイルの内容に置き換わります。</p>
      </>}>
      <div className="dialog-actions stacked">
        <button type="button" className="btn btn-outline" onClick={onExport} disabled={busy} data-autofocus>先に現在のデータを書き出す</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await actions.replaceAll(data.settings, data.records);
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
      {hasSettings && (
        <label className="check-row">
          <input type="checkbox" checked={takeSettings} onChange={(e) => setTakeSettings(e.target.checked)} />
          <span>次にやること・きっかけも引き継ぐ（現在未設定の項目のみ）</span>
        </label>
      )}
      <FieldError id="legacy-err">{null}</FieldError>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>やめる</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || (chosen.length === 0 && !(takeSettings && hasSettings))} onClick={async () => {
          setBusy(true);
          try {
            const s = { ...state.settings };
            if (takeSettings) {
              if (!s.nextAction && data.nextAction) s.nextAction = data.nextAction;
              if (!s.cue && data.cue) s.cue = data.cue;
            }
            const n = await actions.addRecords(chosen.map((c) => c.record), s);
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

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
  }
}

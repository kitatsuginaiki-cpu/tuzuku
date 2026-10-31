import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconChevronLeft } from './Icons';
import { Dialog } from './Dialog';
import { useStore } from '../store';

export function Logo({ as: Tag = 'p' }: { as?: 'p' | 'h1' | 'span' }) {
  return (
    <Tag className="logo">
      つづく<span className="logo-dot">。</span>
    </Tag>
  );
}

/** 一時的な画面（学習中・学習終了・記録・設定）の上部バー */
export function TopBar({ title, onBack, backLabel }: { title: string; onBack?: () => void; backLabel?: string }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button type="button" className="icon-btn topbar-back" onClick={onBack} aria-label={backLabel ?? '戻る'}>
          <IconChevronLeft size={22} />
        </button>
      ) : (
        <span className="topbar-spacer" />
      )}
      <p className="topbar-title">{title}</p>
      <span className="topbar-spacer" />
    </header>
  );
}

/** 画面遷移時に見出しへフォーカスを移す（スクリーンリーダーで現在地が伝わるように） */
export function useFocusHeading<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    // 初回表示ではフォーカスを奪わない
    if (document.body.dataset.navigated === '1') ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {children}
    </p>
  );
}

interface EditTextProps {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  placeholder?: string;
  help?: string;
  tooLongMessage: string;
  onSave: (value: string) => Promise<void>;
  allowEmpty?: boolean;
}

/** 1行テキストの編集ダイアログ（次にやること・きっかけ） */
export function EditTextDialog(p: EditTextProps) {
  const [value, setValue] = useState(p.initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (p.open) {
      setValue(p.initial);
      setErr('');
    }
  }, [p.open, p.initial]);
  const { actions } = useStore();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = value.replace(/\s+/g, ' ').trim();
    if (v.length > p.maxLength) {
      setErr(p.tooLongMessage);
      return;
    }
    setBusy(true);
    try {
      await p.onSave(v);
      p.onClose();
      actions.toast('保存しました。');
    } catch {
      setErr('保存できませんでした。入力は保持しています。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  const over = value.length > p.maxLength;
  return (
    <Dialog open={p.open} onClose={p.onClose} title={p.title} busy={busy}>
      <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="edit-text">
          {p.label}
        </label>
        <input
          id="edit-text"
          className="input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (err) setErr('');
          }}
          placeholder={p.placeholder}
          aria-invalid={!!err || over}
          aria-describedby="edit-text-help edit-text-count edit-text-err"
          enterKeyHint="done"
          autoComplete="off"
        />
        <div className="field-meta">
          <p id="edit-text-help" className="help">
            {p.help}
          </p>
          <p id="edit-text-count" className={`count${over ? ' is-over' : ''}`}>
            {value.length}/{p.maxLength}
          </p>
        </div>
        <FieldError id="edit-text-err">{err || (over ? p.tooLongMessage : '')}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={p.onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || over} aria-busy={busy}>
            {busy ? '保存中…' : '保存する'}
          </button>
        </div>
        {p.allowEmpty !== false && p.initial && (
          <p className="help dialog-foot">空欄にして保存すると「未設定」に戻ります。</p>
        )}
      </form>
    </Dialog>
  );
}

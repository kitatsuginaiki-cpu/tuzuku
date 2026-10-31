import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 説明文（aria-describedby） */
  description?: ReactNode;
  /** 閉じる操作を一時的に無効化（保存中など） */
  busy?: boolean;
  role?: 'dialog' | 'alertdialog';
}

/**
 * ネイティブ <dialog> による確認・編集ダイアログ。
 * showModal() でフォーカスを閉じ込め、Esc で閉じ、閉じたら開いた要素へフォーカスを戻す。
 */
export function Dialog({ open, title, onClose, children, description, busy, role = 'dialog' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement;
      try {
        el.showModal();
      } catch {
        el.setAttribute('open', '');
      }
      // 最初の入力欄、なければ最初のボタンへ
      const first = el.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not(.dialog-x)');
      first?.focus();
    } else if (!open && el.open) {
      el.close();
      const o = opener.current as HTMLElement | null;
      if (o && typeof o.focus === 'function' && document.contains(o)) o.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        // 背景クリックで閉じる（入力中の誤操作を避けるため、busy 時は無効）
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      {open && (
        <div className="dialog-inner">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          {description && (
            <div id={descId} className="dialog-desc">
              {description}
            </div>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}

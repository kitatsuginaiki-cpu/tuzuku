import { useEffect, useState } from 'react';
import { useStore } from '../store';

const DISMISS_KEY = 'tsuzuku-ios-install-dismissed';
const REMIND_AFTER_MS = 14 * 86400_000;

/** iPhone/iPad の Safari で、ホーム画面に追加せずに開いているか */
export function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return ios && !standalone;
}

/**
 * 保存についての警告（今日の画面の先頭）。
 * - 保存できない（メモリだけ）：閉じると消えることをはっきり伝える。閉じられない。
 * - iPhone の Safari のまま：しばらく開かないと消えることがあるので、ホーム画面への追加を案内する（閉じられる）。
 */
export function StorageNotice({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const [ios, setIos] = useState(false);
  useEffect(() => {
    if (!isIosBrowserTab()) return;
    try {
      const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (Date.now() - t < REMIND_AFTER_MS) return;
    } catch {
      /* 読めなくても案内は出す */
    }
    setIos(true);
  }, []);

  if (state.storageKind === 'memory') {
    return (
      <section className="notice is-danger" role="alert" aria-labelledby="notice-mem">
        <h2 id="notice-mem" className="notice-title">
          記録が保存されていません
        </h2>
        <p>
          このブラウザでは端末に保存できないため、画面を閉じると記録が消えます。プライベートブラウズを解除するか、別のブラウザで開いてください。続ける場合は、終わる前に設定の「バックアップをコピー」で控えてください。
        </p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/settings')}>
          バックアップへ
        </button>
      </section>
    );
  }
  if (ios) {
    return (
      <section className="notice" aria-labelledby="notice-ios">
        <h2 id="notice-ios" className="notice-title">
          ホーム画面に追加して使ってください
        </h2>
        <p>
          Safari で開いたままだと、しばらく開かない間に記録が消えることがあります（iPhone の仕様）。共有ボタン
          <span aria-hidden="true">（□↑）</span>→「ホーム画面に追加」から開くと、記録が残りやすくなります。
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {
              /* ignore */
            }
            setIos(false);
          }}
        >
          あとで（14日後にまた表示）
        </button>
      </section>
    );
  }
  return null;
}

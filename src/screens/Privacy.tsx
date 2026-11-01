import { TopBar, useFocusHeading } from '../components/common';

export function Privacy({ navigate }: { navigate: (r: string) => void }) {
  const h1 = useFocusHeading<HTMLHeadingElement>();
  return (
    <div className="screen privacy prose">
      <TopBar title="プライバシー" onBack={() => navigate('/friends')} backLabel="仲間に戻る" />
      <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
        データの扱い
      </h1>
      <section>
        <h2 className="h2">ログインしないとき</h2>
        <p>記録・習慣・設定は、この端末のブラウザの中（IndexedDB）にだけ保存されます。どこにも送信されません。</p>
      </section>
      <section>
        <h2 className="h2">ログインしたとき（同期）</h2>
        <p>
          別の端末でも同じ記録を使えるよう、習慣・記録・見直し・設定をサーバー（Supabase）に保存します。これらは
          <strong>本人だけが読める</strong>ようにデータベースの行単位で制限しています（Row Level Security）。仲間を含め、他の人は読めません。
        </p>
        <p>ログインにはメールアドレスを使います。パスワードは保存しません。</p>
      </section>
      <section>
        <h2 className="h2">仲間に見えるもの</h2>
        <ul className="bullets">
          <li>表示名とアイコンの色</li>
          <li>「仲間に見せる」をオンにした習慣の、名前・今日やったか（やった／小さな一手／休み／まだ）・直近7日でやった日数・積み上げの合計</li>
          <li>キャラクターをオンにしている場合は、その習慣の表情</li>
          <li>あなたが送ったスタンプ（相手にだけ見えます）</li>
        </ul>
        <p>共有は習慣ごとに選べ、<strong>既定はオフ</strong>です。</p>
      </section>
      <section>
        <h2 className="h2">仲間に見えないもの</h2>
        <ul className="bullets">
          <li>記録の中身・メモ・始めた時刻・しおり・きっかけ</li>
          <li>共有をオフにした習慣</li>
          <li>メールアドレス</li>
        </ul>
      </section>
      <section>
        <h2 className="h2">ないもの</h2>
        <p>ランキング、コメント、既読表示、位置情報、広告、外部への分析送信はありません。スタンプは1日・相手ごとに3回までです。</p>
      </section>
      <section>
        <h2 className="h2">やめるとき</h2>
        <p>
          グループはいつでも抜けられます。「仲間」タブの「アカウントを削除」で、サーバー上のあなたのデータ（同期した記録・共有・スタンプ・参加）をすべて削除できます。この端末の記録は残り、設定画面から書き出せます。
        </p>
      </section>
    </div>
  );
}

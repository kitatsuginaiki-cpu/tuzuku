# つづく。v5 実装前監査と設計判断

作成：2026-11-01｜対象：v5デザイン（01_UI_reference）、v5仕様書、v3.1試作コード

## 1. v5 と v3.1 の主な差分

| 観点 | v3.1 | v5（今回の実装） |
|---|---|---|
| 主CTA | 「20分」「2分」の並列 | 「学習を始める」1つを主、「2分だけ始める」を低強度の副CTA |
| 学習中 | ダイアログ内タイマー | 専用画面（残り時間・目標・進捗バー・一時停止/中断/学習を終える） |
| 学習終了 | 種別・分数・次回・メモの5項目フォーム | 実時間（修正可）＋今日やったこと＋次の一歩（任意）の3項目 |
| 再開 | ホーム下部に追加ブロック | ホーム全体が「また、ここから。」へ状態変化 |
| 記録 | 14日グラフを常時表示（0件でも空バー） | 基準値＋実記録一覧。グラフは実記録がある時だけ |
| ホーム情報 | 累計・今週日数・前回記録など多数 | 次にやること・主CTA・きっかけのみ |
| ナビ | 今日・記録・設定の3タブ | 今日・記録の2つ。設定はヘッダー（PCは左ナビ下部） |

## 2. v3.1 で見つかった不備（根拠と対処）

| # | 不備 | 根拠（v3.1 app.js） | 影響 | v5での対処 |
|---|---|---|---|---|
| 1 | **保存失敗でも「保存しました」と表示し、フォームを閉じる** | `saveRecord`/`finishForm` が `persist()` を待たずに `closeDialog()`→`notify('保存しました')` | 入力消失・誤った成功表示（仕様の「入力を保持して再試行」に違反） | 書き込み完了を await。失敗時は入力保持＋仕様文言のエラー＋再試行 |
| 2 | **基準日以前の記録で二重計上** | 手動記録の日付制限が `day<=今日` のみ | 2026-10-07以前の学習を追加すると1,056分と重複 | 学習日は2026-10-08以降のみ許可。旧データ移行でも基準日以前は既定で除外 |
| 3 | 状態全体を1つのJSONで上書き | `idbPut(state)` | 1回の失敗で全体が古いまま／書き込み競合 | `records` ストアと `kv` ストアを分離。終了保存は「記録追加＋進行中セッション削除＋次の一歩更新」を1トランザクションで原子的に実行 |
| 4 | 一時停止中に「学習を終える」→戻れない | `finishSession` が `pausedAt` を設定し戻り導線なし | 誤タップで計測が止まる | `completing` 状態を導入。戻ると、終了画面にいた時間は一時停止扱いで計測再開 |
| 5 | 利用イベントログを常時蓄積 | `addEvent('open')` 等 3,000件 | 仕様の「解析しない」方針と不整合、データ肥大 | 廃止。保存するのは設定・進行中セッション・学習記録のみ |
| 6 | `confirm()` ネイティブダイアログ多用 | 破棄・削除・復元・消去 | 文言制御不可、デザイン不一致、「記録して終了／記録せず終了／戻る」の3択不可 | `<dialog>` によるアクセシブルな確認（フォーカス移動・Esc・復帰） |
| 7 | 1分未満の計測を1分に切り上げ | `Math.max(1, round(...))` | 実際にしていない学習時間の記録 | 1分未満は「1分未満」と表示し、分数をユーザーが入力するまで保存不可 |
| 8 | 複数タブで状態が食い違う | 同期なし | 片方で終了・片方で再保存 | BroadcastChannel で変更を通知し再読込。保存は記録IDで冪等 |
| 9 | 時間は壁時計で計算（良い点） | `elapsedMs` | — | 踏襲。`setInterval` は表示更新のみ。加えてバックグラウンド復帰時に注意文を表示 |

## 3. 実装リスクと扱い

- **バックグラウンド中の計測**：ブラウザはタブ非表示中にタイマーを止めることがある。開始時刻・一時停止累計・現在時刻から算出するので表示は復帰時に正しくなる。ただし離脱時間＝学習時間とは限らないため、終了画面で必ず確認・修正できる。
- **iOSのPWA保存領域**：Safari は一定期間使われないサイトのデータを削除することがある。ホーム画面に追加したPWAは対象外とされるが端末差がある → 設定画面でJSONバックアップを案内し、`navigator.storage.persist()` を要求。
- **端末間同期なし**：PCとスマホは別データ。画面上でも明示する。
- **2日閾値**：`src/lib/config.ts` の `RESUME_GAP_DAYS` で変更可能。

## 4. 状態機械

```
セッション:  (なし) --start--> running <--pause/resume--> paused
             running|paused --finish--> completing --back--> 直前の状態（completing中の時間は一時停止扱い）
             completing --save(成功)--> (なし) + 記録1件
             running|paused --中断→記録して終了--> completing
             running|paused --中断→記録せず終了(確認)--> (なし)
保存:        idle -> saving -> saved | error(入力保持, 再試行可)
ホーム:      active があれば「学習中の画面に戻る」
             実記録あり かつ 最終学習日から RESUME_GAP_DAYS 日以上 → resume
             次にやること未設定 → empty   それ以外 → default
```

## 5. データモデル（IndexedDB `tsuzuku-v5`）

- `kv/settings`：`subject`（既定「簿記3級」）, `nextAction`(≤80字), `cue`(≤60字), `targetMinutes`(既定20)
- `kv/active`：`id, mode('standard'|'two_minute'), title, subject, targetSeconds, startedAt(ms), status, pausedAt, pausedMs, completingAt, statusBeforeComplete`
- `records`（keyPath `id`）：`id, studyDate(YYYY-MM-DD, ローカル日付), startedAt(ISO|null), endedAt(ISO|null), minutes(確認済み整数), measuredSeconds, pausedSeconds, title, note, source('timer'|'manual'|'import_v3'), createdAt, updatedAt, category?`
- **基準値はコード定数**（1,056分・2026-10-07）。累計＝基準値＋Σ`minutes`。基準値から個別記録は作らない。
- バックアップ形式：`{format:'tsuzuku-backup', schemaVersion:1, exportedAt, baseline, settings, records}`。進行中セッションは含めない。

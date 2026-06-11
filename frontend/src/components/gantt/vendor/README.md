# vendor/ — frappe-gantt v1.2.2 ベンダリング

このディレクトリは npm パッケージ **frappe-gantt v1.2.2**
(https://github.com/frappe/gantt) の `src/` をコピーし、
本プロジェクト向けに修正したものです。

- 出典: frappe-gantt v1.2.2（node_modules/frappe-gantt/src/ より）
- ライセンス: MIT（下記全文）。Copyright (c) 2024 Frappe Technologies Pvt. Ltd.
- CSS はベンダリング済みの `../frappe-gantt.vendor.css`（dist/frappe-gantt.css 由来）を
  継続利用するため、`index.js` の `import './styles/gantt.css'` は削除している。
- 型は `index.d.ts` が既存の ambient 宣言（src/types/frappe-gantt.d.ts の
  `declare module 'frappe-gantt'`）を流用して提供する。

## 本プロジェクトでの変更点（オリジナルとの差分）

### index.js
1. `import './styles/gantt.css'` を削除（CSS は frappe-gantt.vendor.css で読み込む）。
2. `render()`: `options.scroll_to === null` のときは `set_scroll_position()` を
   呼ばない（再描画のたびに today へ瞬間移動していたのを抑止）。
3. `refresh(tasks)`: 再描画の前後で「左端に見えている日付」を保存・復元する
   （gantt_start のシフト分を補正）。保存→refresh のたびに視界が飛ぶのを修正。
4. infinite_padding の mousewheel 連結処理: 再描画中は scroll_to を退避して
   today スクロールが走らないようにした（既定では infinite_padding=false で無効）。
5. バードラッグ: mousemove 中はスナップせず生の dx でバーを動かし、
   mouseup（ドロップ確定）時に `get_snap_position` でビューモードの単位へ
   スナップしてから `date_change` を発火する（リサイズも同様）。
   確定処理は svg 上の mouseup ではなく document の mouseup で行う
   （svg の外で離しても確定するように）。
6. ドラッグ中のオートスクロール: ポインタがコンテナ左右端 40px 以内に来たら
   一定速度でスクロールし、バーをポインタ直下に保つ（requestAnimationFrame）。
   実ドラッグ（mousemove で 10px 超動いて `bar_being_dragged === true`）が
   始まるまではスクロールしない（端のバーを押下保持しただけで日付が
   変わってしまうのを防ぐ）。
7. `get_snap_position()`: ゼロ方向への切り捨てだった丸めを「最寄りのスナップ
   位置への四捨五入」に変更。
8. スクロールハンドラ / set_scroll_position: upper-text が見つからない場合に
   例外で落ちないよう null ガードを追加。
9. `refresh()` の scrollLeft 補正: `date_utils.diff(…, 'month')` が同一日付でも
   0.03 を返す（upstream の `+ getDate()/31` 補正）ため、offset_units を
   `Math.round` で整数に丸め、Month ビューでの累積ドリフトを防止。
10. `destroy()` を追加: document に登録した mouseup リスナーの解除と
    オートスクロール rAF の停止を行う（`$destroy_fns` に解除関数を蓄積）。
    React 側（FrappeGantt.tsx）のアンマウント時に DOM 破棄前に呼ぶ。
    型は `index.d.ts` で補っている。

### bar.js
- `update_bar_position()`: ドラッグ中（`gantt.dragging_in_progress`）は
  `date_changed()` を呼ばない（date_change はドロップ確定時に 1 回だけ発火）。

### arrow.js
- `calculate_path()` を書き換え: 矢印は from バーの「右端中央」から出て
  to バーの「左端中央」に刺さる三次ベジェ曲線（C コマンド）。
  後続バーが左にある場合は右に出てから回り込む S 字。同じ行で左へ戻る場合は
  下に膨らませる。`data-from` / `data-to` 属性と矢じり（m -5 -5 l 5 5 l -5 5）は
  従来どおり維持（ページ側の矢印クリック削除が依存）。

### defaults.js
- `infinite_padding` の既定値を `true` → `false` に変更
  （端に近づくと列を継ぎ足して scrollLeft を付け替える挙動が
  「瞬間移動・ズレ」の原因だったため）。

### 変更なし
- date_utils.js / svg_utils.js / popup.js は v1.2.2 のまま。

## ライセンス（MIT）

The MIT License (MIT)

Copyright (c) 2024 Frappe Technologies Pvt. Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

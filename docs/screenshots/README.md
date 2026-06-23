# ページ別スクリーンショット（brain-pro 連携用）

このフォルダは brain-pro の「ページ別スクリーンショット」機能の **取り込み規約のサンプル** です。
リポジトリを brain-pro の「コード連携」に接続しておくと、ここに置いた画像が
ページ(URL slug)ごとに自動で取り込まれ、ギャラリー表示されます。

## 規約

```
docs/screenshots/
├─ login.png                  →  ページ /login
├─ dashboard/
│   ├─ main.png               →  /dashboard（キャプション: main）
│   └─ empty.png              →  /dashboard（キャプション: empty）
└─ orders/
    └─ list/
        └─ filled.png         →  /orders/list（キャプション: filled）
```

- **フォルダ階層 = ページの URL slug**（`docs/screenshots/orders/list/` → `/orders/list`）
- **ファイル名 = キャプション/状態名**（`empty.png` → 「empty」）。
  直下に置いた `login.png` のようにフォルダが無い場合は、ファイル名がそのまま slug（`/login`）になります。
- 対応拡張子: `.png` `.jpg` `.jpeg` `.webp` `.gif`（1枚あたり最大 10MB）

## 取り込み方法

1. brain-pro の「コード連携」で GitHub リポジトリ（PAT）を接続する。
2. 「ページ別スクリーンショット」画面で **GitHubから取り込む** を押す
   （コード連携の同期にも同梱され、自動取り込みされます）。
3. ファイルの git sha が変わった分だけ再取得し、リポジトリから削除した分は brain-pro 側からも消えます。

> GitHub を使わずに、画面の「追加」から **直接アップロード / 画像URL / Figma の共有リンク（ライブ埋め込み）**
> でページに紐づけることもできます。

このフォルダ内の `*.png` はサンプル（プレースホルダ）です。実際のスクリーンショットに差し替えてください。

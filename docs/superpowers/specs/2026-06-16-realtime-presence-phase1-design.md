# Phase 1 — Liveblocks リアルタイム・プレゼンス（オンライン表示＋ライブカーソル）設計

作成日: 2026-06-16 / ブランチ: feat/methodology-pipeline

> これは「全画面オンライン同時編集＋マウス位置リアルタイム共有」という大目標の **第1段階（プレゼンス基盤）** の設計。後続フェーズ（共同編集 CRDT＝業務フロー／表／オブジェクトマップ）は別 spec。

## 確定事項（このブレスト）
- 基盤 = **Liveblocks（ホスティング）**。着手順 = **プレゼンス先行**。
- RBAC 既存仕様の踏襲を承認: **メンバー未設定プロジェクトは同一組織の全員が編集可 → プレゼンスも組織全体に可視**（追加ガードなし）。
- マイナー設定は推奨デフォルトを採用: アバターのフォールバック `avatarUrl → 頭文字 → email ローカル部` / カーソル更新 **100ms スロットル** / カーソルは **同一サブページのみ**表示 / トークン TTL は Liveblocks デフォルト。
- **前提（ユーザー手当て）**: `LIVEBLOCKS_SECRET_KEY`（`sk_…`）が必要。コードは**グレースフルデグレード**（キー未設定でも各ページは通常表示、プレゼンスのみ非表示）で先行実装可。

## 0. 目的とスコープ
brain-pro に Liveblocks の **プレゼンス専用**コラボを追加: プロジェクト単位の **「オンラインの人」アバタースタック** と **ライブカーソル**。Liveblocks の秘密鍵はブラウザに渡さず、既存の `JwtAuthGuard` ＋ `ProjectAccessService` RBAC を再利用する認証付き NestJS エンドポイントでトークンを発行する。

**In scope (Phase 1):** プロジェクト単位の room、サーバ刻印のアイデンティティ（name/email/avatar/color）、プレゼンス（現在ページ＋カーソル）、プロジェクトレイアウトに1つのアバタースタック＋1つのカーソルオーバーレイを設置し全サブページを自動カバー。

**Out of scope（後続フェーズ）:** 共同ドキュメント編集（CRDT/Yjs/Storage）、フロー／表の共同編集、コメント、フォローモード、選択共有、**キャンバス世界座標に正確なカーソル**（SwimlaneCanvas / ObjectMapCanvas）。データ形状に `space` 弁別子を予約し、後でキャンバスを **room/auth 変更ゼロ**でアップグレード可能にする。

## 1. アーキテクチャ概要
```
Browser (Next.js App Router, "use client")
  Liveblocks client (createClient + authEndpoint)
        │  POST /api/liveblocks/token   { projectId }
        │  Authorization: Bearer <localStorage 'accessToken'>
        ▼
NestJS backend (global 'api' prefix, global JwtAuthGuard)
  LiveblocksController.token()
    → API キー呼び出しを拒否 (request.user.apiKeyId があれば 403)
    → IssueLiveblocksTokenUseCase
         → ProjectAccessService.resolveProjectAccess(projectId, userId)   // RBAC ゲート
         → UserRepository.findById(userId)                                // name/avatarUrl（軽量）
         → deterministicColor(userId)
         → @liveblocks/node prepareSession(...).allow(room, READ|FULL).authorize()
    → 生の Liveblocks { body, status } を返す
        ▼
Liveblocks hosted service  ── WebSocket ──>  room `project:{projectId}` の全クライアント
```
- **トークン方式:** Liveblocks **access token**（`prepareSession` + `session.allow(roomId,…)` + `session.authorize()`）。サーバ権威の `authEndpoint` フロー（ブラウザ `publicApiKey` モードは RBAC を迂回するため不採用）。
- **アイデンティティはトークンの不変 `userInfo` にサーバ刻印**（偽装不可）。**可変プレゼンス**（page + cursor）はクライアント設定だが、非権威の表示用データなので安全。

## 2. バックエンド — Liveblocks トークン発行エンドポイント
### 2.1 エンドポイント
`POST /api/liveblocks/token`（新規 `LiveblocksController`、`@Controller('liveblocks')` → グローバル `api` プレフィックスで `/api/liveblocks/token`）。**`@Public()` にしない** — グローバル `APP_GUARD` の `JwtAuthGuard` が `Authorization: Bearer <jwt>` を検証し `request.user` を埋める。`@CurrentUser() user: CurrentUserPayload`（`{ id, email }`）で読む。

### 2.2 リクエスト DTO
```ts
// backend/src/presentation/dto/liveblocks-token.dto.ts
export class IssueLiveblocksTokenDto {
  @IsString() @IsNotEmpty()
  projectId!: string;
}
```
body に `projectId` を直接受ける。backend が正規 room id `project:${projectId}` を**自分で**組み立てるので、クライアントは任意 room スコープを送り込めない。

### 2.3 ハンドラフロー（`IssueLiveblocksTokenUseCase`）
1. **マシンキー拒否。** `JwtAuthGuard` は API キー（`x-api-key` / `Bearer sk_…`）も受理し `request.user = { id, email:'', apiKeyId, projectId }` を設定する（`jwt-auth.guard.ts:44-63`）。プレゼンスは対話的ブラウザセッション専用 — **`request.user.apiKeyId` があれば `ForbiddenError`**（マシンキーでプレゼンストークンを発行させない／`email:''` で空ラベルカーソルを作らせない）。
2. **RBAC ゲート。** `projectAccessService.resolveProjectAccess(projectId, user.id)` → `'EDIT' | 'VIEW' | null`。`null` なら `ForbiddenError`（403）。`GET /api/projects/:projectId/my-access` の裏にある既存 RBAC をそのまま再利用。
3. **軽量アイデンティティ取得。** `CurrentUserPayload` は `{ id, email }` のみ。アバタースタック用に `name` + `avatarUrl` が要るので `UserRepository.findById(user.id)` を使う。**`GetCurrentUserUseCase` は使わない**（組織ロールの N+1 ルックアップがあり、頻繁にリフレッシュされるこのホットエンドポイントには不要）。
4. **決定的カラー。** `user.id` をハッシュ → 固定 ~12 色パレットの index（`presence-colors.ts`、フロントとミラー）。サーバ権威なので全クライアントが一致、端末/セッション跨ぎでも安定。
5. **トークン発行。**
   ```ts
   const liveblocks = new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY! });
   const session = liveblocks.prepareSession(user.id, {
     userInfo: { name: name ?? email.split('@')[0], email, avatarUrl, color },
   });
   const roomId = `project:${projectId}`;
   session.allow(roomId, level === 'EDIT' ? session.FULL_ACCESS : session.READ_ACCESS);
   const { body, status } = await session.authorize();
   ```
   `level` を `READ_ACCESS`/`FULL_ACCESS` に正直にマッピング（Phase 1 に Storage は無いが、Phase 2 で同 room に Storage を足した瞬間に意図せぬ書込権限を与えないため）。
6. **生の Liveblocks レスポンスを返す。** SDK クライアントは逐語の `{ body, status }` を期待。**`new Response(body)` は使わない**（この NestJS/Express backend では未使用）。`@Res({ passthrough: true })` を使う:
   ```ts
   @Post('token')
   async token(@CurrentUser() user, @Body() dto, @Res({ passthrough: true }) res) {
     const { body, status } = await this.useCase.execute({ userId: user.id, apiKeyId: user.apiKeyId, projectId: dto.projectId });
     res.status(status);
     return JSON.parse(body); // body は Liveblocks の JSON 文字列
   }
   ```

### 2.4 トークン寿命 / 失効
`prepareSession` トークンは短命でクライアント SDK が自動リフレッシュし、その都度 RBAC を再評価する → メンバー剥奪は1トークンサイクル内にプレゼンス停止。任意で TTL を短縮可。トークンは永続化せず、**DB テーブル追加なし**。

## 3. Room トポロジ
**プロジェクト単位 1 room:** room id = `project:{projectId}`（コロン名前空間。将来の `doc:{id}` 等を綺麗に名前空間化）。

**なぜ per-project（per-page/per-document/per-org でない）:**
- 「オンラインの人」は**サブページを跨ぐ**必要がある: `/tasks` の人と `/object-map` の人が互いに見える。per-project なら `useOthers()` がプロジェクト内全員の和集合になり、跨ぎ表示が無料。
- RBAC が**プロジェクト 1:1**（`ProjectAccessService` は `projectId` を取る）なので認可が単純・正確。
- per-page は遷移ごとに再接続、per-org はアクセス外プロジェクトのプレゼンス漏洩、per-document は Phase 2 の編集事項（Phase 1 は Storage 無しなので無価値＝YAGNI）。

**1 room 内ではページを `presence.page`（クライアント設定）で区別。** 1 room から2ビューを導出: (a) アバタースタック = プロジェクト全員、(b) カーソル = `presence.page === myPage` のピアのみ。

**接続ライフサイクル:** `RoomProvider` をプロジェクトレイアウトに `id={`project:${projectId}`}` で設置。サブページ遷移では**再接続しない**（同一 key）。`projectId` 変更時のみ remount → 旧 room 退室／新 room 入室＋新トークン発行。

**非プロジェクトルート**（`/dashboard` ルート、組織設定）は `projectId` 無し → room 無し＝プレゼンス非活性。Phase 1 では許容。

## 4. プレゼンス＆アイデンティティのデータ形状
アイデンティティ（サーバ＝信頼）とプレゼンス（クライアント＝安価）を分離する。

### 4.1 UserMeta（サーバ刻印・不変。トークンの `userInfo` 由来）
```ts
type UserMeta = {
  id: string; // user.id（Liveblocks connectionId とは別）
  info: {
    name: string;             // 表示名（無ければ email ローカル部）
    email: string;
    avatarUrl: string | null; // フィールド名は avatarUrl（GetCurrentUserOutput に一致。avatar ではない）
    color: string;            // user.id 由来の決定的カラー（サーバ割当）
  };
};
```
`useSelf().info` / `useOthers()[i].info` で参照。アバター画像/ラベル、カーソル名ピル＋色に使う。偽装不可。

### 4.2 Presence（クライアント設定・可変）
```ts
type Presence = {
  page: string;                          // usePathname() の論理ページキー 例 "/dashboard/projects/abc/object-map"
  cursor: { x: number; y: number } | null; // ポインタが面を離れる/アイドルで null
  space: 'screen';                       // 座標空間の弁別子。Phase 1 は 'screen'
};
```
初期プレゼンス: `{ page: pathname, cursor: null, space: 'screen' }`。Phase 1 に **selection/focus/editing フィールドは無し**（編集フェーズの領分）。Storage は `never`/`{}` 型。

### 4.3 カーソル座標空間 — Phase 1 = スクリーン/ビューポート座標
- **取得:** 全画面オーバーレイ（`position: fixed; inset: 0`）が `pointermove` で `cursor = { x: e.clientX, y: e.clientY }`、document の `pointerleave` で `cursor: null`。
- **描画:** オーバーレイが `fixed; inset: 0` なのでピアの `clientX/clientY` が**オーバーレイ内座標に1:1**（計算不要）。通常のスクロール DOM ページで動く最小の正解。
- **正直な注意:** スクロール位置/ウィンドウサイズが異なる2ユーザーは、同じ**ビューポート**位置にカーソルを見る（同じ**コンテンツ**位置ではない）。プレゼンスの**気配**用途（Figma-lite）には許容で、簡潔さのため意図的に選択。
- **フィルタ:** ピアのカーソルは `other.presence.cursor && other.presence.page === myPage` のときだけ描画。アバタースタックは `page` を無視（プロジェクト全員表示）。

### 4.4 キャンバス向け前方互換（記載のみ・今は作らない）
後でカーソルをキャンバス**コンテンツ**に固定したくなったら `cursor` に world 変種を足し `space` を切替える:
- **SwimlaneCanvas**（React Flow v12）: インスタンスの `screenToFlowPosition()` で取得、world 座標保存、`space: 'flow-world'`。各ビューアの描画で React Flow が変換を再適用 → world→screen が各自で正しく対応。
- **ObjectMapCanvas**（自作 SVG、`ViewTransform {x,y,k}`）: 既存 `screenToWorld`（`worldX=(clientX-rect.left-v.x)/v.k`）で取得、逆変換 `screenX=worldX*v.k+v.x` で描画、`space: 'objectmap-world'`。

`space` 弁別子により、カーソル描画側が room id/トークン/トポロジを変えずに**ページ毎**に正しい逆変換を選べる。Phase 1 は小さいまま、キャンバス精度は局所的な後付けに。

### 4.5 スロットル
`createClient({ throttle: 100 })`（Liveblocks 推奨のカーソル周期）。16ms（~60fps）はホスティング規模では過剰・ノイズ。`cursor` 更新は `pointermove` 時のみ、`page` 更新はルート変更時のみ（安価）。アバタースタックは **`connectionId` でなく `user.id` で重複排除**（複数タブ＝複数 connectionId）。`@liveblocks/*` のバージョンを固定。

## 5. フロントエンド統合（Next.js App Router）
`@liveblocks/client` + `@liveblocks/react`（React 18.2 / Next 14.0.4 互換）を導入。backend は `@liveblocks/node`。**プレゼンス系コンポーネントは全て `'use client'`。**

### 5.1 型付きクライアント設定 — `frontend/src/lib/liveblocks.config.ts`（`'use client'`）
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export const liveblocksClient = createClient({
  throttle: 100,
  authEndpoint: async (room) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const projectId = (room ?? '').replace(/^project:/, '');
    const res = await fetch(`${API_URL}/api/liveblocks/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId }),
    });
    return res.json(); // Liveblocks は逐語の { token } body を期待
  },
});

// Storage は {} / never 型 — Phase 1 に CRDT は無い。
export const { RoomProvider, useOthers, useSelf, useMyPresence, useUpdateMyPresence } =
  createRoomContext<Presence, {}, UserMeta>(liveblocksClient);
```
- `lib/api.ts` / `use-project-access.ts` と**同一の** `localStorage.getItem('accessToken')` + Bearer パターンを再利用。グローバル `JwtAuthGuard` を通る。CORS は既存の `FRONTEND_URL` 許可 + brain-pro 正規表現でカバー済み。
- **next-auth の `SessionProvider` 経由にしない**（存在するがこのアプリのフローでは不活性）— localStorage トークンを使う。
- `createRoomContext` は確立した `@liveblocks/react` パターン（React 18 で動作）。バージョン固定で API 変動を回避。

### 5.2 設置点 — 既存のプロジェクトレイアウト（ルート dashboard レイアウトではない）
**`frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx` に組み込む。** 既存・`'use client'` 済み・`useParams()` で `projectId` 導出済み・`ReadOnlyProvider`/`useProjectAccess` 供給済み。既存ツリーの**内側**に包む:
```tsx
'use client'
export default function ProjectScopedLayout({ children }) {
  const params = useParams();
  const projectId = (params?.projectId as string) ?? null;
  const pathname = usePathname();
  const { level, canEdit, loading } = useProjectAccess(projectId); // 既存

  if (!projectId) {
    return <ReadOnlyProvider value={{ canEdit, level, loading }}><ReadOnlyBanner />{children}</ReadOnlyProvider>;
  }
  return (
    <ReadOnlyProvider value={{ canEdit, level, loading }}>
      <RoomProvider id={`project:${projectId}`} initialPresence={{ page: pathname, cursor: null, space: 'screen' }}>
        <ReadOnlyBanner />
        <ProjectPresenceHeader />   {/* WhoIsOnline。room の内側で描画 */}
        {children}
        <LiveCursors />             {/* fixed inset-0 オーバーレイ。room の内側 */}
        <PresencePageSync />        {/* usePathname → updateMyPresence({ page }) */}
      </RoomProvider>
    </ReadOnlyProvider>
  );
}
```
- `useParams()` はここで正しい（`[projectId]` 動的セグメントはこのレイアウトの所有）。ルート `(dashboard)/layout.tsx` では効かない → 意図的にプロジェクトレイアウトに設置。
- `useProjectAccess` は実効 `accessLevel` をキャッシュ済みなので、任意でトークンエンドポイントに渡して重複ルックアップを省ける — ただし**バックエンドは必ず権威的に再解決**（セキュリティゲートでクライアント申告のアクセスレベルを信頼しない）。

### 5.3 SSR / ハイドレーション安全性
Liveblocks は `window`/WebSocket に触れ `localStorage` を読むのでサーバで走ってはならない。既に `'use client'` のプロジェクトレイアウト内設置で担保。room 読取の子は `<ClientSideSuspense fallback={null}>` で包む（接続中の room は throw せず何も描かない）。**グレースフルデグレード:** `LIVEBLOCKS_SECRET_KEY` 欠如やトークン 500 でもレイアウトは `{children}` を描画 — プレゼンスが出ないだけ。

### 5.4 コンポーネント（`frontend/src/components/presence/`）
- **`WhoIsOnline.tsx`** — `useOthers()` + `useSelf()`。重なる円形アバター（`info.avatarUrl` か `info.name` の頭文字、ring/bg = `info.color`）、最大 ~5 + 「+N」溢れ、ツールチップ = 名前。**`info`/`user.id` で重複排除**（複数タブ）。`ProjectPresenceHeader` 経由で room 内のプロジェクトシェル上部に設置。
- **`LiveCursors.tsx`** — 単一の `position:fixed; inset:0; pointer-events:none; z-50` div。スロットルした `pointermove` → `updateMyPresence({ cursor: { x, y } })`、`pointerleave` → `cursor: null`。`useOthers()` を map、`cursor && presence.page === myPage` でフィルタ、`left: x, top: y` に SVG カーソル＋名前ピルを `info.color` で描画。`pointer-events:none` でクリックを塞がない。
- **`PresencePageSync.tsx`** — `usePathname()` の `useEffect` → `updateMyPresence({ page })`（遷移時のみ）。
- **`presence-colors.ts`** — backend のハッシュとミラーする共有パレット定数（実際に配信される `info.color` の真実源は backend 側）。

## 6. ロールアウト対象ページ
Phase 1 は **1 provider + 1 アバタースタック + 1 カーソルオーバーレイ**をプロジェクトレイアウトに一度だけ設置。`/dashboard/projects/[projectId]/...` 配下の全ページ（asis, tobe, object-map, requirements, dfd, er-diagram, flows, charter, members, knowledge, tasks, roadmap, … 確認済み ~35 ルート）がそのレイアウト内で描画されるため、**ページ毎の配線ゼロ**でオンライン表示＋カーソルを継承する。
- アバタースタックはサブページに関係なくプロジェクト全員、カーソルは同一サブページのピアのみ（`presence.page` 一致）。
- 非プロジェクトルートは Phase 1 では何も無し。
- 新規プロジェクトページ追加にプレゼンスコードは**不要**（自動継承）。
- 将来の唯一のページ毎作業は任意のキャンバス world カーソル（オーバーレイが `presence.space` を読む）— それでもオーバーレイは1つ、新規 room なし。

## 7. 環境変数＆秘密
| 変数 | 場所 | 値 |
|---|---|---|
| `LIVEBLOCKS_SECRET_KEY` | **backend のみ**（`backend/.env`、ホスト/Vercel backend 設定） | `sk_…` — サーバ専用、`frontend/` で決して import しない、`NEXT_PUBLIC_*` にしない |
| `NEXT_PUBLIC_API_URL` | frontend（既存） | 本番 backend URL。既定 `http://localhost:5021` |

- **`NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY` は使わない** — RBAC を迂回させないため `authEndpoint`（サーバ権威）フロー必須。
- `LIVEBLOCKS_SECRET_KEY` は**全** backend 環境（local/preview/prod）に設定（無いとトークン 500、フロントはグレースフルデグレード）。
- **CI grep ガード（推奨）:** `frontend/` 配下に `sk_` または `LIVEBLOCKS_SECRET` が出たらビルド失敗。安価で高価値の漏洩防止。

## 8. テスト方針
**ユニット（Liveblocks ネットワーク無し）:**
- `IssueLiveblocksTokenUseCase`: `ProjectAccessService` + `UserRepository` + `Liveblocks` SDK をモック。`null` → 403／`apiKeyId` あり → 403／`VIEW` → `READ_ACCESS`、`EDIT` → `FULL_ACCESS`／`userInfo` に name/email/avatarUrl/color／room id は常に `project:${projectId}`。
- `deterministicColor(userId)`: 同 id → 同 index、分布の健全性。
- DTO バリデーション（`projectId` 欠落/空 → 400）。
- コントローラ: 生の Liveblocks `{ body, status }` を正しく返す（`@Res({ passthrough })` で status 伝播）、`new Response` でない。
- フロントの純粋部分: 同一ページのカーソルフィルタ述語、user.id 重複排除、color フォールバック/頭文字。

**結合（backend, supertest）:**
- `POST /api/liveblocks/token`: メンバーの実 JWT → 200（Liveblocks トークン body）。API キー → 403。アクセス不可プロジェクト → 403。`Authorization` 無し → 401（グローバルガード）。

**ライブ多クライアント smoke（手動・2ブラウザ/2アカウント）:**
- 同一プロジェクト・別サブページ → 双方アバタースタックに出る／カーソルは跨ぎ非表示。
- 同一サブページ → カーソル可視・正しい色・正しい名前ラベル・ポインタ追従。
- サブページ遷移 → 再接続フリッカ無し・アバタースタック安定。
- プロジェクト切替 → 旧 room 退室・新 room 入室（新発行）・アバタースタック更新。
- タブを閉じる / `pointerleave` → カーソル消滅（自動除去＋明示 `cursor:null`）。
- DevTools Network でブラウザバンドルに `sk_` 秘密が**無い**こと、`authEndpoint` POST が `accessToken` Bearer を運ぶことを確認。

## 9. リスクと緩和
1. **キャンバス座標の忠実度** — Phase 1 カーソルはスクリーン相対。Swimlane/ObjectMap（各自パン/ズーム）ではノードに固定されない。意図的 YAGNI、`space` 弁別子を予約。object-map で先に試す人へ期待値設定。
2. **秘密漏洩**（最大リスク） — backend 専用 + CI grep ガード（§7）。
3. **失効までの猶予** — RBAC 再評価はトークンリフレッシュ時のみ。プレゼンス専用なので許容、任意で TTL 短縮。即時失効は Phase 2。
4. **RBAC 後方互換の癖** — `ProjectAccessService`（lines 72-74）は `ProjectMember` 0件で全 org メンバーに EDIT。**承認済み: 未設定プロジェクトでプレゼンスが組織全体可視で良い。**
5. **VIEW ユーザもプレゼンス送出** — READ_ACCESS でもプレゼンス可。who's-online の意図通り（許容）。
6. **トークンエンドポイントのコスト** — 軽量 `UserRepository.findById`（N+1 の `GetCurrentUserUseCase` でない）＋ `resolveProjectAccess`（索引付き数クエリ）。発行頻度は低い。
7. **401 で静かにプレゼンス無効** — グレースフルデグレード（children 描画）、Bearer 転送を検証、アプリの再ログインフローに整合。
8. **接続/課金** — ホスティング Liveblocks は MAU/接続課金。開いたプロジェクトタブ毎に1接続。広域展開前に同時接続数を見積もる。throttle 100ms で帯域は控えめ。
9. **アプリ JWT 期限切れ時のリフレッシュ** — セッション途中で `accessToken` が切れると次の `authEndpoint` が 401 でプレゼンス断。Phase 1 は許容。

## 10. 触るファイル
**Backend**
- `backend/src/presentation/controllers/liveblocks.controller.ts`（新規）
- `backend/src/application/use-cases/liveblocks/issue-liveblocks-token.use-case.ts`（新規）
- `backend/src/presentation/dto/liveblocks-token.dto.ts`（新規）
- `backend/src/infrastructure/services/presence-colors.ts`（新規・色の真実源）
- `backend/src/app.module.ts`（コントローラ＋ use-case 登録。`ProjectAccessService` + `UserRepository` は供給済み）
- `backend/src/application/index.ts`（バレルエクスポートしているなら use-case を追加）
- `backend/package.json`（`@liveblocks/node` 追加）
- `backend/.env` + ホスト/Vercel backend env（`LIVEBLOCKS_SECRET_KEY` 追加）

**Frontend**
- `frontend/src/lib/liveblocks.config.ts`（新規）
- `frontend/src/lib/presence-colors.ts`（新規・フォールバック描画用ミラー）
- `frontend/src/components/presence/WhoIsOnline.tsx`（新規）
- `frontend/src/components/presence/LiveCursors.tsx`（新規）
- `frontend/src/components/presence/PresencePageSync.tsx`（新規）
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx`（修正・既存ツリーを `RoomProvider` で包む）
- `frontend/package.json`（`@liveblocks/client`, `@liveblocks/react` 追加）

**CI（推奨）**
- `frontend/` 配下に `sk_` / `LIVEBLOCKS_SECRET` が出たら失敗する grep ガード。

## 後続フェーズ（参考・別 spec）
- **Phase 2:** 共同編集基盤（Yjs/Liveblocks Storage、同 room に追加）＋業務フロー（React Flow）共同編集＋キャンバス world カーソル。
- **Phase 3:** 表のエクセル系グリッド置換＋共同編集（survey 済み: 共有テーブルプリミティブが無く全テーブル手書き＝移行が必要。マトリクス系は動的列でアウトライア）。
- **Phase 4:** オブジェクトマップ等 残りエディタ。

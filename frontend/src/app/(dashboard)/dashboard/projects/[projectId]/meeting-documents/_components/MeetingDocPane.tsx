'use client';

// ミーティングドキュメント本体ペイン。
// INTERNAL  = Liveblocks(Yjs) ルームに接続した Tiptap リアルタイム共同エディタ。
//             （ツールバーは自前の Tailwind 実装。Markdown 入力/貼り付けにも対応）
// GOOGLE_DOC = 外部 Google Document/Spreadsheet/Drive の URL（自動保存＋読み取り専用プレビュー）。
//
// window 依存（Liveblocks/Tiptap）のため、親ページから next/dynamic(ssr:false) で読み込むこと。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClientSideSuspense } from '@liveblocks/react';
import { RoomProvider } from '@/lib/liveblocks.config';
import { useLiveblocksExtension } from '@liveblocks/react-tiptap';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
// 共同編集カーソル等のスタイル（ツールバーは自前実装なので lb-tiptap ツールバーCSSには依存しない）。
import '@liveblocks/react-tiptap/styles.css';
import {
  Loader2,
  ExternalLink,
  Undo2,
  Redo2,
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Strikethrough,
  Code as CodeIcon,
  Code2,
  List as ListIcon,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Check,
  Download,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoomConnectionGuard } from '@/components/presence/RoomConnectionGuard';
import {
  meetingDocumentApi,
  type MeetingDocument,
  type GoogleTabs,
} from '@/lib/meeting-documents';
import { driveApi } from '@/lib/knowledge';

interface Props {
  doc: MeetingDocument;
  canEdit: boolean;
  /** GOOGLE_DOC の URL 保存（親で PATCH）。 */
  onSaveGoogleUrl: (url: string) => void;
  /** 選択中の Google タブ（Docs の tabId / Sheets の gid。URL の ?gtab= と同期）。 */
  gtab?: string | null;
  /** タブバー/サイドメニューからのタブ切替（親で URL の ?gtab= を書き換える）。 */
  onSelectTab?: (tabId: string) => void;
}

export default function MeetingDocPane({ doc, canEdit, onSaveGoogleUrl, gtab, onSelectTab }: Props) {
  if (doc.kind === 'GOOGLE_DOC') {
    return (
      <GoogleDocPane
        doc={doc}
        canEdit={canEdit}
        onSaveGoogleUrl={onSaveGoogleUrl}
        gtab={gtab}
        onSelectTab={onSelectTab}
      />
    );
  }
  // INTERNAL: ドキュメントごとの Liveblocks ルームへ接続。
  return (
    <RoomProvider
      id={doc.roomId}
      initialPresence={{ page: `meetingdoc:${doc.id}`, cursor: null, space: 'screen' }}
    >
      {/* タブ非表示/アイドル時は切断（Yjs は再接続時に再同期）。編集中は短めのアイドルにする。 */}
      <RoomConnectionGuard idleMs={10 * 60 * 1000} />
      <ClientSideSuspense
        fallback={
          <div className="flex h-full items-center justify-center bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        }
      >
        {() => <CollaborativeEditor editable={canEdit} />}
      </ClientSideSuspense>
    </RoomProvider>
  );
}

function CollaborativeEditor({ editable }: { editable: boolean }) {
  const liveblocks = useLiveblocksExtension();
  const editor = useEditor({
    editable,
    extensions: [
      liveblocks,
      // 共同編集では履歴を Liveblocks 側が管理するため Tiptap の history は無効化。
      StarterKit.configure({ history: false }),
      // Markdown 入力（# 見出し / **太字** / - リスト 等）と貼り付け/コピーの双方向変換。
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
        breaks: true,
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[300px] px-4 py-3 focus:outline-none [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:text-gray-600 [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:rounded-md [&_pre]:p-3 [&_code]:text-pink-600',
      },
    },
  });

  return (
    <div className="flex h-full flex-col bg-white">
      {editor && (
        <div className="shrink-0 border-b border-gray-200">
          {editable ? (
            <EditorToolbar editor={editor} />
          ) : (
            // 閲覧専用でも自動保存バッジだけ出す（共同編集中の保存状態を明示）。
            <div className="flex items-center justify-end px-3 py-1.5">
              <AutoSaveBadge />
            </div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// 自動保存バッジ（Liveblocks/Yjs によりリアルタイムに保存される旨を明示）。
function AutoSaveBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600"
      title="編集内容はリアルタイムに自動保存されます"
    >
      <Check className="h-3 w-3" />
      自動保存
    </span>
  );
}

// 自前ツールバー（Tailwind）。Liveblocks 既定ツールバーは別CSS依存で崩れるため置き換え。
function EditorToolbar({ editor }: { editor: Editor }) {
  const tbtn = (active: boolean) =>
    cn(
      'inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900',
      active && 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    );
  const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" />;

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
      <button
        type="button"
        title="元に戻す"
        onClick={() => editor.chain().focus().undo().run()}
        className={tbtn(false)}
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="やり直す"
        onClick={() => editor.chain().focus().redo().run()}
        className={tbtn(false)}
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <Divider />
      <button
        type="button"
        title="見出し1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={tbtn(editor.isActive('heading', { level: 1 }))}
      >
        <Heading1 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="見出し2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={tbtn(editor.isActive('heading', { level: 2 }))}
      >
        <Heading2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="見出し3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={tbtn(editor.isActive('heading', { level: 3 }))}
      >
        <Heading3 className="h-4 w-4" />
      </button>
      <Divider />
      <button
        type="button"
        title="太字"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={tbtn(editor.isActive('bold'))}
      >
        <BoldIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="斜体"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={tbtn(editor.isActive('italic'))}
      >
        <ItalicIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="打ち消し線"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={tbtn(editor.isActive('strike'))}
      >
        <Strikethrough className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="インラインコード"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={tbtn(editor.isActive('code'))}
      >
        <CodeIcon className="h-4 w-4" />
      </button>
      <Divider />
      <button
        type="button"
        title="箇条書き"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={tbtn(editor.isActive('bulletList'))}
      >
        <ListIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="番号付きリスト"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={tbtn(editor.isActive('orderedList'))}
      >
        <ListOrdered className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="引用"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={tbtn(editor.isActive('blockquote'))}
      >
        <Quote className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="コードブロック"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={tbtn(editor.isActive('codeBlock'))}
      >
        <Code2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="区切り線"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className={tbtn(false)}
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="ml-auto flex items-center gap-2 pl-2">
        <span
          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
          title="Markdown 記法（# 見出し / **太字** / - リスト など）で入力・貼り付けできます"
        >
          Markdown対応
        </span>
        <AutoSaveBadge />
      </div>
    </div>
  );
}

// Google Docs/Sheets/Slides/Drive の URL を読み取り専用プレビュー用 /preview URL へ変換。
// 例: .../document/d/<id>/edit → .../document/d/<id>/preview
//     .../spreadsheets/d/<id>/edit#gid=0 → .../spreadsheets/d/<id>/preview
//     drive.google.com/file/d/<id>/view → /preview、open?id=<id> → /file/d/<id>/preview
// gtab（Docs の tabId / Sheets の gid）指定時は該当タブを開く。
// Sheets の gid はフラグメントだけだと iframe の src 変更が再読込にならないため query にも付ける。
export function toGooglePreviewUrl(raw: string, gtab?: string | null): string {
  const u = raw.trim();
  // docs.google.com/{document|spreadsheets|presentation}/d/<id>... または drive.google.com/file/d/<id>...
  const m = u.match(
    /^(https?:\/\/(?:docs|drive)\.google\.com\/(document|spreadsheets|presentation|file)\/d\/[A-Za-z0-9_-]+)/,
  );
  if (m) {
    const base = `${m[1]}/preview`;
    if (gtab && m[2] === 'document') {
      return `${base}?tab=${encodeURIComponent(gtab)}`;
    }
    if (gtab && m[2] === 'spreadsheets') {
      const gid = encodeURIComponent(gtab);
      return `${base}?gid=${gid}#gid=${gid}`;
    }
    return base;
  }
  // drive.google.com/open?id=<id> / uc?id=<id> 形式
  const id = u.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (id && /drive\.google\.com/.test(u)) {
    return `https://drive.google.com/file/d/${id[1]}/preview`;
  }
  return u;
}

const GOOGLE_URL_RE = /^https?:\/\/(docs|drive)\.google\.com\//;

function GoogleDocPane({ doc, canEdit, onSaveGoogleUrl, gtab, onSelectTab }: Props) {
  const saved = doc.googleDocUrl ?? '';
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  // 直近に保存依頼した値（多重保存の抑止）。
  const lastSentRef = useRef(saved);

  // ドキュメント切替時は入力を同期しなおす（draft 残留を防ぐ）。
  useEffect(() => {
    setDraft(doc.googleDocUrl ?? '');
    lastSentRef.current = doc.googleDocUrl ?? '';
    setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // 自動保存（更新式）: 入力が止まって 800ms 後に PATCH。手動「保存」ボタンは廃止。
  useEffect(() => {
    if (!canEdit) return;
    const next = draft.trim();
    if (next === lastSentRef.current) return;
    // 打鍵途中の不正URLでは保存しない（空 or 妥当な Google URL のみ）。
    if (next !== '' && !GOOGLE_URL_RE.test(next)) return;
    setStatus('saving');
    const t = setTimeout(() => {
      lastSentRef.current = next;
      onSaveGoogleUrl(next);
      setStatus('saved');
    }, 800);
    return () => clearTimeout(t);
  }, [draft, canEdit, onSaveGoogleUrl]);

  const url = saved.trim();
  const isValid = GOOGLE_URL_RE.test(url);
  const previewSrc = isValid ? toGooglePreviewUrl(url, gtab) : '';

  // Google 側のタブ構成（Docsのタブ / Sheetsのシート）。一覧のキャッシュを初期値に、
  // 表示時に自動で再取得して最新化する（タブバーとサイドメニューの元データ）。
  const [tabsInfo, setTabsInfo] = useState<GoogleTabs | null>(doc.googleTabs ?? null);
  const [tabsRefreshing, setTabsRefreshing] = useState(false);
  // 同一 doc+URL での多重取得を防ぐ（drive 状態の再セット等で effect が再発火するため）。
  const tabsRefreshedKeyRef = useRef<string | null>(null);

  const refreshTabs = useCallback(async () => {
    setTabsRefreshing(true);
    try {
      const updated = await meetingDocumentApi.refreshGoogleTabs(doc.id);
      setTabsInfo(updated.googleTabs ?? null);
      // サイドメニューの「会議別ドキュメント」ツリーにもタブを反映させる。
      window.dispatchEvent(new Event('meeting-docs-changed'));
    } catch {
      // 未連携・共有漏れ等はタブバーを出さないだけ（本文取り込み側で具体的に案内される）。
    } finally {
      setTabsRefreshing(false);
    }
  }, [doc.id]);

  // 本文の DB 取り込み（Drive 連携経由）。
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fetchedAt = doc.fetchedAt ? new Date(doc.fetchedAt).toLocaleString('ja-JP') : null;
  const handleFetch = async () => {
    setFetching(true);
    setFetchMsg(null);
    try {
      const updated = await meetingDocumentApi.fetchGoogle(doc.id);
      const chars = updated.fetchedContent?.length ?? 0;
      setFetchMsg({
        kind: 'ok',
        text: `本文を取り込みました（${updated.fetchedTitle ?? ''}・${chars.toLocaleString()}文字）`,
      });
    } catch (e) {
      setFetchMsg({ kind: 'err', text: e instanceof Error ? e.message : '取り込みに失敗しました' });
    } finally {
      setFetching(false);
    }
  };

  // Google Drive 連携状態（本文取り込みに必要）。getAuthUrl は authUrl＋接続状態を返す。
  // refresh token は AES-256-GCM でサーバーに暗号化保存され、レスポンスには出ない。
  const [drive, setDrive] = useState<
    { connected: boolean; email: string | null; authUrl: string } | null
  >(null);
  const [connecting, setConnecting] = useState(false);
  const loadDrive = useCallback(async () => {
    try {
      const res = await driveApi.getAuthUrl(doc.projectId);
      setDrive({
        connected: !!res.connected,
        email: res.email ?? null,
        authUrl: res.authUrl,
      });
    } catch {
      // Drive 機能が未構成（管理者の環境設定が必要）の場合は連携 UI を出さない。
      setDrive(null);
    }
  }, [doc.projectId]);
  useEffect(() => {
    void loadDrive();
  }, [loadDrive]);

  // 表示時（および保存URLの変更時）にタブ構成を自動更新（Drive 連携済みのときだけ）。
  // URL 変更時はサーバー側でキャッシュがクリアされるため、ここで取り直して即反映する。
  useEffect(() => {
    if (!isValid || !drive?.connected) return;
    const key = `${doc.id}:${url}`;
    if (tabsRefreshedKeyRef.current === key) return;
    tabsRefreshedKeyRef.current = key;
    void refreshTabs();
  }, [isValid, drive?.connected, doc.id, url, refreshTabs]);

  // タブバーの表示順（Google 側の並び順）。
  const sortedTabs = useMemo(
    () => (tabsInfo ? [...tabsInfo.tabs].sort((a, b) => a.index - b.index) : []),
    [tabsInfo],
  );
  const showTabBar = isValid && !!tabsInfo && tabsInfo.kind !== 'other' && sortedTabs.length > 0;

  // 認証ウィンドウで OAuth → 完了をポーリングして接続状態を反映。
  const handleConnect = useCallback(() => {
    if (!drive?.authUrl) return;
    window.open(drive.authUrl, 'drive-oauth', 'width=520,height=680');
    setConnecting(true);
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const res = await driveApi.getAuthUrl(doc.projectId);
        if (res.connected) {
          setDrive({ connected: true, email: res.email ?? null, authUrl: res.authUrl });
          setConnecting(false);
          clearInterval(timer);
        }
      } catch {
        // ポーリング継続
      }
      if (tries > 40) {
        setConnecting(false);
        clearInterval(timer);
      }
    }, 2500);
  }, [drive, doc.projectId]);

  // プレビューの拡大率（スプレッドシート等。50%〜200%）。ドキュメント切替でリセット。
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    setZoom(1);
  }, [doc.id]);
  const zoomBy = (delta: number) =>
    setZoom((z) => Math.min(2, Math.max(0.5, Math.round((z + delta) * 100) / 100)));

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canEdit}
          placeholder="https://docs.google.com/（ドキュメント / スライド / スプレッドシート）..."
          className="h-8 min-w-0 flex-1 text-sm"
        />
        {canEdit && (
          <span className="inline-flex w-[88px] items-center justify-center gap-1 text-xs">
            {status === 'saving' ? (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                保存中…
              </span>
            ) : status === 'saved' ? (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <Check className="h-3.5 w-3.5" />
                自動保存
              </span>
            ) : (
              <span className="text-gray-300">自動保存</span>
            )}
          </span>
        )}
        {canEdit && isValid && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleFetch}
            disabled={fetching}
            title="Google本文を取得してアプリのDBにも保存します（要 Drive 連携）"
          >
            {fetching ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            本文を取り込む
          </Button>
        )}
        {/* Google Drive 連携状態（本文取り込みに必要）。 */}
        {drive &&
          (drive.connected ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
              title={drive.email ? `連携アカウント: ${drive.email}` : 'Google Drive 連携済み'}
            >
              <HardDrive className="h-3.5 w-3.5" />
              Drive連携済み
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleConnect}
              disabled={connecting}
              className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              title="Google Drive と連携すると、ドキュメント/スライド/シートの本文を取り込めます（refresh token はサーバーに暗号化保存）"
            >
              {connecting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <HardDrive className="mr-1 h-3.5 w-3.5" />
              )}
              {connecting ? '連携待ち…' : 'Google Driveと連携'}
            </Button>
          ))}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Google で開く
          </a>
        )}
        {isValid && (
          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-gray-200 bg-white px-1 py-0.5">
            <button
              type="button"
              onClick={() => zoomBy(-0.1)}
              disabled={zoom <= 0.5}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
              title="縮小"
              aria-label="縮小"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center text-[11px] tabular-nums text-gray-600">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomBy(0.1)}
              disabled={zoom >= 2}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
              title="拡大"
              aria-label="拡大"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {/* Google タブバー（Docsのドキュメントタブ / Sheetsのシート）。
          iframe 内の Google 純正タブUIは absolute 配置で位置が使いにくいため、
          アプリ側の通常フローに横スクロール可能なタブバーを置く（?gtab= でサイドメニューとも連動）。 */}
      {showTabBar && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-100 bg-gray-50/60 px-2 py-1.5">
          <span className="flex-shrink-0 pr-1 text-[10px] font-semibold text-gray-400">
            {tabsInfo?.kind === 'spreadsheet' ? 'シート' : 'タブ'}
          </span>
          {sortedTabs.map((t, i) => {
            // gtab 未指定時は先頭タブが表示されている（Google preview の既定）。
            const active = gtab ? gtab === t.id : i === 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTab?.(t.id)}
                title={t.title || '（無題のタブ）'}
                className={cn(
                  'max-w-[180px] flex-shrink-0 truncate rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-blue-300 bg-blue-100 font-medium text-blue-800'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                {t.level > 0 ? `${'›'.repeat(t.level)} ` : ''}
                {t.title || '（無題）'}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => void refreshTabs()}
            disabled={tabsRefreshing}
            title="タブ構成を Google から再取得"
            className="ml-auto flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', tabsRefreshing && 'animate-spin')} />
          </button>
        </div>
      )}
      {/* 取り込み状態（保存済み / 結果 / エラー） */}
      {(fetchMsg || doc.hasFetchedContent) && (
        <div
          className={cn(
            'flex items-center gap-1.5 border-b border-gray-100 px-3 py-1.5 text-xs',
            fetchMsg?.kind === 'err' ? 'text-red-600' : 'text-gray-500',
          )}
        >
          {fetchMsg?.kind === 'err' ? (
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          ) : (
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
          )}
          <span>
            {fetchMsg
              ? fetchMsg.text
              : `DBに取り込み済み${fetchedAt ? `（${fetchedAt}）` : ''}`}
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden bg-gray-50">
        {isValid ? (
          <iframe
            // 読み取り専用プレビュー（編集権限が無くても閲覧可能。スプレッドシート/スライドも対応）。
            // 拡大率は CSS transform で実現（width/height を 1/zoom にして scale で埋める）。
            src={previewSrc}
            title={doc.title || 'Google Document'}
            style={{
              width: `${100 / zoom}%`,
              height: `${100 / zoom}%`,
              transformOrigin: 'top left',
              transform: `scale(${zoom})`,
            }}
            className="border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-400">
            Google ドキュメント / スライド / スプレッドシート / Drive の URL を貼り付けてください（自動保存）。
            <br />
            （docs.google.com / drive.google.com のリンク。閲覧のみでも読み取り専用で表示されます。「本文を取り込む」でシート等の内容をアプリのDBに保存して検索対象にできます）
          </div>
        )}
      </div>
    </div>
  );
}

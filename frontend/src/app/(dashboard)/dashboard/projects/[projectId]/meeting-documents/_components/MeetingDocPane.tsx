'use client';

// ミーティングドキュメント本体ペイン。
// INTERNAL  = Liveblocks(Yjs) ルームに接続した Tiptap リアルタイム共同エディタ。
// GOOGLE_DOC = 外部 Google Document の URL（リンク＋任意の iframe 埋め込み）。
//
// window 依存（Liveblocks/Tiptap）のため、親ページから next/dynamic(ssr:false) で読み込むこと。
import { useState } from 'react';
import { ClientSideSuspense } from '@liveblocks/react';
import { RoomProvider } from '@/lib/liveblocks.config';
import { useLiveblocksExtension, Toolbar, FloatingToolbar } from '@liveblocks/react-tiptap';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import '@liveblocks/react-tiptap/styles.css';
import { Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoomConnectionGuard } from '@/components/presence/RoomConnectionGuard';
import type { MeetingDocument } from '@/lib/meeting-documents';

interface Props {
  doc: MeetingDocument;
  canEdit: boolean;
  /** GOOGLE_DOC の URL 保存（親で PATCH）。 */
  onSaveGoogleUrl: (url: string) => void;
}

export default function MeetingDocPane({ doc, canEdit, onSaveGoogleUrl }: Props) {
  if (doc.kind === 'GOOGLE_DOC') {
    return <GoogleDocPane doc={doc} canEdit={canEdit} onSaveGoogleUrl={onSaveGoogleUrl} />;
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
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[300px] px-4 py-3 focus:outline-none [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
      },
    },
  });

  return (
    <div className="flex h-full flex-col bg-white">
      {editable && editor && (
        <div className="shrink-0 border-b border-gray-200">
          <Toolbar editor={editor} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
      {editable && editor && <FloatingToolbar editor={editor} />}
    </div>
  );
}

function GoogleDocPane({ doc, canEdit, onSaveGoogleUrl }: Props) {
  const [draft, setDraft] = useState(doc.googleDocUrl ?? '');
  const url = doc.googleDocUrl?.trim() || '';
  const isValid = /^https?:\/\/(docs|drive)\.google\.com\//.test(url);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!canEdit}
          placeholder="https://docs.google.com/document/d/..."
          className="h-8 min-w-0 flex-1 text-sm"
        />
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSaveGoogleUrl(draft.trim())}
            disabled={draft.trim() === (doc.googleDocUrl ?? '')}
          >
            保存
          </Button>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Google Docs で開く
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {isValid ? (
          <iframe
            // 埋め込み表示（権限がある場合のみ表示。なければ「開く」から）。
            src={url.includes('/edit') ? url.replace('/edit', '/preview') : url}
            title={doc.title || 'Google Document'}
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-400">
            Google Document の URL を貼り付けて「保存」してください。
            <br />
            （docs.google.com / drive.google.com のリンク）
          </div>
        )}
      </div>
    </div>
  );
}

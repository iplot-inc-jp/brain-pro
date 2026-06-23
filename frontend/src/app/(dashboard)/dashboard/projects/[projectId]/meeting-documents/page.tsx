'use client';

/**
 * ミーティングドキュメント ページ。
 * 会議（Meeting）ごとにドキュメント（議事録・アジェンダ等）を管理する。
 * INTERNAL  = Liveblocks(Yjs)+Tiptap のリアルタイム共同編集。
 * GOOGLE_DOC = 外部 Google Document の URL リンク。
 * 左カラム = 会議を折りたたみフォルダにして、その配下のドキュメントを一覧。
 * 右カラム = 選択したドキュメント本体（window 依存の MeetingDocPane を ssr:false で動的読込）。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { useReadOnly } from '@/components/read-only-context';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Plus,
  Trash2,
  FileText,
  CalendarClock,
  ChevronRight,
  ChevronDown,
  X,
} from 'lucide-react';
import {
  meetingDocumentApi,
  type MeetingDocument,
  type MeetingDocumentKind,
} from '@/lib/meeting-documents';
import { listMeetings, type Meeting } from '@/lib/stakeholders';

// MeetingDocPane は window 依存（Liveblocks/Tiptap）なので ssr:false で動的読込（このページ専用）。
const MeetingDocPane = dynamic(() => import('./_components/MeetingDocPane'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
    </div>
  ),
});

/** ドキュメント種別バッジ（内＝INTERNAL / Google＝GOOGLE_DOC）。 */
function KindBadge({ kind }: { kind: MeetingDocumentKind }) {
  if (kind === 'GOOGLE_DOC') {
    return (
      <span className="flex-shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
        Google
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
      内
    </span>
  );
}

export default function MeetingDocumentsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [documents, setDocuments] = useState<MeetingDocument[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // どの会議で作成中か（meetingId）。null=作成UIを閉じている。
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<MeetingDocumentKind>('INTERNAL');
  const [createTitle, setCreateTitle] = useState('');
  const [createUrl, setCreateUrl] = useState('');
  const [creating, setCreating] = useState(false);

  // 折りたたみ状態（会議ID→折りたたみ中なら true）。既定は展開。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // 選択ドキュメントのタイトル編集ドラフト。
  const [titleDraft, setTitleDraft] = useState('');

  // 会議一覧 + ドキュメント一覧をまとめて取得。
  const loadList = useCallback(
    async (selectAfter?: string) => {
      setLoadingList(true);
      setListError(null);
      try {
        const [mtgs, docs] = await Promise.all([
          listMeetings(projectId),
          meetingDocumentApi.list(projectId),
        ]);
        setMeetings(mtgs);
        setDocuments(docs);
        setSelectedId((prev) => {
          if (selectAfter) return selectAfter;
          if (prev && docs.some((d) => d.id === prev)) return prev;
          return docs[0]?.id ?? null;
        });
      } catch (e) {
        setListError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        setLoadingList(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 左サイドメニューの「会議別ドキュメント」からの遷移（?doc=<id>）で該当ドキュメントを選択。
  const searchParams = useSearchParams();
  const docParam = searchParams.get('doc');
  useEffect(() => {
    if (docParam && documents.some((d) => d.id === docParam)) {
      setSelectedId(docParam);
    }
  }, [docParam, documents]);

  // 会議を order→name でソート。
  const sortedMeetings = useMemo(
    () =>
      [...meetings].sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'),
      ),
    [meetings],
  );

  // 会議ID → ドキュメント配列。
  const docsByMeeting = useMemo(() => {
    const map = new Map<string, MeetingDocument[]>();
    for (const d of documents) {
      const arr = map.get(d.meetingId);
      if (arr) arr.push(d);
      else map.set(d.meetingId, [d]);
    }
    map.forEach((arr) =>
      arr.sort(
        (a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ja'),
      ),
    );
    return map;
  }, [documents]);

  // 選択中のドキュメント（一覧アイテムをそのまま使う。roomId 等フル情報を持つ）。
  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId],
  );

  // 選択が変わったらタイトルドラフトを同期。
  useEffect(() => {
    setTitleDraft(selectedDoc?.title ?? '');
  }, [selectedDoc?.id, selectedDoc?.title]);

  const openCreate = useCallback((meetingId: string) => {
    setCreatingIn(meetingId);
    setCreateKind('INTERNAL');
    setCreateTitle('');
    setCreateUrl('');
    // 作成先の会議は確実に展開しておく。
    setCollapsed((c) => ({ ...c, [meetingId]: false }));
  }, []);

  const closeCreate = useCallback(() => {
    setCreatingIn(null);
    setCreating(false);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!creatingIn) return;
    setCreating(true);
    try {
      const created = await meetingDocumentApi.create(projectId, {
        meetingId: creatingIn,
        kind: createKind,
        title: createTitle.trim() || '無題のドキュメント',
        googleDocUrl:
          createKind === 'GOOGLE_DOC' ? createUrl.trim() || null : null,
      });
      setCreatingIn(null);
      await loadList(created.id);
    } catch {
      /* noop（一覧エラーは loadList が拾う） */
    } finally {
      setCreating(false);
    }
  }, [creatingIn, projectId, createKind, createTitle, createUrl, loadList]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('このドキュメントを削除しますか？')) return;
      try {
        await meetingDocumentApi.remove(id);
        if (selectedId === id) setSelectedId(null);
        await loadList();
      } catch {
        /* noop */
      }
    },
    [selectedId, loadList],
  );

  const toggleFolder = useCallback((key: string) => {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }, []);

  // タイトルのインライン編集を確定（ローカル一覧も更新）。
  const commitTitle = useCallback(async () => {
    if (!selectedDoc) return;
    const next = titleDraft.trim();
    if (next === selectedDoc.title) return;
    try {
      await meetingDocumentApi.update(selectedDoc.id, { title: next });
      setDocuments((list) =>
        list.map((d) => (d.id === selectedDoc.id ? { ...d, title: next } : d)),
      );
    } catch {
      /* noop */
    }
  }, [selectedDoc, titleDraft]);

  // GOOGLE_DOC の URL 保存（自動保存）。ローカル一覧を即時更新（全件再取得しないので
  // 入力中に iframe が再読込されてチラつくのを防ぐ）。
  const handleSaveGoogleUrl = useCallback(
    (url: string) => {
      if (!selectedDoc) return;
      const next = url.trim() === '' ? null : url.trim();
      meetingDocumentApi
        .update(selectedDoc.id, { googleDocUrl: next })
        .then((updated) => {
          setDocuments((list) =>
            list.map((d) => (d.id === selectedDoc.id ? { ...d, googleDocUrl: updated.googleDocUrl } : d)),
          );
        })
        .catch(() => {
          /* noop */
        });
    },
    [selectedDoc],
  );

  const hasMeetings = sortedMeetings.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FileText className="h-5 w-5" style={{ color: '#2563eb' }} />
            ミーティングドキュメント
          </span>
        }
        description="会議ごとにドキュメント（議事録・アジェンダ等）をリアルタイム共同編集、または Google Document へのリンクで管理します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
      />

      <div className="flex h-[calc(100vh-200px)] min-h-[520px] gap-3">
        {/* 左: 会議フォルダ＋ドキュメント一覧 */}
        <div className="flex w-72 flex-shrink-0 flex-col rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">
              会議別ドキュメント
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              </div>
            ) : listError ? (
              <p className="px-2 py-4 text-xs text-red-600">{listError}</p>
            ) : !hasMeetings ? (
              <div className="px-2 py-8 text-center">
                <CalendarClock className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2 text-xs text-muted-foreground">
                  会議がありません。先に会議マスタを登録してください。
                </p>
                <Link
                  href={`/dashboard/projects/${projectId}/meetings`}
                  className="mt-3 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  会議マスタで会議を作成
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {sortedMeetings.map((meeting) => {
                  const meetingDocs = docsByMeeting.get(meeting.id) ?? [];
                  const isCollapsed = collapsed[meeting.id] ?? false;
                  const isCreating = creatingIn === meeting.id;
                  return (
                    <div key={meeting.id}>
                      {/* 会議フォルダヘッダー */}
                      <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-gray-50">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                          onClick={() => toggleFolder(meeting.id)}
                          title={meeting.name}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          )}
                          <CalendarClock className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">
                            {meeting.name}
                          </span>
                          <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                            {meetingDocs.length}
                          </span>
                        </button>
                        {canEdit && (
                          <button
                            className="flex-shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                            onClick={() => openCreate(meeting.id)}
                            disabled={creatingIn !== null}
                            title={`${meeting.name} にドキュメントを作成`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* インライン作成UI */}
                      {isCreating && (
                        <div className="mb-1 ml-3 space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-gray-600">
                              新規ドキュメント
                            </span>
                            <button
                              className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                              onClick={closeCreate}
                              title="閉じる"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="flex gap-1">
                            <button
                              className={cn(
                                'flex-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                                createKind === 'INTERNAL'
                                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                              )}
                              onClick={() => setCreateKind('INTERNAL')}
                            >
                              共同編集（内）
                            </button>
                            <button
                              className={cn(
                                'flex-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                                createKind === 'GOOGLE_DOC'
                                  ? 'border-blue-300 bg-blue-100 text-blue-800'
                                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                              )}
                              onClick={() => setCreateKind('GOOGLE_DOC')}
                            >
                              Google
                            </button>
                          </div>
                          <Input
                            value={createTitle}
                            onChange={(e) => setCreateTitle(e.target.value)}
                            placeholder="タイトル"
                            className="h-7 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleCreate();
                              if (e.key === 'Escape') closeCreate();
                            }}
                          />
                          {createKind === 'GOOGLE_DOC' && (
                            <Input
                              value={createUrl}
                              onChange={(e) => setCreateUrl(e.target.value)}
                              placeholder="https://docs.google.com/...（任意）"
                              className="h-7 text-xs"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleCreate();
                                if (e.key === 'Escape') closeCreate();
                              }}
                            />
                          )}
                          <Button
                            size="sm"
                            className="h-7 w-full text-xs"
                            onClick={() => void handleCreate()}
                            disabled={creating}
                          >
                            {creating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              '作成'
                            )}
                          </Button>
                        </div>
                      )}

                      {/* 会議配下のドキュメント */}
                      {!isCollapsed && (
                        <ul className="mb-1 ml-3 space-y-0.5 border-l border-gray-100 pl-2">
                          {meetingDocs.length === 0 ? (
                            <li className="px-1 py-1 text-[11px] text-muted-foreground">
                              （ドキュメントなし）
                            </li>
                          ) : (
                            meetingDocs.map((d) => (
                              <li key={d.id}>
                                <div
                                  className={cn(
                                    'group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm',
                                    d.id === selectedId
                                      ? 'bg-blue-50 text-blue-700'
                                      : 'hover:bg-gray-50',
                                  )}
                                >
                                  <KindBadge kind={d.kind} />
                                  <button
                                    className="min-w-0 flex-1 truncate text-left"
                                    onClick={() => setSelectedId(d.id)}
                                    title={d.title || '無題のドキュメント'}
                                  >
                                    {d.title || '無題のドキュメント'}
                                  </button>
                                  {canEdit && (
                                    <button
                                      className="flex-shrink-0 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                                      onClick={() => handleDelete(d.id)}
                                      title="削除"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右: 選択ドキュメント本体 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
          {!selectedDoc ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <FileText className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-muted-foreground">
                左からドキュメントを選ぶか作成してください。
              </p>
            </div>
          ) : (
            <>
              {/* ドキュメントヘッダー（タイトル編集 + 種別バッジ） */}
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <KindBadge kind={selectedDoc.kind} />
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  disabled={!canEdit}
                  placeholder="ドキュメント名"
                  className="h-8 max-w-md border-transparent text-sm font-semibold focus-visible:border-input"
                />
              </div>

              {/* 本体ペイン（ドキュメント切替で remount） */}
              <div className="h-[calc(100vh-260px)] min-h-[480px]">
                <MeetingDocPane
                  key={selectedDoc.id}
                  doc={selectedDoc}
                  canEdit={canEdit}
                  onSaveGoogleUrl={handleSaveGoogleUrl}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

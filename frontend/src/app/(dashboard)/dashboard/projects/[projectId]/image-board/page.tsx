'use client';

/**
 * 業務イメージ（スライド）ボード ページ。
 * 図形/矢印/テキスト/画像/手書きを自由配置して 業務の流れを
 * 「1枚のスライド」でラフに描く補完ツール（構造化図 DFD/swimlane/object-map の手前）。
 * キャンバスは Excalidraw を埋め込み、ボード単位で scene(JSON) を保存する。
 * ボード一覧は 領域（SubProject）ごとの折りたたみフォルダでグルーピングする。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
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
  Presentation,
  Image as ImageIcon,
  Check,
  CloudOff,
  ChevronRight,
  ChevronDown,
  Folder,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import {
  imageBoardApi,
  type ImageBoardSummary,
  type ImageBoardDto,
} from '@/lib/image-board';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';
import type { SaveState } from './_components/ExcalidrawBoard';

// Excalidraw は window 依存なので ssr:false で動的読込（このページ専用）。
const ExcalidrawBoard = dynamic(() => import('./_components/ExcalidrawBoard'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
    </div>
  ),
});

/** 未分類グループの擬似キー（subProjectId=null をまとめる）。 */
const UNGROUPED = '__ungrouped__';

export default function ImageBoardPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [boards, setBoards] = useState<ImageBoardSummary[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<ImageBoardDto | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  // どのフォルダで作成中か（領域ID or UNGROUPED）。null=未作成。
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [titleDraft, setTitleDraft] = useState('');

  // 折りたたみ状態（フォルダキー→折りたたみ中なら true）。既定は展開。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [isFullscreen, setIsFullscreen] = useState(false);

  // ボード一覧 + 領域マスタ。先頭ボードを自動選択。
  const loadList = useCallback(
    async (selectAfter?: string) => {
      setLoadingList(true);
      setListError(null);
      try {
        const [list, subs] = await Promise.all([
          imageBoardApi.list(projectId),
          subProjectApi.list(projectId),
        ]);
        setBoards(list);
        setSubProjects(subs);
        setSelectedId((prev) => {
          if (selectAfter) return selectAfter;
          if (prev && list.some((b) => b.id === prev)) return prev;
          return list[0]?.id ?? null;
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

  // 選択ボードの scene を取得。
  useEffect(() => {
    if (!selectedId) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    setLoadingBoard(true);
    setSaveState('idle');
    imageBoardApi
      .get(selectedId)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        setTitleDraft(b.title);
      })
      .catch(() => {
        if (!cancelled) setBoard(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingBoard(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Escape でフルスクリーン解除（入力中は無視）。
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el?.isContentEditable
      ) {
        return;
      }
      setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // 領域マスタを order→name でソート（フラット）。
  const sortedSubProjects = useMemo(
    () =>
      [...subProjects].sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'),
      ),
    [subProjects],
  );

  // フォルダキー → ボード配列（領域別 + 未分類）。
  const boardsByFolder = useMemo(() => {
    const map = new Map<string, ImageBoardSummary[]>();
    for (const b of boards) {
      const key = b.subProjectId ?? UNGROUPED;
      const arr = map.get(key);
      if (arr) arr.push(b);
      else map.set(key, [b]);
    }
    map.forEach((arr) => {
      arr.sort(
        (a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ja'),
      );
    });
    return map;
  }, [boards]);

  // 表示するフォルダ（全領域 + 未分類は中身がある時のみ）。
  const folders = useMemo(() => {
    const list: { key: string; name: string }[] = sortedSubProjects.map((s) => ({
      key: s.id,
      name: s.name,
    }));
    if ((boardsByFolder.get(UNGROUPED)?.length ?? 0) > 0) {
      list.push({ key: UNGROUPED, name: '未分類' });
    }
    return list;
  }, [sortedSubProjects, boardsByFolder]);

  const handleCreate = useCallback(
    async (folderKey: string) => {
      setCreatingIn(folderKey);
      try {
        const subProjectId = folderKey === UNGROUPED ? null : folderKey;
        const created = await imageBoardApi.create(projectId, {
          title: '無題のボード',
          subProjectId,
        });
        // 作成先フォルダは確実に展開しておく。
        setCollapsed((c) => ({ ...c, [folderKey]: false }));
        await loadList(created.id);
      } catch {
        /* noop（一覧エラーは loadList が拾う） */
      } finally {
        setCreatingIn(null);
      }
    },
    [projectId, loadList],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('このボードを削除しますか？')) return;
      try {
        await imageBoardApi.remove(id);
        if (selectedId === id) setSelectedId(null);
        await loadList();
      } catch {
        /* noop */
      }
    },
    [selectedId, loadList],
  );

  // 領域の移動（select 変更）。value='' は未分類。
  const handleMove = useCallback(
    async (id: string, value: string) => {
      const subProjectId = value === UNGROUPED ? null : value;
      try {
        await imageBoardApi.update(id, { subProjectId });
        await loadList(id);
      } catch {
        /* noop */
      }
    },
    [loadList],
  );

  const commitTitle = useCallback(async () => {
    if (!board) return;
    const next = titleDraft.trim();
    if (next === board.title) return;
    try {
      await imageBoardApi.update(board.id, { title: next });
      setBoard((b) => (b ? { ...b, title: next } : b));
      setBoards((list) =>
        list.map((b) => (b.id === board.id ? { ...b, title: next } : b)),
      );
    } catch {
      /* noop */
    }
  }, [board, titleDraft]);

  const toggleFolder = useCallback((key: string) => {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }, []);

  const hasAnyBoard = boards.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Presentation className="h-5 w-5" style={{ color: '#2563eb' }} />
            業務イメージボード
          </span>
        }
        description="図形・アイコン・テキスト・矢印・画像を自由配置して、業務の流れを1枚のスライドとしてラフに描きます。構造化図（業務フロー/DFD/オブジェクト関係性マップ）の手前のラフ下書きとして使います。ボードは領域ごとのフォルダで整理できます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
      />

      <div className="flex h-[calc(100vh-200px)] min-h-[520px] gap-3">
        {/* 左: ボード一覧（領域フォルダでグルーピング） */}
        <div className="flex w-64 flex-shrink-0 flex-col rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">
              ボード一覧（領域別）
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              </div>
            ) : listError ? (
              <p className="px-2 py-4 text-xs text-red-600">{listError}</p>
            ) : folders.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <ImageIcon className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2 text-xs text-muted-foreground">
                  領域がありません。先に領域マスタを登録してください。
                </p>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => handleCreate(UNGROUPED)}
                    disabled={creatingIn !== null}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    未分類でボードを作成
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {!hasAnyBoard && (
                  <p className="px-1 pb-2 text-[11px] text-muted-foreground">
                    まだボードがありません。領域の「＋」から作成してください。
                  </p>
                )}
                {folders.map((folder) => {
                  const folderBoards = boardsByFolder.get(folder.key) ?? [];
                  const isCollapsed = collapsed[folder.key] ?? false;
                  return (
                    <div key={folder.key}>
                      {/* フォルダヘッダー */}
                      <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-gray-50">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                          onClick={() => toggleFolder(folder.key)}
                          title={folder.name}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          )}
                          <Folder className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700">
                            {folder.name}
                          </span>
                          <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                            {folderBoards.length}
                          </span>
                        </button>
                        {canEdit && (
                          <button
                            className="flex-shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                            onClick={() => handleCreate(folder.key)}
                            disabled={creatingIn !== null}
                            title={`${folder.name} にボードを作成`}
                          >
                            {creatingIn === folder.key ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* フォルダ内のボード */}
                      {!isCollapsed && (
                        <ul className="mb-1 ml-3 space-y-0.5 border-l border-gray-100 pl-2">
                          {folderBoards.length === 0 ? (
                            <li className="px-1 py-1 text-[11px] text-muted-foreground">
                              （ボードなし）
                            </li>
                          ) : (
                            folderBoards.map((b) => (
                              <li key={b.id}>
                                <div
                                  className={cn(
                                    'group flex items-center gap-1 rounded-md px-2 py-1 text-sm',
                                    b.id === selectedId
                                      ? 'bg-blue-50 text-blue-700'
                                      : 'hover:bg-gray-50',
                                  )}
                                >
                                  <button
                                    className="min-w-0 flex-1 truncate text-left"
                                    onClick={() => setSelectedId(b.id)}
                                    title={b.title || '無題のボード'}
                                  >
                                    {b.title || '無題のボード'}
                                  </button>
                                  {canEdit && (
                                    <button
                                      className="flex-shrink-0 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                                      onClick={() => handleDelete(b.id)}
                                      title="削除"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                                {/* 領域の移動 */}
                                {canEdit && (
                                  <div className="px-2 pb-1">
                                    <select
                                      value={b.subProjectId ?? UNGROUPED}
                                      onChange={(e) =>
                                        handleMove(b.id, e.target.value)
                                      }
                                      className="w-full rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-muted-foreground focus:border-blue-400 focus:outline-none"
                                      title="領域を移動"
                                    >
                                      {sortedSubProjects.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.name}
                                        </option>
                                      ))}
                                      <option value={UNGROUPED}>未分類</option>
                                    </select>
                                  </div>
                                )}
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

        {/* 右: キャンバス */}
        <div
          className={cn(
            'relative flex min-w-0 flex-1 flex-col overflow-hidden border border-gray-200 bg-white',
            isFullscreen
              ? 'fixed inset-0 z-50 rounded-none'
              : 'rounded-lg',
          )}
        >
          {!selectedId ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Presentation className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-muted-foreground">
                左からボードを選ぶか、領域の「＋」で新しいボードを作成してください。
              </p>
            </div>
          ) : (
            <>
              {/* ボードヘッダー（タイトル編集 + 保存状態 + フルスクリーン） */}
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  disabled={!canEdit}
                  placeholder="ボード名"
                  className="h-8 max-w-xs border-transparent text-sm font-semibold focus-visible:border-input"
                />
                <SaveStateBadge state={saveState} readOnly={!canEdit} />
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-8 w-8 flex-shrink-0 p-0"
                  onClick={() => setIsFullscreen((v) => !v)}
                  title={isFullscreen ? '全画面を解除（Esc）' : '全画面表示'}
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* Excalidraw 本体（ボード切替で remount。ラッパーを広げると自動で全画面化） */}
              <div className="relative min-h-0 flex-1">
                {loadingBoard || !board ? (
                  <div className="flex h-full items-center justify-center bg-slate-50">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  </div>
                ) : (
                  <ExcalidrawBoard
                    key={board.id}
                    boardId={board.id}
                    initialScene={board.scene}
                    readOnly={!canEdit}
                    onSaveStateChange={setSaveState}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveStateBadge({
  state,
  readOnly,
}: {
  state: SaveState;
  readOnly: boolean;
}) {
  if (readOnly) {
    return <span className="text-xs text-muted-foreground">閲覧のみ</span>;
  }
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> 保存中…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600">
        <Check className="h-3 w-3" /> 保存済み
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-600">
        <CloudOff className="h-3 w-3" /> 保存に失敗
      </span>
    );
  }
  return null;
}

'use client';

/**
 * 教訓登録簿（レッスンズラーンド）ページ。
 *
 * プロジェクトで得た教訓を分類（うまくいった/問題/改善提案）付きで記録する。
 * かんたんテーブル: 分類バッジ（クリックで循環）+ 内容 + 推奨 + 領域 select（任意）。
 * インライン編集（onBlur 保存）+ 作成 + 削除。作法は constraints ページに合わせる。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  lessonApi,
  normalizeLessonKind,
  lessonKindMeta,
  LESSON_KINDS,
  type LessonKind,
  type LessonLearned,
} from '@/lib/pmbok';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';

export default function LessonsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [lessons, setLessons] = useState<LessonLearned[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 作成フォーム（kind + content）。
  const [newKind, setNewKind] = useState<LessonKind>('WENT_WELL');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ls, sps] = await Promise.all([
        lessonApi.list(projectId),
        subProjectApi.list(projectId),
      ]);
      setLessons(ls);
      setSubProjects(sps);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleCreate = useCallback(async () => {
    const content = newContent.trim();
    if (!content) return;
    setCreating(true);
    setError(null);
    try {
      await lessonApi.create(projectId, { content, kind: newKind });
      setNewContent('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }, [newContent, newKind, projectId, load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            教訓登録簿
          </span>
        }
        description="うまくいったこと・問題・改善提案を記録して、次のプロジェクトに活かします（レッスンズラーンド）。"
        help="ふりかえりで出た気づきを分類付きで登録します。「推奨」には次回どうすべきかを書き、必要なら領域（サブプロジェクト）に紐づけます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '上のフォームで分類（うまくいった/問題/改善提案）を選び、内容を入力して「追加」します。',
              '各行の内容・推奨はその場で編集でき、入力欄から離れると自動保存されます。',
              '分類バッジをクリックすると、うまくいった→問題→改善提案 の順に切り替わります。',
              '「領域」を選ぶと、その教訓を特定の領域（サブプロジェクト）に紐づけられます（任意）。',
              '不要になった教訓はゴミ箱ボタンで削除します。',
            ]}
          />
        }
      />

      {/* 作成フォーム（kind + content） */}
      <Card className="bg-white border-gray-200">
        <CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="w-36 space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">分類</label>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as LessonKind)}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="分類"
            >
              {LESSON_KINDS.map((k) => (
                <option key={k} value={k}>
                  {lessonKindMeta[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[240px] space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">
              教訓の内容<span className="ml-1 text-rose-500">*</span>
            </label>
            <input
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              placeholder="例：週次レビューで早期に課題を発見できた"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || !newContent.trim()}
          >
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            追加
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 一覧 */}
      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                      #
                    </th>
                    <th className="w-32 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      分類
                    </th>
                    <th className="min-w-[240px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      内容
                    </th>
                    <th className="min-w-[200px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      推奨（次回どうするか）
                    </th>
                    <th className="w-44 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      領域
                    </th>
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {lessons.map((l, i) => (
                    <LessonRow
                      key={l.id}
                      index={i + 1}
                      lesson={l}
                      subProjects={subProjects}
                      onChanged={load}
                      onError={setError}
                    />
                  ))}
                  {lessons.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ教訓がありません。上のフォームから追加してください。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1行（インライン編集 + onBlur 保存 + 削除）
// ---------------------------------------------------------------------------

function LessonRow({
  index,
  lesson,
  subProjects,
  onChanged,
  onError,
}: {
  index: number;
  lesson: LessonLearned;
  subProjects: SubProjectMaster[];
  onChanged: () => Promise<void> | void;
  onError: (msg: string | null) => void;
}) {
  // 表示はローカルドラフトで持ち、onBlur で差分があるときだけ PATCH する。
  const [content, setContent] = useState(lesson.content);
  const [recommendation, setRecommendation] = useState(lesson.recommendation ?? '');
  const [busy, setBusy] = useState(false);

  // 親で再読込された値に追従する。
  useEffect(() => {
    setContent(lesson.content);
    setRecommendation(lesson.recommendation ?? '');
  }, [lesson.content, lesson.recommendation]);

  const kind = normalizeLessonKind(lesson.kind);

  // 分類バッジ：クリックで うまくいった→問題→改善提案 と循環して即保存。
  const cycleKind = useCallback(async () => {
    const next = LESSON_KINDS[(LESSON_KINDS.indexOf(kind) + 1) % LESSON_KINDS.length];
    setBusy(true);
    onError(null);
    try {
      await lessonApi.update(lesson.id, { kind: next });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [lesson.id, kind, onChanged, onError]);

  // 文字列フィールドの onBlur 保存（content は空なら元値に戻す）。
  const saveText = useCallback(
    async (key: 'content' | 'recommendation', raw: string) => {
      const value = raw.trim();
      if (key === 'content') {
        if (!value || value === lesson.content) {
          setContent(lesson.content);
          return;
        }
      } else if (value === (lesson.recommendation ?? '')) {
        return;
      }
      setBusy(true);
      onError(null);
      try {
        await lessonApi.update(lesson.id, {
          [key]: key === 'content' ? value : value === '' ? null : value,
        });
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [lesson.id, lesson.content, lesson.recommendation, onChanged, onError],
  );

  // 領域（subProjectId）select は変更即保存。
  const saveSubProject = useCallback(
    async (value: string) => {
      const next = value === '' ? null : value;
      if (next === lesson.subProjectId) return;
      setBusy(true);
      onError(null);
      try {
        await lessonApi.update(lesson.id, { subProjectId: next });
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [lesson.id, lesson.subProjectId, onChanged, onError],
  );

  const handleDelete = useCallback(async () => {
    if (!confirm(`教訓「${lesson.content}」を削除しますか？`)) return;
    setBusy(true);
    onError(null);
    try {
      await lessonApi.delete(lesson.id);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [lesson.id, lesson.content, onChanged, onError]);

  return (
    <tr className="border-b border-gray-100 align-top hover:bg-blue-50/30">
      <td className="px-2 py-2 text-xs text-gray-400">
        <span className="inline-flex items-center gap-1">
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          ) : (
            <GraduationCap className="h-3 w-3 text-gray-300" />
          )}
          {index}
        </span>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => void cycleKind()}
          disabled={busy}
          title="クリックで分類を切り替え（うまくいった→問題→改善提案）"
          aria-label={`分類を切り替え（現在：${lessonKindMeta[kind].label}）`}
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-40 ${lessonKindMeta[kind].badge}`}
        >
          {lessonKindMeta[kind].label}
        </button>
      </td>
      <td className="px-3 py-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={(e) => void saveText('content', e.target.value)}
          rows={1}
          placeholder="教訓の内容"
          className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-[#050f3e] hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-3 py-2">
        <textarea
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}
          onBlur={(e) => void saveText('recommendation', e.target.value)}
          rows={1}
          placeholder="次回どうするか"
          className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-800 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={lesson.subProjectId ?? ''}
          onChange={(e) => void saveSubProject(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label="領域"
        >
          <option value="">（領域なし）</option>
          {subProjects.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          title="この教訓を削除"
          aria-label="この教訓を削除"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

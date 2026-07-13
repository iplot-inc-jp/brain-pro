'use client';

/**
 * 実会議（議事録）ページ。会議帯(Meeting)の「1回分の開催実体」を管理する。
 * - 会議帯に紐づく開催回が基本。どの会議帯にも属さない単発/例外会議は「会議帯」を未選択で作成できる。
 * - 一覧：開催日・タイトル・会議帯・出典。行クリックで編集モーダル（議事録本文・決定・ネクストアクション）。
 * - ipro-agent が録画の文字起こしから自動投入するのと同じ API を、この画面の手動追加でも使う。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Plus, Trash2, X, Save, CalendarClock, FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { EditGate } from '@/components/edit-gate';
import { Card, CardContent } from '@/components/ui/card';
import { listMeetings, type Meeting } from '@/lib/stakeholders';
import {
  type MeetingOccurrence,
  type MeetingOccurrenceInput,
  listMeetingOccurrences,
  createMeetingOccurrence,
  updateMeetingOccurrence,
  deleteMeetingOccurrence,
} from '@/lib/meeting-occurrences';

interface Draft {
  title: string;
  meetingId: string; // '' = 単発/例外会議
  heldAt: string; // datetime-local 文字列
  attendees: string;
  agenda: string;
  minutes: string;
  decisions: string;
  nextActions: string;
}

function occToDraft(o: MeetingOccurrence | null): Draft {
  return {
    title: o?.title ?? '',
    meetingId: o?.meetingId ?? '',
    // ISO → datetime-local（分まで）。ズレを避けるため先頭16文字を使う。
    heldAt: o?.heldAt ? o.heldAt.slice(0, 16) : '',
    attendees: o?.attendees ?? '',
    agenda: o?.agenda ?? '',
    minutes: o?.minutes ?? '',
    decisions: o?.decisions ?? '',
    nextActions: o?.nextActions ?? '',
  };
}

function draftToInput(d: Draft): MeetingOccurrenceInput {
  const t = (v: string) => {
    const s = v.trim();
    return s === '' ? null : s;
  };
  return {
    title: d.title.trim(),
    meetingId: d.meetingId || null,
    heldAt: d.heldAt ? new Date(d.heldAt).toISOString() : null,
    attendees: t(d.attendees),
    agenda: t(d.agenda),
    minutes: t(d.minutes),
    decisions: t(d.decisions),
    nextActions: t(d.nextActions),
  };
}

export default function MeetingOccurrencesPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [occurrences, setOccurrences] = useState<MeetingOccurrence[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(occToDraft(null));
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [oc, mt] = await Promise.all([
        listMeetingOccurrences(projectId),
        // 会議帯は選択肢。取得失敗しても実会議一覧は壊さない。
        listMeetings(projectId).catch(() => [] as Meeting[]),
      ]);
      setOccurrences(oc);
      setMeetings(mt);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const meetingById = useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings]);

  const openCreate = () => {
    setEditId(null);
    setDraft(occToDraft(null));
    setModalError(null);
    setModalOpen(true);
  };
  const openEdit = (o: MeetingOccurrence) => {
    setEditId(o.id);
    setDraft(occToDraft(o));
    setModalError(null);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditId(null);
  };

  const handleSave = async () => {
    const input = draftToInput(draft);
    if (!input.title) {
      setModalError('タイトルは必須です');
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      if (editId) await updateMeetingOccurrence(editId, input);
      else await createMeetingOccurrence(projectId, input);
      await reload();
      closeModal();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (o: MeetingOccurrence) => {
    if (!confirm(`実会議「${o.title || '（無題）'}」を削除しますか？`)) return;
    setError(null);
    try {
      await deleteMeetingOccurrence(o.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  const setF = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const fmtDate = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="実会議（議事録）"
        description="会議帯（定例など）の「1回分の開催実体」。議事録・決定事項・ネクストアクションを記録します。"
        help="会議帯（会議マスタ）が“定義”なのに対し、こちらは“実際に開催された1回”です。会議帯に紐づけるのが基本ですが、どの会議帯にも属さない単発／例外会議は会議帯を未選択で作成できます。録画の文字起こしから ipro-agent が自動で議事録を投入するのと同じデータです。"
        backHref={`/dashboard/projects/${projectId}/meetings`}
        backLabel="会議マスタへ戻る"
        actions={
          <HowToPanel
            steps={[
              '「実会議を追加」から開催回を作成します。',
              '会議帯を選ぶと定例などに紐づきます。単発／例外会議は会議帯を未選択のままにします。',
              '議事録本文・決定事項・ネクストアクションを記録できます。',
              'ネクストアクションは ipro-agent がタスクへ変換して自動追加します。',
            ]}
          />
        }
      />

      <EditGate dim={false}>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            実会議を追加
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">#</th>
                      <th className="min-w-[150px] px-3 py-2 text-left text-xs font-semibold text-gray-600">開催日時</th>
                      <th className="min-w-[200px] px-3 py-2 text-left text-xs font-semibold text-gray-600">タイトル</th>
                      <th className="min-w-[140px] px-3 py-2 text-left text-xs font-semibold text-gray-600">会議帯</th>
                      <th className="min-w-[120px] px-3 py-2 text-left text-xs font-semibold text-gray-600">出典</th>
                      <th className="w-12 px-2 py-2" aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {occurrences.map((o, i) => {
                      const series = o.meetingId ? meetingById.get(o.meetingId) : undefined;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => openEdit(o)}
                          className="cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50/40"
                          title="クリックして編集"
                        >
                          <td className="px-2 py-2.5 align-middle text-xs text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap text-gray-700">{fmtDate(o.heldAt)}</td>
                          <td className="px-3 py-2.5 align-middle">
                            <span className="font-medium text-[#050f3e]">{o.title || '（無題）'}</span>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            {series ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800">
                                {series.name}
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
                                単発／例外
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-middle text-xs text-gray-500">
                            {o.source || <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-2.5 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleDelete(o)}
                              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="この実会議を削除"
                              aria-label="この実会議を削除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {occurrences.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                          まだ実会議がありません。「実会議を追加」から始めましょう。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && (
              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                <p className="text-xs text-gray-400">{occurrences.length} 件</p>
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  実会議を追加
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeModal}>
            <div
              className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
                  <FileText className="h-4 w-4 text-blue-600" />
                  {editId ? `${draft.title || '（無題）'} を編集` : '実会議を追加'}
                </h3>
                <button type="button" onClick={closeModal} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="閉じる">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[66vh] space-y-3 overflow-auto px-5 py-4">
                <Field label="タイトル" required>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setF('title', e.target.value)}
                    placeholder="例：第3回 定例MTG"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="会議帯（未選択＝単発／例外会議）">
                    <select
                      value={draft.meetingId}
                      onChange={(e) => setF('meetingId', e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">（単発／例外会議）</option>
                      {meetings.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="開催日時">
                    <input
                      type="datetime-local"
                      value={draft.heldAt}
                      onChange={(e) => setF('heldAt', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                </div>

                <Field label="出席者">
                  <input
                    type="text"
                    value={draft.attendees}
                    onChange={(e) => setF('attendees', e.target.value)}
                    placeholder="例：山田、佐藤、鈴木"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="アジェンダ">
                  <textarea
                    value={draft.agenda}
                    onChange={(e) => setF('agenda', e.target.value)}
                    rows={2}
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="議事録本文">
                  <textarea
                    value={draft.minutes}
                    onChange={(e) => setF('minutes', e.target.value)}
                    rows={6}
                    placeholder="議論の内容・経緯"
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="決定事項">
                  <textarea
                    value={draft.decisions}
                    onChange={(e) => setF('decisions', e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="ネクストアクション（タスク化の元）">
                  <textarea
                    value={draft.nextActions}
                    onChange={(e) => setF('nextActions', e.target.value)}
                    rows={3}
                    placeholder="担当・期限つきで箇条書き"
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>

                {modalError && <p className="text-xs text-rose-600">{modalError}</p>}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
                <button type="button" onClick={closeModal} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-md bg-[#050f3e] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </EditGate>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-gray-500">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

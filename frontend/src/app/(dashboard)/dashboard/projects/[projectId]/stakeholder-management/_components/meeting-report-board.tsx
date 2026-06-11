'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  Trash2,
  Plus,
  Users,
  Megaphone,
  CalendarClock,
  ExternalLink,
} from 'lucide-react';
import {
  type Meeting,
  type MeetingInput,
  type Stakeholder,
  type ReportCalendar,
  type ReportCalendarInput,
  listMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  setMeetingStakeholders,
  listStakeholders,
  reportCalendarsApi,
} from '@/lib/stakeholders';

// 会議体の編集列（テーブル直接編集 + blur で PATCH）。
const MEETING_FIELDS: {
  key: keyof MeetingInput;
  label: string;
  multiline?: boolean;
}[] = [
  { key: 'name', label: '会議名' },
  { key: 'purpose', label: '目的・ゴール', multiline: true },
  { key: 'frequency', label: '頻度' },
  { key: 'dayTime', label: '曜日・時刻' },
  { key: 'decisionMaker', label: '意思決定者' },
  { key: 'minutesOwner', label: '議事録担当' },
  { key: 'note', label: '備考', multiline: true },
];

// 報告・連絡カレンダーのフリーテキスト列（報告対象=Stakeholder SELECT,
// 関連会議=Meeting SELECT は別途専用セルで描画）。
const REPORT_FIELDS: {
  key: keyof ReportCalendarInput;
  label: string;
  multiline?: boolean;
}[] = [
  { key: 'reportContent', label: '報告内容（何を）', multiline: true },
  { key: 'frequency', label: '頻度' },
  { key: 'dayTime', label: '曜日・時刻' },
  { key: 'format', label: '形式' },
  { key: 'medium', label: '媒体' },
  { key: 'drafter', label: '起票担当' },
  { key: 'approver', label: '承認者' },
  { key: 'templateRef', label: 'テンプレ・参考', multiline: true },
  { key: 'note', label: '備考', multiline: true },
];

/** 支持度→ドット色（対象選択の手掛かりに併記）。 */
function supportDot(support: string | null): string {
  if (support === '支持') return 'bg-emerald-500';
  if (support === '反対') return 'bg-rose-500';
  if (support === '中立') return 'bg-gray-400';
  return 'bg-gray-300';
}

export function MeetingReportBoard({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [reports, setReports] = useState<ReportCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [mt, sh, rc] = await Promise.all([
        listMeetings(projectId),
        listStakeholders(projectId),
        reportCalendarsApi.list(projectId),
      ]);
      setMeetings(mt);
      setStakeholders(sh);
      setReports(rc);
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

  const stakeholderById = useMemo(
    () => new Map(stakeholders.map((s) => [s.id, s])),
    [stakeholders],
  );
  const hasStakeholders = stakeholders.length > 0;

  const handleAdd = async () => {
    setError(null);
    try {
      await createMeeting(projectId, { name: '新しい会議体' });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '会議体の作成に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この会議体を削除しますか？')) return;
    setError(null);
    try {
      await deleteMeeting(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '会議体の削除に失敗しました');
    }
  };

  // ローカル編集（テーブル入力）。
  const setField = (id: string, key: keyof MeetingInput, value: string) =>
    setMeetings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [key]: value } : m)),
    );

  // blur で PATCH（name は空なら送らない）。
  const commitField = async (
    id: string,
    key: keyof MeetingInput,
    value: string,
  ) => {
    const trimmed = value.trim();
    const payload: Partial<MeetingInput> = {
      [key]: key === 'name' ? trimmed || '（無題）' : trimmed === '' ? null : trimmed,
    } as Partial<MeetingInput>;
    try {
      await updateMeeting(id, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '会議体の更新に失敗しました');
      await reload();
    }
  };

  const toggleStakeholder = async (meeting: Meeting, stakeholderId: string) => {
    const next = meeting.stakeholderIds.includes(stakeholderId)
      ? meeting.stakeholderIds.filter((x) => x !== stakeholderId)
      : [...meeting.stakeholderIds, stakeholderId];
    // 楽観更新
    setMeetings((prev) =>
      prev.map((m) =>
        m.id === meeting.id ? { ...m, stakeholderIds: next } : m,
      ),
    );
    try {
      await setMeetingStakeholders(meeting.id, next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '対象ステークホルダーの更新に失敗しました',
      );
      await reload();
    }
  };

  // ---- 報告・連絡カレンダー ----
  const handleAddReport = async () => {
    setError(null);
    try {
      await reportCalendarsApi.create(projectId, { order: reports.length });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '報告行の作成に失敗しました');
    }
  };

  const handleDeleteReport = async (id: string) => {
    if (!confirm('この報告行を削除しますか？')) return;
    setError(null);
    try {
      await reportCalendarsApi.delete(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '報告行の削除に失敗しました');
    }
  };

  // ローカル編集（フリーテキスト列）。
  const setReportField = (
    id: string,
    key: keyof ReportCalendarInput,
    value: string,
  ) =>
    setReports((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)),
    );

  // blur で PATCH（空文字は null に正規化）。
  const commitReportField = async (
    id: string,
    key: keyof ReportCalendarInput,
    value: string,
  ) => {
    const trimmed = value.trim();
    try {
      await reportCalendarsApi.update(id, {
        [key]: trimmed === '' ? null : trimmed,
      } as ReportCalendarInput);
    } catch (e) {
      setError(e instanceof Error ? e.message : '報告行の更新に失敗しました');
      await reload();
    }
  };

  // SELECT 系（報告対象 stakeholderId / 関連会議 meetingId）は即時 PATCH。
  const commitReportSelect = async (
    report: ReportCalendar,
    key: 'stakeholderId' | 'meetingId',
    value: string,
  ) => {
    const next = value === '' ? null : value;
    setReports((prev) =>
      prev.map((r) => (r.id === report.id ? { ...r, [key]: next } : r)),
    );
    try {
      await reportCalendarsApi.update(report.id, {
        [key]: next,
      } as ReportCalendarInput);
    } catch (e) {
      setError(e instanceof Error ? e.message : '報告行の更新に失敗しました');
      await reload();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 会議体 CRUD */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
            <CalendarClock className="h-4 w-4 text-blue-600" />
            会議体
          </h3>
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/projects/${projectId}/meetings`}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              会議マスタで管理
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              会議体を追加
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <p className="text-xs text-gray-500">
          各会議体に名前・目的・頻度・曜日時刻・意思決定者・議事録担当を設定し、対象ステークホルダーを複数選択します。各セルは入力後フォーカスを外すと自動保存されます。
        </p>

        {!hasStakeholders && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            「ステークホルダー」タブで関係者を登録すると、各会議体の対象として選べるようになります。
          </div>
        )}

        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                      #
                    </th>
                    {MEETING_FIELDS.map((f) => (
                      <th
                        key={f.key as string}
                        className="min-w-[140px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-600"
                      >
                        {f.label}
                      </th>
                    ))}
                    <th className="min-w-[230px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                      対象ステークホルダー
                    </th>
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((m, i) => (
                    <tr
                      key={m.id}
                      className="border-b border-gray-100 align-top hover:bg-gray-50/50"
                    >
                      <td className="px-2 py-2 align-middle text-xs text-gray-400">
                        {i + 1}
                      </td>
                      {MEETING_FIELDS.map((f) => (
                        <td key={f.key as string} className="px-1.5 py-1.5 align-middle">
                          {f.multiline ? (
                            <textarea
                              value={(m[f.key] as string | null) ?? ''}
                              onChange={(e) =>
                                setField(m.id, f.key, e.target.value)
                              }
                              onBlur={(e) =>
                                commitField(m.id, f.key, e.target.value)
                              }
                              rows={2}
                              placeholder={f.label}
                              className="w-full min-w-[120px] resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          ) : (
                            <input
                              type="text"
                              value={(m[f.key] as string | null) ?? ''}
                              onChange={(e) =>
                                setField(m.id, f.key, e.target.value)
                              }
                              onBlur={(e) =>
                                commitField(m.id, f.key, e.target.value)
                              }
                              placeholder={f.label}
                              className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          )}
                        </td>
                      ))}

                      {/* 対象ステークホルダー（チップ + 複数選択） */}
                      <td className="bg-blue-50/40 px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {m.stakeholderIds.map((sid) => {
                            const s = stakeholderById.get(sid);
                            return (
                              <span
                                key={sid}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
                                title={
                                  s
                                    ? `影響度:${s.influence || '—'} / 支持度:${s.support || '—'}`
                                    : '未登録'
                                }
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${supportDot(
                                    s?.support ?? null,
                                  )}`}
                                />
                                {s?.name ?? '（不明）'}
                                <button
                                  type="button"
                                  onClick={() => toggleStakeholder(m, sid)}
                                  className="text-blue-500 hover:text-blue-800"
                                  aria-label="外す"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                        <div className="relative mt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenPicker(openPicker === m.id ? null : m.id)
                            }
                            disabled={!hasStakeholders}
                            className="flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Users className="h-3 w-3" />
                            選択
                          </button>
                          {openPicker === m.id && hasStakeholders && (
                            <>
                              <button
                                type="button"
                                aria-label="閉じる"
                                onClick={() => setOpenPicker(null)}
                                className="fixed inset-0 z-10 cursor-default"
                              />
                              <div className="absolute z-20 mt-1 max-h-56 w-60 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
                                {stakeholders.map((s) => {
                                  const checked = m.stakeholderIds.includes(
                                    s.id,
                                  );
                                  return (
                                    <label
                                      key={s.id}
                                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          toggleStakeholder(m, s.id)
                                        }
                                        className="h-3.5 w-3.5"
                                      />
                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${supportDot(
                                          s.support,
                                        )}`}
                                      />
                                      <span className="flex-1 text-gray-800">
                                        {s.name}
                                      </span>
                                      {s.influence && (
                                        <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">
                                          影響{s.influence}
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-1.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => handleDelete(m.id)}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="この会議体を削除"
                          aria-label="この会議体を削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {meetings.length === 0 && (
                    <tr>
                      <td
                        colSpan={MEETING_FIELDS.length + 3}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ会議体がありません。「会議体を追加」から始めましょう。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-400">{meetings.length} 会議体</p>
              <button
                type="button"
                onClick={handleAdd}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                会議体を追加
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 報告・連絡カレンダー（ReportCalendar テーブルを直接 CRUD） */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
            <Megaphone className="h-4 w-4 text-blue-600" />
            報告・連絡カレンダー
          </h3>
          <button
            type="button"
            onClick={handleAddReport}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            報告行を追加
          </button>
        </div>

        <p className="text-xs text-gray-500">
          「誰に・何を・どの会議で・どの頻度で」報告・連絡するかを行ごとに設計します。報告対象はステークホルダー、関連会議は会議体から選べます（未登録のときはフリーテキストで補えます）。各セルは入力後フォーカスを外すと自動保存されます。
        </p>

        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                      #
                    </th>
                    <th className="min-w-[180px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                      報告対象（誰に）
                    </th>
                    <th className="min-w-[160px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                      関連会議
                    </th>
                    {REPORT_FIELDS.map((f) => (
                      <th
                        key={f.key as string}
                        className="min-w-[140px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-600"
                      >
                        {f.label}
                      </th>
                    ))}
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r, i) => (
                    <tr
                      key={r.id}
                      className="border-b border-gray-100 align-top hover:bg-gray-50/50"
                    >
                      <td className="px-2 py-2 align-middle text-xs text-gray-400">
                        {i + 1}
                      </td>

                      {/* 報告対象（Stakeholder SELECT + フリーテキスト fallback） */}
                      <td className="bg-blue-50/40 px-2 py-1.5 align-top">
                        <select
                          value={r.stakeholderId ?? ''}
                          onChange={(e) =>
                            commitReportSelect(
                              r,
                              'stakeholderId',
                              e.target.value,
                            )
                          }
                          className="w-full min-w-[150px] rounded-md border border-blue-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">
                            {hasStakeholders
                              ? 'ステークホルダーを選択'
                              : '（ステークホルダー未登録）'}
                          </option>
                          {stakeholders.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        {!r.stakeholderId && (
                          <input
                            type="text"
                            value={r.reportTo ?? ''}
                            onChange={(e) =>
                              setReportField(r.id, 'reportTo', e.target.value)
                            }
                            onBlur={(e) =>
                              commitReportField(r.id, 'reportTo', e.target.value)
                            }
                            placeholder="または自由記述（例：本部長）"
                            className="mt-1 w-full min-w-[150px] rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-gray-700 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}
                      </td>

                      {/* 関連会議（Meeting SELECT） */}
                      <td className="bg-blue-50/40 px-2 py-1.5 align-top">
                        <select
                          value={r.meetingId ?? ''}
                          onChange={(e) =>
                            commitReportSelect(r, 'meetingId', e.target.value)
                          }
                          className="w-full min-w-[140px] rounded-md border border-blue-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">
                            {meetings.length > 0
                              ? '会議体を選択（任意）'
                              : '（会議体なし）'}
                          </option>
                          {meetings.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {REPORT_FIELDS.map((f) => (
                        <td
                          key={f.key as string}
                          className="px-1.5 py-1.5 align-middle"
                        >
                          {f.multiline ? (
                            <textarea
                              value={(r[f.key] as string | null) ?? ''}
                              onChange={(e) =>
                                setReportField(r.id, f.key, e.target.value)
                              }
                              onBlur={(e) =>
                                commitReportField(r.id, f.key, e.target.value)
                              }
                              rows={2}
                              placeholder={f.label}
                              className="w-full min-w-[120px] resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          ) : (
                            <input
                              type="text"
                              value={(r[f.key] as string | null) ?? ''}
                              onChange={(e) =>
                                setReportField(r.id, f.key, e.target.value)
                              }
                              onBlur={(e) =>
                                commitReportField(r.id, f.key, e.target.value)
                              }
                              placeholder={f.label}
                              className="w-full min-w-[110px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          )}
                        </td>
                      ))}

                      <td className="px-2 py-1.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => handleDeleteReport(r.id)}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="この報告行を削除"
                          aria-label="この報告行を削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {reports.length === 0 && (
                    <tr>
                      <td
                        colSpan={REPORT_FIELDS.length + 4}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ報告行がありません。「報告行を追加」から始めましょう。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-400">{reports.length} 報告行</p>
              <button
                type="button"
                onClick={handleAddReport}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                報告行を追加
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

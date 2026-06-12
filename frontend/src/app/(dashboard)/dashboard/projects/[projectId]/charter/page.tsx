'use client';

/**
 * プロジェクト憲章ページ。
 *
 * PMBOK の立ち上げプロセスで作るプロジェクト憲章を1枚で編集・参照する。
 * - 文章セクション（背景/目的/成功基準/スコープ内/スコープ外/予算メモ）は
 *   textarea + onBlur 保存（PUT charter の upsert）。
 * - 承認者/スポンサーはステークホルダー select（変更即保存）。
 * - 前提条件・制約条件は制約マスタ（kind 別）をチップ表示（編集は /constraints）。
 * - マイルストーンは GET tasks から milestone タスクを期日順に一覧（編集はガント）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  Flag,
  Loader2,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import {
  charterApi,
  type ProjectCharter,
  type ProjectCharterInput,
} from '@/lib/pmbok';
import {
  constraintApi,
  normalizeConstraintKind,
  constraintKindMeta,
  type ConstraintMaster,
} from '@/lib/masters';
import { listStakeholders, type Stakeholder } from '@/lib/stakeholders';
import { tasksApi, type Task } from '@/lib/tasks';

// 文章セクションの定義（key は ProjectCharter のフィールド名と一致）。
const TEXT_SECTIONS: {
  key: 'background' | 'purpose' | 'successCriteria' | 'scopeIn' | 'scopeOut' | 'budgetNote';
  label: string;
  placeholder: string;
}[] = [
  { key: 'background', label: '背景', placeholder: 'なぜこのプロジェクトを始めるのか（現状の課題・経緯）' },
  { key: 'purpose', label: '目的', placeholder: 'このプロジェクトで達成したいこと' },
  { key: 'successCriteria', label: '成功基準', placeholder: '何をもって成功とするか（測定可能な基準）' },
  { key: 'scopeIn', label: 'スコープ内', placeholder: 'このプロジェクトでやること' },
  { key: 'scopeOut', label: 'スコープ外', placeholder: 'このプロジェクトではやらないこと' },
  { key: 'budgetNote', label: '予算メモ', placeholder: '概算予算・予算上の前提など' },
];

/** ISO 日付文字列を YYYY/MM/DD 表示にする（不正値・null は '—'）。 */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function CharterPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [charter, setCharter] = useState<ProjectCharter | null>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [constraints, setConstraints] = useState<ConstraintMaster[]>([]);
  const [milestones, setMilestones] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [ch, shs, cs, tasksRes] = await Promise.all([
          charterApi.get(projectId),
          listStakeholders(projectId),
          constraintApi.list(projectId),
          tasksApi.list(projectId),
        ]);
        if (cancelled) return;
        setCharter(ch);
        setStakeholders(shs);
        setConstraints(cs);
        // milestone が truthy のタスクを期日順（期日なしは末尾）に並べる。
        const ms = tasksRes.tasks
          .filter((t) => t.milestone)
          .sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
          });
        setMilestones(ms);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 1フィールドだけ PUT（upsert）し、レスポンスで state を更新する。
  const save = useCallback(
    async (patch: ProjectCharterInput) => {
      setSaving(true);
      setError(null);
      try {
        const next = await charterApi.upsert(projectId, patch);
        setCharter(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  const constraintItems = constraints.filter(
    (c) => normalizeConstraintKind(c.kind) === 'CONSTRAINT',
  );
  const assumptionItems = constraints.filter(
    (c) => normalizeConstraintKind(c.kind) === 'ASSUMPTION',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            プロジェクト憲章
          </span>
        }
        description="プロジェクトの存在理由・スコープ・成功基準を1枚にまとめます（PMBOK 立ち上げ）。"
        help="背景・目的・成功基準・スコープを言語化し、承認者とスポンサーを明確にします。前提条件・制約条件とマイルストーンは各管理画面のデータを参照表示します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <div className="flex items-center gap-2">
            {saving && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                保存中…
              </span>
            )}
            <HowToPanel
              steps={[
                '背景・目的などの各欄に文章を入力します。入力欄から離れると自動保存されます。',
                '承認者・スポンサーはステークホルダー一覧から選びます（変更すると即保存）。',
                '前提条件・制約条件は制約マスタの参照表示です。「管理」リンクから編集します。',
                'マイルストーンはタスクのうち「マイルストーン」を立てたものを期日順に表示します。編集はガントチャートで行います。',
              ]}
            />
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* 承認者 / スポンサー */}
          <Card className="bg-white border-gray-200">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              <StakeholderSelect
                label="承認者"
                help="この憲章（プロジェクトの立ち上げ）を承認する人"
                value={charter?.approverStakeholderId ?? ''}
                stakeholders={stakeholders}
                onChange={(v) => void save({ approverStakeholderId: v || null })}
              />
              <StakeholderSelect
                label="スポンサー"
                help="予算と意思決定の後ろ盾になる人"
                value={charter?.sponsorStakeholderId ?? ''}
                stakeholders={stakeholders}
                onChange={(v) => void save({ sponsorStakeholderId: v || null })}
              />
              {stakeholders.length === 0 && (
                <p className="text-xs text-gray-400 sm:col-span-2">
                  ステークホルダーが未登録です。
                  <Link
                    href={`/dashboard/projects/${projectId}/stakeholder-management`}
                    className="ml-1 text-primary underline-offset-2 hover:underline"
                  >
                    ステークホルダーマネジメント
                  </Link>
                  で登録すると選択できます。
                </p>
              )}
            </CardContent>
          </Card>

          {/* 文章セクション（textarea + onBlur 保存） */}
          <div className="grid gap-4 lg:grid-cols-2">
            {TEXT_SECTIONS.map((section) => (
              <CharterTextSection
                key={section.key}
                label={section.label}
                placeholder={section.placeholder}
                value={charter?.[section.key] ?? ''}
                onSave={(v) => void save({ [section.key]: v === '' ? null : v })}
              />
            ))}
          </div>

          {/* 前提条件・制約条件（制約マスタ参照） */}
          <Card className="bg-white border-gray-200">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  前提条件・制約条件
                </h2>
                <Link
                  href={`/dashboard/projects/${projectId}/constraints`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  制約条件を管理
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <ConstraintChips label="制約" kind="CONSTRAINT" items={constraintItems} />
              <ConstraintChips label="前提条件" kind="ASSUMPTION" items={assumptionItems} />
              {constraints.length === 0 && (
                <p className="text-sm text-gray-400">
                  まだ前提条件・制約条件が登録されていません。「制約条件を管理」から追加してください。
                </p>
              )}
            </CardContent>
          </Card>

          {/* マイルストーン（GET tasks の milestone を期日順に） */}
          <Card className="bg-white border-gray-200">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
                  <Flag className="h-4 w-4 text-amber-500" />
                  マイルストーン
                </h2>
                <Link
                  href={`/dashboard/projects/${projectId}/tasks/gantt`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  ガントチャートで編集
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {milestones.length === 0 ? (
                <p className="text-sm text-gray-400">
                  マイルストーンがまだありません。タスクで「マイルストーン」を立てるとここに表示されます。
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {milestones.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-2">
                      <Flag className="h-4 w-4 flex-shrink-0 text-amber-500" />
                      <span className="w-28 flex-shrink-0 font-mono text-xs text-gray-500">
                        {fmtDate(t.dueDate)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#050f3e]">
                        {t.title}
                      </span>
                      {t.assigneeName && (
                        <span className="hidden flex-shrink-0 text-xs text-gray-400 sm:inline">
                          {t.assigneeName}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 文章セクション（textarea + onBlur 保存）
// ---------------------------------------------------------------------------

function CharterTextSection({
  label,
  placeholder,
  value,
  onSave,
}: {
  label: string;
  placeholder: string;
  value: string;
  onSave: (value: string) => void;
}) {
  // ローカルドラフトで保持し、onBlur で差分があるときだけ保存する。
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="space-y-2 p-4">
        <label className="block text-sm font-semibold text-[#050f3e]">{label}</label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== value.trim()) onSave(v);
          }}
          rows={4}
          placeholder={placeholder}
          className="w-full resize-y rounded-md border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ステークホルダー select（変更即保存）
// ---------------------------------------------------------------------------

function StakeholderSelect({
  label,
  help,
  value,
  stakeholders,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  stakeholders: Stakeholder[];
  onChange: (stakeholderId: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-semibold text-[#050f3e]">
        {label}
        <span className="ml-2 text-[11px] font-normal text-gray-400">{help}</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        aria-label={label}
      >
        <option value="">（未選択）</option>
        {stakeholders.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.affiliation ? `（${s.affiliation}）` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 制約チップ（kind 別の参照表示）
// ---------------------------------------------------------------------------

function ConstraintChips({
  label,
  kind,
  items,
}: {
  label: string;
  kind: 'CONSTRAINT' | 'ASSUMPTION';
  items: ConstraintMaster[];
}) {
  if (items.length === 0) return null;
  const meta = constraintKindMeta[kind];
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-gray-500">{label}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <span
            key={c.id}
            title={c.description ?? undefined}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${meta.badge}`}
          >
            {c.category && (
              <span className="font-medium opacity-70">{c.category}：</span>
            )}
            <span className="truncate">{c.title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

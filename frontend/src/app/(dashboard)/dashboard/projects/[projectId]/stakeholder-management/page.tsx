'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { Users, Grid3x3, CalendarClock, type LucideIcon } from 'lucide-react';
import { StakeholderTableBoard } from './_components/stakeholder-table-board';
import { MeetingReportBoard } from './_components/meeting-report-board';
import { InterestMatrixBoard } from './_components/interest-matrix-board';

/**
 * ステークホルダーマネジメント ワークスペース。
 *
 * 関係者・関心ごと・会議/報告の3タブに集約。
 * すべて専用テーブル（Stakeholder / Meeting / Role / ReportCalendar /
 * InterestMatrixRow）を直接 CRUD する（RecordSheet は使わない）。
 */
type TabKey = 'stakeholders' | 'interests' | 'meetings';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'stakeholders', label: 'ステークホルダー', icon: Users },
  { key: 'interests', label: '関心ごと', icon: Grid3x3 },
  { key: 'meetings', label: '会議・報告', icon: CalendarClock },
];

export default function StakeholderManagementPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [active, setActive] = useState<TabKey>('stakeholders');

  return (
    <div className="space-y-6">
      <PageHeader
        title="ステークホルダーマネジメント"
        description="関係者・関心ごと・会議/報告を一分野として構造的に管理します"
        help="「ステークホルダー」タブで関係者を一覧・マトリクス・役割で管理し、「関心ごと」でフェーズ×ロールの関心を整理、「会議・報告」で会議体と報告連絡を設計します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                'タブで管理したい領域（ステークホルダー／関心ごと／会議・報告）を選びます。',
                'ステークホルダー：行をクリックして全項目を編集、影響度×支持度マトリクスでも配置できます。',
                '会議・報告：会議体を追加し、対象ステークホルダーを複数選択します。',
                '役割と責任は「役割」ページのロールに責任・意思決定範囲・KPIを定義します。',
              ]}
            />
            <ManualButton feature="stakeholder-management" />
          </>
        }
      />

      {/* タブ */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ステークホルダー（テーブル + マトリクス + 役割と責任） */}
      <div className={active === 'stakeholders' ? '' : 'hidden'}>
        <StakeholderTableBoard projectId={projectId} />
      </div>

      {/* 関心ごと（InterestMatrixRow テーブル：フェーズ×視点） */}
      <div className={active === 'interests' ? '' : 'hidden'}>
        <InterestMatrixBoard projectId={projectId} />
      </div>

      {/* 会議・報告（Meeting テーブル + 報告連絡カレンダー テーブル） */}
      <div className={active === 'meetings' ? '' : 'hidden'}>
        <MeetingReportBoard projectId={projectId} />
      </div>
    </div>
  );
}

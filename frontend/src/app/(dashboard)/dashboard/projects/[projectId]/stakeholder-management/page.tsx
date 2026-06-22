'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTabParam } from '@/hooks/use-tab-param';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import {
  Users,
  Grid3x3,
  CalendarClock,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import { StakeholderTableBoard } from './_components/stakeholder-table-board';
import { MeetingReportBoard } from './_components/meeting-report-board';
import { InterestMatrixBoard } from './_components/interest-matrix-board';
import { AdoptionBoard } from './_components/adoption-board';
import { EditGate } from '@/components/edit-gate';
import { useReadOnly } from '@/components/read-only-context';
import { FeatureSectionIo } from '@/components/io/FeatureSectionIo';

/**
 * ステークホルダーマネジメント ワークスペース。
 *
 * 関係者・関心ごと・会議/報告・導入状況の4タブに集約。
 * すべて専用テーブル（Stakeholder / Meeting / Role / ReportCalendar /
 * InterestMatrixRow / AdoptionStatus）を直接 CRUD する（RecordSheet は使わない）。
 */
type TabKey = 'stakeholders' | 'interests' | 'meetings' | 'adoption';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'stakeholders', label: 'ステークホルダー', icon: Users },
  { key: 'interests', label: '関心ごと', icon: Grid3x3 },
  { key: 'meetings', label: '会議・報告', icon: CalendarClock },
  { key: 'adoption', label: '導入状況', icon: Rocket },
];

// アクティブタブ -> feature-io の section / 表示名。
// stakeholderTracking セクションは「導入状況＋報告連絡カレンダー＋関心ごと」の3モデルを束ねる。
// 関心ごと/導入状況の両タブが同一セクションを指すため、replace 取込が相互にデータを消し得る。
// ラベルで「3つ一括」であることを明示し、誤って片方のつもりで全消ししないようにする。
const TRACKING_IO_LABEL = '追跡データ（導入状況・報告・関心ごと 一括）';
const TAB_IO: Record<TabKey, { sectionKey: string; label: string }> = {
  stakeholders: { sectionKey: 'stakeholders', label: 'ステークホルダー' },
  interests: { sectionKey: 'stakeholderTracking', label: TRACKING_IO_LABEL },
  meetings: { sectionKey: 'meetings', label: '会議・報告' },
  adoption: { sectionKey: 'stakeholderTracking', label: TRACKING_IO_LABEL },
};

export default function StakeholderManagementPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();
  // タブを URL ?tab= で駆動し、左サイドメニューのアコーディオン子項目と双方向同期。
  const [activeTab, setActive] = useTabParam('stakeholders');
  const active = activeTab as TabKey;
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="ステークホルダーマネジメント"
        description="関係者・関心ごと・会議/報告・導入状況を一分野として構造的に管理します"
        help="「ステークホルダー」タブで関係者を一覧・マトリクス・役割で管理し、「関心ごと」でフェーズ×ロールの関心を整理、「会議・報告」で会議体と報告連絡を設計、「導入状況」でシステムごとの定着度を追跡します。"
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
                '導入状況：対象システムを選び、各関係者の段階（未着手→説明済→トレーニング済→試行中→本稼働→定着）を select で更新します。上のファネルカードをクリックすると、その段階に絞り込めます。',
                '導入状況の最終接触日・阻害要因・次アクションは、入力してフォーカスを外すと自動保存されます。',
              ]}
            />
            <ManualButton feature="stakeholder-management" />
            <FeatureSectionIo
              projectId={projectId}
              sectionKey={TAB_IO[active].sectionKey}
              label={TAB_IO[active].label}
              canEdit={canEdit}
              onDone={() => setRefreshKey((k) => k + 1)}
            />
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

      <EditGate dim={false}>
        {/* ステークホルダー（テーブル + マトリクス + 役割と責任） */}
        <div className={active === 'stakeholders' ? '' : 'hidden'}>
          <StakeholderTableBoard key={refreshKey} projectId={projectId} />
        </div>

        {/* 関心ごと（InterestMatrixRow テーブル：フェーズ×視点） */}
        <div className={active === 'interests' ? '' : 'hidden'}>
          <InterestMatrixBoard key={refreshKey} projectId={projectId} />
        </div>

        {/* 会議・報告（Meeting テーブル + 報告連絡カレンダー テーブル） */}
        <div className={active === 'meetings' ? '' : 'hidden'}>
          <MeetingReportBoard key={refreshKey} projectId={projectId} />
        </div>

        {/* 導入状況（AdoptionStatus テーブル：人 × システム の定着度） */}
        <div className={active === 'adoption' ? '' : 'hidden'}>
          <AdoptionBoard key={refreshKey} projectId={projectId} />
        </div>
      </EditGate>
    </div>
  );
}

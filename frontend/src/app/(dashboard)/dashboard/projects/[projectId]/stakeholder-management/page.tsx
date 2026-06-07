'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import {
  Users,
  Grid3x3,
  UserCog,
  CalendarClock,
  BookOpen,
  Megaphone,
  Map as MapIcon,
  ListChecks,
  ShieldAlert,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { RECORD_TEMPLATES, type RecordTemplate } from '@/lib/record-templates';
import { RecordSheetTable } from '@/components/records/record-sheet-table';

/**
 * ステークホルダーマネジメント ワークスペース。
 * 教材「プロジェクト管理（ステークホルダー管理）」＋「会議・合意形成」配布物Excelの
 * 各シートを、関係者マネジメントの一分野としてタブで統合。
 * 各タブは RecordSheet（projectId × templateKey）に構造的に保存される。
 */
const SM_TAB_DEFS: { key: string; tabLabel: string; icon: LucideIcon }[] = [
  { key: 'stakeholder-map', tabLabel: 'ステークホルダーマップ', icon: Users },
  { key: 'interest-matrix', tabLabel: '関心ごとマトリクス', icon: Grid3x3 },
  { key: 'role-responsibility', tabLabel: 'ロール別責任範囲', icon: UserCog },
  { key: 'meeting-list', tabLabel: '会議体一覧', icon: CalendarClock },
  { key: 'meeting-catalog', tabLabel: 'ミーティング体カタログ', icon: BookOpen },
  { key: 'report-calendar', tabLabel: '報告・連絡カレンダー', icon: Megaphone },
  { key: 'field-effort-roadmap', tabLabel: '現場工数ロードマップ', icon: MapIcon },
  { key: 'phase-quick-list', tabLabel: 'クイック一覧', icon: ListChecks },
  { key: 'risk-register', tabLabel: 'リスク登録簿', icon: ShieldAlert },
];

type SmTab = {
  key: string;
  tabLabel: string;
  icon: LucideIcon;
  template: RecordTemplate;
};

const SM_TABS: SmTab[] = SM_TAB_DEFS.flatMap((def) => {
  const template = RECORD_TEMPLATES.find((t) => t.key === def.key);
  return template ? [{ ...def, template }] : [];
});

export default function StakeholderManagementPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [active, setActive] = useState<string>(SM_TABS[0]?.key ?? '');

  if (SM_TABS.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="ステークホルダーマネジメント"
          backHref={`/dashboard/projects/${projectId}`}
        />
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
            <p className="text-gray-700">
              テンプレが見つかりませんでした。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ステークホルダーマネジメント"
        description="関係者・会議体・報告連絡・リスクを一分野として構造的に管理します"
        help="ステークホルダーマップ／関心ごとマトリクス／会議体／報告連絡／リスクなどのタブを切り替えて、各表に行を追加・保存します。タブを切り替えても未保存の入力は保持されますが、各タブごとに「保存」を押してください。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              'タブで管理したい表（ステークホルダーマップ等）を選びます。',
              '「行を追加」で行を増やし、各セルに入力します（横スクロール可）。',
              'タブごとに「保存」を押してプロジェクトに記録します。',
              'ステークホルダーマップは関係者の影響度・支持度・巻き込み方の管理に使います。',
            ]}
          />
        }
      />

      {/* タブ */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {SM_TABS.map((t) => {
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
              {t.tabLabel}
            </button>
          );
        })}
      </div>

      {/* 各タブの内容（未保存の編集を保持するため全タブをマウントし表示のみ切替） */}
      {SM_TABS.map((t) => (
        <div key={t.key} className={active === t.key ? 'space-y-2' : 'hidden'}>
          <p className="text-sm text-gray-500">{t.template.description}</p>
          <RecordSheetTable projectId={projectId} template={t.template} />
        </div>
      ))}
    </div>
  );
}

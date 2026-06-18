'use client';

/**
 * 業務KPIページ。
 *
 * 業務フローのゴール指標（category=BUSINESS）の一覧・手動作成・編集・採用を扱う。
 * 業務KPI はチームが自分たちで決めて登録するため、本ページに AI 生成の経路は持たない。
 *
 * KPI の取得・作成・更新・削除はすべて @/lib/kpis の kpiApi 経由。
 * 参照マスタは共有フック useKpiMasters に集約。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useReadOnly } from '@/components/read-only-context';
import { FeatureSectionIo } from '@/components/io/FeatureSectionIo';
import { EditGate } from '@/components/edit-gate';
import { kpiApi, type KpiDto } from '@/lib/kpis';
import { useKpiMasters } from '../ai-create/_components/use-kpi-masters';
import { KpiList } from '../ai-create/_components/kpi-list';
import { KpiEditModal } from '../ai-create/_components/kpi-edit-modal';

export default function BusinessKpiPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  // 参照マスタ（フロー / システム / ロール / INPUT-OUTPUT）
  const { flows, systems, roles, informationTypes } = useKpiMasters(projectId);

  // 業務KPI一覧（category=BUSINESS のみ）
  const [kpis, setKpis] = useState<KpiDto[]>([]);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  // 手動作成モーダルの開閉
  const [creating, setCreating] = useState(false);

  const loadKpis = useCallback(async () => {
    setKpisError(null);
    try {
      setKpis(await kpiApi.list(projectId, { category: 'BUSINESS' }));
    } catch (err) {
      setKpisError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setKpisLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="業務KPI"
        description="業務フローのゴール指標（欠品率・リードタイムなど）をチームで決めて作成・採用します。"
        help="「＋手動で追加」で業務KPIを作成し、各カードをクリックすると全項目を編集できます。各KPIにはSMARTの5軸採点・baseline/target/current・達成率が付きます。下書きは「採用」で運用中になります。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                '「＋手動で追加」で業務KPIを新規作成します（区分は業務KPIに固定）。業務KPIは業務フローのゴール指標として、チームで議論して決めます。',
                '各カードをクリックすると、SMART採点・baseline/target/current・対象フロー/IO紐づけを含め全項目を編集できます。',
                '下書きは「採用」で運用中（ACTIVE）にできます。',
              ]}
            />
            <FeatureSectionIo
              projectId={projectId}
              sectionKey="kpis"
              label="KPI"
              canEdit={canEdit}
              onDone={() => void loadKpis()}
            />
          </>
        }
      />

      {/* 業務KPI一覧（category 固定） */}
      <EditGate dim={false}>
        <KpiList
          kpis={kpis}
          loading={kpisLoading}
          error={kpisError}
          flows={flows}
          systems={systems}
          roles={roles}
          informationTypes={informationTypes}
          onChanged={loadKpis}
          lockedCategory="BUSINESS"
          onCreateNew={() => setCreating(true)}
        />
      </EditGate>

      {/* 手動作成モーダル（新規作成・区分は業務KPIに固定） */}
      {creating && (
        <KpiEditModal
          kpi={null}
          projectId={projectId}
          flows={flows}
          systems={systems}
          roles={roles}
          informationTypes={informationTypes}
          lockedCategory="BUSINESS"
          onClose={() => setCreating(false)}
          onSaved={loadKpis}
        />
      )}
    </div>
  );
}

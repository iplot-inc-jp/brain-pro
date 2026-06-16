'use client';

/**
 * 業務KPIページ。
 *
 * 業務フローのゴール指標（category=BUSINESS）の一覧・手動作成・編集・採用に加え、
 * 「AIで生成」（業務フローの INPUT/OUTPUT・帳票から AI で下書き生成）を本ページに統合している。
 * AI生成はダイアログ内の BusinessKpiTab で行い、生成成功時は一覧（loadKpis）を再取得して反映する。
 *
 * KPI の取得・作成・更新・削除はすべて @/lib/kpis の kpiApi 経由。
 * 参照マスタは共有フック useKpiMasters に集約。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useReadOnly } from '@/components/read-only-context';
import { FeatureSectionIo } from '@/components/io/FeatureSectionIo';
import { EditGate } from '@/components/edit-gate';
import { kpiApi, type KpiDto } from '@/lib/kpis';
import { useKpiMasters } from '../ai-create/_components/use-kpi-masters';
import { KpiList } from '../ai-create/_components/kpi-list';
import { KpiEditModal } from '../ai-create/_components/kpi-edit-modal';
import { BusinessKpiTab } from '../ai-create/_components/business-kpi-tab';

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

  // 直前にAI生成されたKPI（一覧でハイライト）
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());

  // 手動作成モーダルの開閉
  const [creating, setCreating] = useState(false);

  // AI生成ダイアログの開閉
  const [aiOpen, setAiOpen] = useState(false);

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

  // AI生成成功時：生成された下書きを一覧へ反映し、ハイライトする。
  const handleGenerated = useCallback(
    (created: KpiDto[]) => {
      setHighlightIds(new Set(created.map((k) => k.id)));
      void loadKpis();
    },
    [loadKpis],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="業務KPI"
        description="業務フローのゴール指標（欠品率・リードタイムなど）を作成・採用します。"
        help="「AIで生成」で業務フローの INPUT/OUTPUT・帳票から下書きをAI生成できます。「＋手動で追加」でも作成でき、各カードをクリックすると全項目を編集できます。下書きは「採用」で運用中になります。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <EditGate dim={false}>
              <Button
                size="sm"
                onClick={() => setAiOpen(true)}
                className="bg-violet-600 hover:bg-violet-700"
              >
                <Sparkles className="mr-1 h-4 w-4" />
                AIで生成
              </Button>
            </EditGate>
            <HowToPanel
              steps={[
                '「AIで生成」で対象の業務フローを選ぶと、フロー上の INPUT/OUTPUT・帳票が種別ごと（帳票/データ/物体）に表示されます。測りたいものにチェックして「AIでKPIを作成」を押すと下書きが生成されます。',
                '「＋手動で追加」で業務KPIを新規作成します（区分は業務KPIに固定）。',
                '各カードをクリックすると、SMART採点・対象フロー/IO紐づけを含め全項目を編集できます。',
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
          highlightIds={highlightIds}
          flows={flows}
          systems={systems}
          roles={roles}
          informationTypes={informationTypes}
          onChanged={loadKpis}
          lockedCategory="BUSINESS"
          onCreateNew={() => setCreating(true)}
        />
      </EditGate>

      {/* AI生成ダイアログ（業務フローの INPUT/OUTPUT → 業務KPI下書き生成） */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-violet-600" />
              AIで業務KPIを生成
            </DialogTitle>
            <DialogDescription>
              対象の業務フローを選び、測りたい INPUT/OUTPUT・帳票から業務KPIの下書きをAIで生成します。
              生成した下書きはこのページのKPI一覧に追加されます。
            </DialogDescription>
          </DialogHeader>
          <EditGate dim={false}>
            <BusinessKpiTab
              projectId={projectId}
              flows={flows}
              onGenerated={handleGenerated}
            />
          </EditGate>
        </DialogContent>
      </Dialog>

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

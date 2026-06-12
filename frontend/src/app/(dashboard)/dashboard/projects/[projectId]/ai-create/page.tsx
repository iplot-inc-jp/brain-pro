'use client';

/**
 * AI作成（KPI）ページ。
 *
 * - タブ「業務KPI」: 業務フローの INPUT/OUTPUT・帳票から AI で業務KPIを下書き生成
 * - タブ「AI精度KPI」: 対象システムに対する精度指標（認識精度・自動化率など）を
 *   プリセットのワンクリック追加 or AI生成
 * - ページ下部: KPI一覧（タブ共通）。下書きの採用・編集・アーカイブ・削除
 *
 * KPI の取得・作成・更新・削除・生成はすべて @/lib/kpis の kpiApi 経由。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BarChart3, Cpu } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { kpiApi, type KpiDto } from '@/lib/kpis';
import { informationTypeApi, type InformationType } from '@/lib/dfd';
import { systemApi, type SystemMaster } from '@/lib/masters';
import type { BusinessFlowItem, RoleItem } from './_components/types';
import { BusinessKpiTab } from './_components/business-kpi-tab';
import { AiQualityKpiTab } from './_components/ai-quality-kpi-tab';
import { KpiList } from './_components/kpi-list';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export default function AiCreatePage() {
  const params = useParams();
  const projectId = params.projectId as string;

  // 参照マスタ（フロー / システム / ロール / INPUT-OUTPUT）
  const [flows, setFlows] = useState<BusinessFlowItem[]>([]);
  const [systems, setSystems] = useState<SystemMaster[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);

  // KPI一覧
  const [kpis, setKpis] = useState<KpiDto[]>([]);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  // 直前に生成/追加されたKPI（一覧でハイライト）
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());

  const loadKpis = useCallback(async () => {
    setKpisError(null);
    try {
      setKpis(await kpiApi.list(projectId));
    } catch (err) {
      setKpisError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setKpisLoading(false);
    }
  }, [projectId]);

  // 参照マスタの取得。フロー/ロールは専用 lib クライアントが無いため、
  // ASIS・ロールページと同じ生 fetch（accessToken ヘッダ）を踏襲する。
  const loadMasters = useCallback(async () => {
    const [flowRes, roleRes, systemsData, ioData] = await Promise.all([
      fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
        headers: authHeaders(),
      }).catch(() => null),
      fetch(`${API_URL}/api/roles/project/${projectId}`, { headers: authHeaders() }).catch(
        () => null,
      ),
      systemApi.list(projectId).catch(() => [] as SystemMaster[]),
      informationTypeApi.list(projectId).catch(() => [] as InformationType[]),
    ]);
    if (flowRes?.ok) {
      const data = await flowRes.json().catch(() => []);
      setFlows(Array.isArray(data) ? data : []);
    }
    if (roleRes?.ok) {
      const data = await roleRes.json().catch(() => []);
      setRoles(Array.isArray(data) ? data : []);
    }
    setSystems(systemsData);
    setInformationTypes(ioData);
  }, [projectId]);

  useEffect(() => {
    void loadKpis();
    void loadMasters();
  }, [loadKpis, loadMasters]);

  /** AI生成・プリセット追加されたKPIをハイライトしつつ一覧を更新する。 */
  const handleCreated = useCallback(
    (created: KpiDto[]) => {
      setHighlightIds(new Set(created.map((k) => k.id)));
      void loadKpis();
    },
    [loadKpis],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI作成"
        description="業務フローの INPUT/OUTPUT やシステムから、業務KPI・AI精度KPI を AI で下書き作成します。"
        help="タブで「業務KPI」「AI精度KPI」を切り替えて下書きを作り、下のKPI一覧で内容を確認・採用します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '「業務KPI」タブで対象の業務フローを選ぶと、フロー上の INPUT/OUTPUT・帳票が種別ごと（帳票/データ/物体）に表示されます。',
              '測りたい INPUT/OUTPUT にチェックを入れ、追加指示を添えて「AIでKPIを作成」を押すと下書きKPIが生成されます。',
              '「AI精度KPI」タブでは対象システムを選び、精度指標プリセット（認識精度・自動化率など）をワンクリックで追加するか、AIで生成します。',
              '下のKPI一覧で内容を確認し、下書きは「採用」で運用中にします。カードをクリックすると全項目（SMART採点・IO紐づけ含む）を編集できます。',
            ]}
          />
        }
      />

      {/* タブ（業務KPI / AI精度KPI） */}
      <Card className="bg-white">
        <div className="p-4">
          <Tabs defaultValue="business">
            <TabsList>
              <TabsTrigger value="business" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                業務KPI
              </TabsTrigger>
              <TabsTrigger value="ai-quality" className="gap-1.5">
                <Cpu className="h-3.5 w-3.5" />
                AI精度KPI
              </TabsTrigger>
            </TabsList>
            <TabsContent value="business" className="mt-4">
              <BusinessKpiTab projectId={projectId} flows={flows} onGenerated={handleCreated} />
            </TabsContent>
            <TabsContent value="ai-quality" className="mt-4">
              <AiQualityKpiTab
                projectId={projectId}
                flows={flows}
                systems={systems}
                onCreated={handleCreated}
              />
            </TabsContent>
          </Tabs>
        </div>
      </Card>

      {/* KPI一覧（タブ共通） */}
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
      />
    </div>
  );
}

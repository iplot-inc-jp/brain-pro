'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Database,
  GitBranch,
  Users,
  Plus,
  ArrowRight,
  Loader2,
  ChevronLeft,
  Table as TableIcon,
  Clock,
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string;
};

type TableData = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  tags: string[];
};

type FlowData = {
  id: string;
  name: string;
  description?: string;
  version: number;
  updatedAt: string;
};

type RoleData = {
  id: string;
  name: string;
  type: string;
  color: string;
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tables, setTables] = useState<TableData[]>([]);
  const [flows, setFlows] = useState<FlowData[]>([]);
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(true);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchProjectData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getHeaders();

      // 各データを並列で取得
      const [tablesRes, flowsRes, rolesRes] = await Promise.all([
        fetch(`${API_URL}/api/tables/project/${projectId}`, { headers }),
        fetch(`${API_URL}/api/business-flows/project/${projectId}`, { headers }),
        fetch(`${API_URL}/api/roles/project/${projectId}`, { headers }),
      ]);

      if (tablesRes.ok) setTables(await tablesRes.json());
      if (flowsRes.ok) setFlows(await flowsRes.json());
      if (rolesRes.ok) setRoles(await rolesRes.json());

      // プロジェクト名をローカルストレージから取得
      const projectName = localStorage.getItem('selectedProjectName');
      if (projectName) {
        setProject({ id: projectId, name: projectName, slug: '', description: '' });
      }
    } catch (err) {
      console.error('Failed to fetch project data:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  // キーボードショートカット
  const openHowTo = useCallback(() => {
    document
      .getElementById('howto-trigger-overview')
      ?.querySelector<HTMLButtonElement>('button')
      ?.click();
  }, []);

  useKeyboardShortcuts([
    { combo: 't', handler: () => router.push(`/dashboard/projects/${projectId}/catalog`) },
    { combo: 'f', handler: () => router.push(`/dashboard/projects/${projectId}/flows`) },
    { combo: 'r', handler: () => router.push(`/dashboard/projects/${projectId}/roles`) },
    { combo: 'shift+/', handler: openHowTo },
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/projects">
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="w-4 h-4 mr-1" />
              プロジェクト一覧
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-3xl font-bold text-gray-900">{project?.name || 'プロジェクト'}</h1>
              <HelpTooltip text="プロジェクトの概要ページです。データカタログ（テーブル）・業務フロー・ロールの3要素を横断的に把握できます。ASIS（現状）の業務フローを整理し、TOBE（あるべき姿）へ向けたGAP（差分）と打ち手を検討する起点になります。" />
            </div>
            <p className="text-gray-500 mt-1">プロジェクトの概要</p>
          </div>
        </div>
        <span id="howto-trigger-overview" className="contents">
          <HowToPanel
            steps={[
              '上部の3つのカードでテーブル・業務フロー・ロールの登録数をひと目で確認できます。',
              '各セクションの「すべて表示」から、データカタログ・業務フロー・ロールの管理ページへ移動できます。',
              '一覧の項目をクリックすると、そのテーブルやフローの詳細ページを開けます。',
              'データが無いセクションでは、その場の追加ボタンから登録を始められます。',
            ]}
            shortcuts={[
              { keys: 'T', desc: 'データカタログへ移動' },
              { keys: 'F', desc: '業務フローへ移動' },
              { keys: 'R', desc: 'ロールへ移動' },
              { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
            ]}
          />
        </span>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-white border-gray-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
              テーブル数
              <HelpTooltip text="データカタログに登録されたテーブル（データの入れ物）の数です。各テーブルはカラム定義やタグを持ち、業務フローのCRUD（作成・参照・更新・削除）と紐付きます。" />
            </CardTitle>
            <Database className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{tables.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-white border-gray-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
              業務フロー
              <HelpTooltip text="ロールごとのスイムレーンで処理の流れを表した図の数です。ASIS（現状）とTOBE（あるべき姿）を描き分け、その差（GAP）からシステム化の打ち手を導きます。" />
            </CardTitle>
            <GitBranch className="h-4 w-4 text-cyan-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{flows.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-white border-gray-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
              ロール
              <HelpTooltip text="業務を担当する主体（人・システム・その他）の数です。業務フロー図ではロールごとに横レーン（スイムレーン）が割り当てられ、誰が・何がその処理を担うかを表します。" />
            </CardTitle>
            <Users className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-900">{roles.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Content Sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tables Section */}
        <Card className="bg-white border-gray-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-gray-900">データカタログ</CardTitle>
            </div>
            <Link href={`/dashboard/projects/${projectId}/catalog`}>
              <Button variant="ghost" size="sm" className="text-blue-600">
                すべて表示
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {tables.length > 0 ? (
              <div className="space-y-2">
                {tables.slice(0, 5).map((table) => (
                  <Link
                    key={table.id}
                    href={`/dashboard/projects/${projectId}/catalog/${table.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <TableIcon className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{table.displayName || table.name}</p>
                        <code className="text-xs text-gray-500">{table.name}</code>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-gray-500 mb-2">テーブルがありません</p>
                <Link href={`/dashboard/projects/${projectId}/catalog`}>
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    テーブル追加
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Flows Section */}
        <Card className="bg-white border-gray-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-cyan-600" />
              <CardTitle className="text-gray-900">業務フロー</CardTitle>
            </div>
            <Link href={`/dashboard/projects/${projectId}/flows`}>
              <Button variant="ghost" size="sm" className="text-cyan-600">
                すべて表示
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {flows.length > 0 ? (
              <div className="space-y-2">
                {flows.slice(0, 5).map((flow) => (
                  <Link
                    key={flow.id}
                    href={`/dashboard/projects/${projectId}/flows/${flow.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <GitBranch className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{flow.name}</p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>v{flow.version}</span>
                          <Clock className="w-3 h-3" />
                          <span>{new Date(flow.updatedAt).toLocaleDateString('ja-JP')}</span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-gray-500 mb-2">フローがありません</p>
                <Link href={`/dashboard/projects/${projectId}/flows`}>
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    フロー作成
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Roles Section */}
        <Card className="bg-white border-gray-200 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-gray-900">ロール</CardTitle>
            </div>
            <Link href={`/dashboard/projects/${projectId}/roles`}>
              <Button variant="ghost" size="sm" className="text-purple-600">
                すべて表示
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {roles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <div
                    key={role.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200"
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: role.color }}
                    />
                    <span className="text-sm text-gray-700">{role.name}</span>
                    <span className="text-xs text-gray-400">
                      {role.type === 'HUMAN' ? '人' : role.type === 'SYSTEM' ? 'システム' : 'その他'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-gray-500 mb-2">ロールがありません</p>
                <Link href={`/dashboard/projects/${projectId}/roles`}>
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    ロール追加
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


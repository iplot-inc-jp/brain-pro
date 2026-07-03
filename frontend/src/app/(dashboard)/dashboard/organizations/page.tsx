'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, Loader2, ArrowRight, Settings, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { useProject } from '@/contexts/ProjectContext';
import { CreateCompanyDialog } from '@/components/company/CreateCompanyDialog';
import { companyRoleLabel, isCompanyAdminRole, SUPER_ADMIN_LABEL } from '@/lib/roles';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type MyOrg = { id: string; name: string; slug: string; role: string };

/**
 * 「会社」ページ（全ユーザー向け）。自分が所属している会社の一覧をカードで表示し、
 * 切り替え（開く）・新規作成・（会社管理者/すべての管理者は）設定への導線を提供する。
 */
export default function OrganizationsPage() {
  const router = useRouter();
  const { selectOrganization, fetchOrganizations: refreshContext } = useProject();
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const getHeaders = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: getHeaders() });
      if (res.ok) {
        const me = await res.json();
        setOrgs(Array.isArray(me?.organizations) ? me.organizations : []);
        setIsSuperAdmin(Boolean(me?.isSuperAdmin));
      }
    } catch (e) {
      console.error('Failed to load organizations', e);
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  function openOrg(org: MyOrg) {
    localStorage.setItem('selectedOrganizationId', org.id);
    // ProjectContext 側の選択も更新（左上スイッチャーと同期）
    selectOrganization({ id: org.id, name: org.name, slug: org.slug });
    router.push('/dashboard/projects');
  }

  return (
    <div className="space-y-6" style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            会社
            <HelpTooltip text="あなたが所属している会社の一覧です。カードの「開く」で切り替え、会社管理者は「設定」からメンバー招待・APIキー設定ができます。" />
            {isSuperAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                {SUPER_ADMIN_LABEL}
              </span>
            )}
          </h1>
          <p className="text-gray-500 mt-1">所属している会社の一覧</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && (
            <Link href="/dashboard/companies">
              <Button variant="outline" className="border-gray-300 text-gray-700">
                <Settings className="h-4 w-4 mr-2" />
                すべての会社を管理
              </Button>
            </Link>
          )}
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreateOpen(true)}>
            <Building2 className="h-4 w-4 mr-2" />
            会社を作成
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : orgs.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4 border border-blue-200">
              <Building2 className="h-8 w-8 text-blue-500" />
            </div>
            <p className="text-gray-700 mb-2 font-medium">所属している会社がありません</p>
            <p className="text-sm text-gray-500 mb-4">
              会社を作成すると、あなたがオーナーになります。あとからメンバーを招待できます。
            </p>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreateOpen(true)}>
              <Building2 className="h-4 w-4 mr-2" />
              会社を作成
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => {
            const admin = isCompanyAdminRole(org.role);
            return (
              <Card key={org.id} className="bg-white border-gray-200 hover:shadow-lg transition-all">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-6 w-6 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-gray-900 text-lg font-semibold truncate">{org.name}</h3>
                      <code className="text-xs text-gray-500">{org.slug}</code>
                    </div>
                    <span
                      className={
                        'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0 ' +
                        (admin
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-gray-100 text-gray-600 border border-gray-200')
                      }
                    >
                      {companyRoleLabel(org.role)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => openOrg(org)}
                    >
                      開く
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                    {(admin || isSuperAdmin) && (
                      <Link href={`/dashboard/companies/${org.id}`}>
                        <Button variant="outline" className="border-gray-300 text-gray-700" title="設定・メンバー">
                          <Settings className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (org) => {
          await refreshContext();
          await load();
          selectOrganization({ id: org.id, name: org.name, slug: org.slug });
        }}
      />
    </div>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Building2,
  Plus,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Power,
  PowerOff,
  Settings as SettingsIcon,
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type OrgStatus = 'active' | 'suspended';

type Organization = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status?: OrgStatus;
};

export default function CompaniesPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState({ name: '', slug: '', description: '' });

  const getHeaders = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setIsSuperAdmin(Boolean(data?.isSuperAdmin));
        return Boolean(data?.isSuperAdmin);
      }
    } catch (err) {
      console.error('Failed to fetch current user:', err);
    }
    setIsSuperAdmin(false);
    return false;
  }, [getHeaders]);

  const fetchOrganizations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/organizations`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setOrganizations(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  }, [getHeaders]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const superAdmin = await fetchMe();
      if (superAdmin) {
        await fetchOrganizations();
      }
      setLoading(false);
    })();
  }, [fetchMe, fetchOrganizations]);

  const handleCreateCompany = async () => {
    if (!newCompany.name || !newCompany.slug) return;
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(newCompany),
      });
      if (res.ok) {
        await fetchOrganizations();
        setIsCreateDialogOpen(false);
        setNewCompany({ name: '', slug: '', description: '' });
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.message || '会社の作成に失敗しました');
      }
    } catch (err) {
      console.error('Failed to create company:', err);
      setError('エラーが発生しました');
    }
  };

  const toggleStatus = async (org: Organization) => {
    const next: OrgStatus = org.status === 'suspended' ? 'active' : 'suspended';
    setBusyId(org.id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${org.id}/settings`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setOrganizations((prev) =>
          prev.map((o) => (o.id === org.id ? { ...o, status: next } : o)),
        );
      } else {
        setError('ステータスの変更に失敗しました');
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      setError('エラーが発生しました');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]" style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // 全体管理者以外はアクセス不可
  if (!isSuperAdmin) {
    return (
      <div
        className="flex flex-col items-center justify-center h-[400px] text-center"
        style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}
      >
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4 border border-amber-200">
          <ShieldAlert className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">全体管理者のみ利用できます</h1>
        <p className="text-gray-500 mt-2">このページは全体管理者のみアクセスできます。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            会社管理
            <HelpTooltip text="会社（組織）の一覧です。全体管理者は会社の作成・停止・再開ができます。各会社の設定からAPIキーやメンバーを管理できます。" />
          </h1>
          <p className="text-gray-500 mt-1">会社（組織）の作成・管理を行います</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HowToPanel
            open={howToOpen}
            onOpenChange={setHowToOpen}
            steps={[
              '「会社を作成」から会社名・スラッグ（URL用の短い識別子）・説明を入力して会社を作成します。',
              'スラッグは英小文字・数字・ハイフン（例: acme-inc）で入力してください。',
              '各会社のカードの「停止 / 再開」でステータスを切り替えられます。停止中の会社はサービスを利用できません。',
              '「設定」を押すと、その会社のAnthropic APIキーやメンバー管理画面へ移動します。',
            ]}
            shortcuts={[{ keys: '?', desc: 'この操作方法を開く' }]}
          />
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                会社を作成
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-gray-200">
              <DialogHeader>
                <DialogTitle className="text-gray-900">会社を作成</DialogTitle>
                <DialogDescription className="text-gray-500">
                  新しい会社（組織）を作成します
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-gray-700">会社名</Label>
                  <Input
                    value={newCompany.name}
                    onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
                    placeholder="株式会社サンプル"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700 flex items-center gap-1.5">
                    スラッグ
                    <HelpTooltip text="URLや内部識別に使う短い名前です。英小文字・数字・ハイフン（例: acme-inc）で、会社を一意に識別します。" />
                  </Label>
                  <Input
                    value={newCompany.slug}
                    onChange={(e) => setNewCompany({ ...newCompany, slug: e.target.value })}
                    placeholder="acme-inc"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">説明</Label>
                  <Input
                    value={newCompany.description}
                    onChange={(e) => setNewCompany({ ...newCompany, description: e.target.value })}
                    placeholder="会社の説明"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  className="border-gray-300 text-gray-700"
                >
                  キャンセル
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateCompany}>
                  作成
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && !isCreateDialogOpen && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">{error}</div>
      )}

      {/* Companies Grid */}
      {organizations.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {organizations.map((org) => {
            const suspended = org.status === 'suspended';
            return (
              <Card key={org.id} className="bg-white border-gray-200 hover:shadow-lg transition-all">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                        <Building2 className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-gray-900 text-lg">{org.name}</CardTitle>
                        <code className="text-xs text-gray-500">{org.slug}</code>
                      </div>
                    </div>
                    <span
                      className={
                        suspended
                          ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200'
                          : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200'
                      }
                    >
                      {suspended ? '停止中' : '稼働中'}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-gray-500 line-clamp-2 min-h-[2.5rem]">
                    {org.description || '会社の説明がありません'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-300 text-gray-700 flex-1"
                      onClick={() => router.push(`/dashboard/companies/${org.id}`)}
                    >
                      <SettingsIcon className="h-4 w-4 mr-1.5" />
                      設定
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === org.id}
                      onClick={() => toggleStatus(org)}
                      className={
                        suspended
                          ? 'border-green-300 text-green-700 hover:bg-green-50'
                          : 'border-red-300 text-red-700 hover:bg-red-50'
                      }
                    >
                      {busyId === org.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : suspended ? (
                        <>
                          <Power className="h-4 w-4 mr-1.5" />
                          再開
                        </>
                      ) : (
                        <>
                          <PowerOff className="h-4 w-4 mr-1.5" />
                          停止
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Building2 className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">会社がありません</p>
            <p className="text-sm text-gray-400 mb-4">新しい会社を作成してください</p>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              会社を作成
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

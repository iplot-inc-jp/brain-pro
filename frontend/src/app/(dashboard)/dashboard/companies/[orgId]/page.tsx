'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Building2,
  Key,
  Users,
  Loader2,
  Check,
  Eye,
  EyeOff,
  ShieldAlert,
  ArrowLeft,
  UserPlus,
  Trash2,
  KeyRound,
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { InviteLinksPanel } from '@/components/company/InviteLinksPanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type OrgStatus = 'active' | 'suspended';
type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

type Organization = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status?: OrgStatus;
  hasAnthropicApiKey?: boolean;
};

type Member = {
  userId: string;
  email: string;
  name?: string | null;
  role: MemberRole;
};

// 会社管理者 = OWNER/ADMIN, 会社メンバー = MEMBER/VIEWER
function isCompanyAdminRole(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function roleLabel(role: MemberRole): string {
  return isCompanyAdminRole(role) ? '会社管理者' : '会社メンバー';
}

export default function CompanySettingsPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.orgId as string;

  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [howToOpen, setHowToOpen] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 権限
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // ステータス
  const [status, setStatus] = useState<OrgStatus>('active');
  const [statusSaving, setStatusSaving] = useState(false);

  // APIキー
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keySaving, setKeySaving] = useState(false);

  // メンバー追加
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'general'>('general');
  const [addingMember, setAddingMember] = useState(false);

  const getHeaders = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/members`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const list: Member[] = Array.isArray(data) ? data : [];
        setMembers(list);
        return list;
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    }
    return [] as Member[];
  }, [orgId, getHeaders]);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      setLoading(true);

      // 現在のユーザー
      let superAdmin = false;
      let userId: string | null = null;
      try {
        const meRes = await fetch(`${API_URL}/api/auth/me`, { headers: getHeaders() });
        if (meRes.ok) {
          const me = await meRes.json();
          superAdmin = Boolean(me?.isSuperAdmin);
          userId = me?.id ?? null;
        }
      } catch (err) {
        console.error('Failed to fetch current user:', err);
      }
      setIsSuperAdmin(superAdmin);
      setMyUserId(userId);

      // 会社情報・設定
      try {
        const [orgRes, settingsRes] = await Promise.all([
          fetch(`${API_URL}/api/organizations/${orgId}`, { headers: getHeaders() }),
          fetch(`${API_URL}/api/organizations/${orgId}/settings`, { headers: getHeaders() }),
        ]);
        let merged: Organization | null = null;
        if (orgRes.ok) {
          merged = await orgRes.json();
        }
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          merged = { ...(merged || ({} as Organization)), ...settings };
        }
        if (merged) {
          setOrg(merged);
          setStatus((merged.status as OrgStatus) || 'active');
          setHasApiKey(Boolean(merged.hasAnthropicApiKey));
        }
      } catch (err) {
        console.error('Failed to fetch organization:', err);
      }

      // メンバー
      const memberList = await fetchMembers();

      // 認可: すべての管理者 もしくは その会社の会社管理者(OWNER/ADMIN)
      const myMembership = memberList.find((m) => m.userId === userId);
      const companyAdmin = myMembership ? isCompanyAdminRole(myMembership.role) : false;
      setAuthorized(superAdmin || companyAdmin);

      setLoading(false);
    })();
  }, [orgId, getHeaders, fetchMembers]);

  const handleSaveStatus = async (next: OrgStatus) => {
    setStatusSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/settings`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        setStatus(next);
        setMessage({ type: 'success', text: 'ステータスを更新しました' });
      } else {
        setMessage({ type: 'error', text: 'ステータスの更新に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setStatusSaving(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!anthropicApiKey) return;
    setKeySaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/settings`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ anthropicApiKey }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setHasApiKey(data?.hasAnthropicApiKey ?? true);
        setAnthropicApiKey('');
        setMessage({ type: 'success', text: 'APIキーを保存しました' });
      } else {
        setMessage({ type: 'error', text: 'APIキーの保存に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to save api key:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setKeySaving(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!confirm('この会社のAPIキーを削除してもよろしいですか？')) return;
    setKeySaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/settings`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ anthropicApiKey: '' }),
      });
      if (res.ok) {
        setHasApiKey(false);
        setMessage({ type: 'success', text: 'APIキーを削除しました' });
      } else {
        setMessage({ type: 'error', text: 'APIキーの削除に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to clear api key:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setKeySaving(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail) return;
    setAddingMember(true);
    setMessage(null);
    // 会社管理者 → OWNER, 会社メンバー → MEMBER
    const role: MemberRole = newMemberRole === 'admin' ? 'OWNER' : 'MEMBER';
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/members`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          email: newMemberEmail,
          role,
          name: newMemberName || undefined,
          password: newMemberPassword || undefined,
        }),
      });
      if (res.ok) {
        await fetchMembers();
        setNewMemberEmail('');
        setNewMemberName('');
        setNewMemberPassword('');
        setNewMemberRole('general');
        const body = await res.json().catch(() => null);
        setMessage({
          type: 'success',
          text: body?.invited
            ? 'メンバーを招待しました（本人が登録するか、パスワードを設定するとログインできます）'
            : 'メンバーを追加しました',
        });
      } else {
        const body = await res.json().catch(() => null);
        setMessage({ type: 'error', text: body?.message || 'メンバーの追加に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to add member:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setAddingMember(false);
    }
  };

  const handleChangeRole = async (member: Member, nextKind: 'admin' | 'general') => {
    const role: MemberRole = nextKind === 'admin' ? 'OWNER' : 'MEMBER';
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/members/${member.userId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setMembers((prev) =>
          prev.map((m) => (m.userId === member.userId ? { ...m, role } : m)),
        );
        setMessage({ type: 'success', text: '権限を変更しました' });
      } else {
        setMessage({ type: 'error', text: '権限の変更に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to change role:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    }
  };

  const handleResetPassword = async (member: Member) => {
    const pw = window.prompt(`${member.email} の新しいパスワードを入力（4文字以上）`);
    if (!pw) return;
    if (pw.length < 4) {
      setMessage({ type: 'error', text: 'パスワードは4文字以上にしてください' });
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/members/${member.userId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        await fetchMembers();
        setMessage({ type: 'success', text: 'パスワードを設定しました' });
      } else {
        setMessage({ type: 'error', text: 'パスワードの設定に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to reset password:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    }
  };

  const handleRemoveMember = async (member: Member) => {
    if (!confirm(`${member.email} を会社から削除しますか？`)) return;
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/members/${member.userId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
        setMessage({ type: 'success', text: 'メンバーを削除しました' });
      } else {
        setMessage({ type: 'error', text: 'メンバーの削除に失敗しました' });
      }
    } catch (err) {
      console.error('Failed to remove member:', err);
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-[400px]"
        style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div
        className="flex flex-col items-center justify-center h-[400px] text-center"
        style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}
      >
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mb-4 border border-amber-200">
          <ShieldAlert className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">この会社を管理する権限がありません</h1>
        <p className="text-gray-500 mt-2">会社管理者またはすべての管理者のみ利用できます。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontFamily: '"Yu Gothic", "游ゴシック", sans-serif' }}>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            onClick={() => router.push('/dashboard/companies')}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            会社一覧へ
          </button>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="h-7 w-7 text-blue-600" />
            {org?.name || '会社設定'}
            <HelpTooltip text="この会社のAnthropic APIキー・稼働ステータス・メンバーを管理します。APIキーは会社単位で利用され、設定の有無のみ表示されます。" />
          </h1>
          <p className="text-gray-500 mt-1">
            <code className="text-xs">{org?.slug}</code>
          </p>
        </div>
        <HowToPanel
          open={howToOpen}
          onOpenChange={setHowToOpen}
          steps={[
            '「AI設定」タブで、この会社専用のAnthropic APIキーを設定できます（設定の有無のみ表示されます）。',
            '「ステータス」タブで、会社の稼働 / 停止を切り替えます。停止中はサービスを利用できません。',
            '「メンバー」タブで、メールアドレスと権限（会社管理者 / 会社メンバー）を指定してメンバーを追加します。',
            '既存メンバーは権限の変更や削除ができます。会社管理者はメンバーの追加・権限変更ができます。',
          ]}
          shortcuts={[{ keys: '?', desc: 'この操作方法を開く' }]}
        />
      </div>

      {message && (
        <div
          className={
            message.type === 'success'
              ? 'p-4 rounded-lg bg-green-50 border border-green-200 text-green-800'
              : 'p-4 rounded-lg bg-red-50 border border-red-200 text-red-800'
          }
        >
          {message.text}
        </div>
      )}

      <Tabs defaultValue="ai" className="space-y-6">
        <TabsList className="bg-gray-100 border border-gray-200 max-w-full overflow-x-auto">
          <TabsTrigger value="ai" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <Key className="h-4 w-4 mr-2" />
            AI設定
          </TabsTrigger>
          <TabsTrigger value="status" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <Building2 className="h-4 w-4 mr-2" />
            ステータス
          </TabsTrigger>
          <TabsTrigger value="members" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <Users className="h-4 w-4 mr-2" />
            メンバー
          </TabsTrigger>
        </TabsList>

        {/* AI設定 */}
        <TabsContent value="ai">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900 flex items-center gap-2">
                Anthropic (Claude) APIキー
                <HelpTooltip text="この会社専用のAPIキーです。設定されている場合、この会社のプロジェクトでのAI処理にこのキーが優先的に使われます。未設定の場合はユーザー設定または全体設定が使われます。" />
              </CardTitle>
              <CardDescription className="text-gray-500">
                会社単位のAI APIキーを設定します（保存後はキー文字列は表示されません）
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">現在の状態</span>
                {hasApiKey ? (
                  <span className="inline-flex items-center gap-1.5 text-green-600 text-sm">
                    <Check className="h-4 w-4" />
                    設定済み
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">未設定</span>
                )}
              </div>

              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={hasApiKey ? '新しいキーで上書き...' : 'sk-ant-api03-...'}
                    value={anthropicApiKey}
                    onChange={(e) => setAnthropicApiKey(e.target.value)}
                    className="bg-white border-gray-300 text-gray-900 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveApiKey}
                    disabled={!anthropicApiKey || keySaving}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {keySaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    保存
                  </Button>
                  {hasApiKey && (
                    <Button
                      variant="outline"
                      onClick={handleClearApiKey}
                      disabled={keySaving}
                      className="border-red-300 text-red-600 hover:bg-red-50"
                    >
                      削除
                    </Button>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-500">
                APIキーは
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline ml-1"
                >
                  Anthropicコンソール
                </a>
                で取得できます。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ステータス */}
        <TabsContent value="status">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900">会社ステータス</CardTitle>
              <CardDescription className="text-gray-500">
                会社の稼働状態を切り替えます。停止中はサービスを利用できません。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">現在のステータス</span>
                <span
                  className={
                    status === 'suspended'
                      ? 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200'
                      : 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200'
                  }
                >
                  {status === 'suspended' ? '停止中' : '稼働中'}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleSaveStatus('active')}
                  disabled={statusSaving || status === 'active'}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {statusSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  稼働させる
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSaveStatus('suspended')}
                  disabled={statusSaving || status === 'suspended'}
                  className="border-red-300 text-red-600 hover:bg-red-50"
                >
                  停止する
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* メンバー */}
        <TabsContent value="members">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900 flex items-center gap-2">
                メンバー管理
                <HelpTooltip text="会社管理者(OWNER/ADMIN)は会社全体の管理ができます。会社メンバー(MEMBER/VIEWER)はプロジェクトの作業を行います。" />
              </CardTitle>
              <CardDescription className="text-gray-500">
                メールアドレスでメンバーを追加し、権限を管理します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <InviteLinksPanel orgId={orgId} />
              {/* 追加フォーム */}
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 text-sm">メールアドレス</Label>
                    <Input
                      type="email"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="bg-white border-gray-300 text-gray-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 text-sm flex items-center gap-1.5">
                      権限
                      <HelpTooltip text="会社管理者はメンバー管理や会社設定が可能です。会社メンバーはプロジェクト作業を行います。" />
                    </Label>
                    <Select
                      value={newMemberRole}
                      onValueChange={(v) => setNewMemberRole(v as 'admin' | 'general')}
                    >
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-gray-200">
                        <SelectItem value="general" className="text-gray-700">
                          会社メンバー
                        </SelectItem>
                        <SelectItem value="admin" className="text-gray-700">
                          会社管理者
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={handleAddMember}
                    disabled={!newMemberEmail || addingMember}
                  >
                    {addingMember ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-2" />
                    )}
                    追加
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 text-sm">氏名（任意）</Label>
                    <Input
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="山田 太郎"
                      className="bg-white border-gray-300 text-gray-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 text-sm flex items-center gap-1.5">
                      初期パスワード（任意）
                      <HelpTooltip text="管理者が初期パスワードを設定すると、本人はメール＋このパスワードで即ログインできます。空なら招待（本人が登録時に設定）。" />
                    </Label>
                    <Input
                      type="password"
                      value={newMemberPassword}
                      onChange={(e) => setNewMemberPassword(e.target.value)}
                      placeholder="未入力なら招待"
                      className="bg-white border-gray-300 text-gray-900"
                    />
                  </div>
                </div>
              </div>

              {/* メンバー一覧 */}
              {members.length > 0 ? (
                <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                  {members.map((m) => {
                    const kind: 'admin' | 'general' = isCompanyAdminRole(m.role)
                      ? 'admin'
                      : 'general';
                    const isMe = m.userId === myUserId;
                    return (
                      <div
                        key={m.userId}
                        className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {m.name || m.email}
                            {isMe && <span className="ml-2 text-xs text-blue-600">(自分)</span>}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{m.email}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                          <span className="hidden sm:inline text-xs text-gray-400">
                            {roleLabel(m.role)}
                          </span>
                          <Select
                            value={kind}
                            onValueChange={(v) => handleChangeRole(m, v as 'admin' | 'general')}
                          >
                            <SelectTrigger className="w-[150px] bg-white border-gray-300 text-gray-900 h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-gray-200">
                              <SelectItem value="general" className="text-gray-700">
                                会社メンバー
                              </SelectItem>
                              <SelectItem value="admin" className="text-gray-700">
                                会社管理者
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResetPassword(m)}
                            title="パスワードを設定/再設定"
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRemoveMember(m)}
                            className="border-red-300 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-6">メンバーがいません</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

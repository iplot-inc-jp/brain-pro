'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { User, Key, Loader2, Bot, Check, AlertCircle, Eye, EyeOff, Upload, Trash2 } from 'lucide-react'
import { UserAvatar } from '@/components/ui/user-avatar'
import { authApi } from '@/lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export default function AccountSettingsPage() {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // 公開API/MCP用のサービスアカウントAPIキー（sk_…）。IPROくん等の外部連携で使う。発行時だけ平文が返る。
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string; role?: string; organizationId?: string | null; keyPrefix: string; projectId: string | null; createdAt: string }>>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [keyRole, setKeyRole] = useState<'COMPANY_ADMIN' | 'GENERAL_USER'>('COMPANY_ADMIN');
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [orgProjects, setOrgProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null); // 発行直後だけ表示する平文キー
  const [keysBusy, setKeysBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // AI APIキー
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [hasAnthropicApiKey, setHasAnthropicApiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [aiKeyLoading, setAiKeyLoading] = useState(false);
  const [aiKeyTestResult, setAiKeyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  useEffect(() => {
    // 現在のユーザー情報を取得
    authApi
      .me()
      .then((me) => {
        setUser({ name: me?.name ?? '', email: me?.email ?? '' });
        setName(me?.name ?? '');
        setEmail(me?.email ?? '');
        setAvatarUrl(me?.avatarUrl ?? null);
      })
      .catch(() => {
        /* 未ログイン等は空のまま */
      });

    // ユーザー設定を取得
    fetchUserSettings();
    // 発行済みAPIキー一覧を取得
    fetchApiKeys();
    // 自分が属する会社（APIキーの発行先候補）を取得
    fetchOrgs();
  }, []);

  const fetchUserSettings = async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/user-settings`, { headers });
      if (res.ok) {
        const data = await res.json();
        setHasAnthropicApiKey(data.hasAnthropicApiKey);
      }
    } catch (err) {
      console.error('Failed to fetch user settings:', err);
    }
  };

  const handleSaveAiApiKey = async () => {
    setAiKeyLoading(true);
    setMessage(null);
    setAiKeyTestResult(null);
    
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/user-settings/api-keys`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ anthropicApiKey }),
      });

      if (res.ok) {
        const data = await res.json();
        setHasAnthropicApiKey(data.hasAnthropicApiKey);
        setAnthropicApiKey('');
        setMessage({ type: 'success', text: 'APIキーを保存しました' });
      } else {
        setMessage({ type: 'error', text: 'APIキーの保存に失敗しました' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setAiKeyLoading(false);
    }
  };

  const handleTestAiApiKey = async () => {
    setAiKeyLoading(true);
    setAiKeyTestResult(null);
    
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/user-settings/api-key/test`, { headers });

      if (res.ok) {
        const data = await res.json();
        if (data.anthropic === true) {
          setAiKeyTestResult({ success: true, message: 'APIキーは有効です' });
        } else if (data.anthropic === 'Not configured') {
          setAiKeyTestResult({ success: false, message: 'APIキーが設定されていません' });
        } else {
          setAiKeyTestResult({ success: false, message: `無効: ${data.anthropic}` });
        }
      }
    } catch (err) {
      setAiKeyTestResult({ success: false, message: 'テストに失敗しました' });
    } finally {
      setAiKeyLoading(false);
    }
  };

  const handleClearAiApiKey = async () => {
    if (!confirm('APIキーを削除してもよろしいですか？')) return;
    
    setAiKeyLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/user-settings/api-keys`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ anthropicApiKey: '' }),
      });

      if (res.ok) {
        setHasAnthropicApiKey(false);
        setMessage({ type: 'success', text: 'APIキーを削除しました' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setAiKeyLoading(false);
    }
  };

  // アイコン画像を選択 → クライアントで128pxに縮小しdata URL化して即保存。
  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: '画像ファイルを選択してください' });
      return;
    }
    setAvatarBusy(true);
    setMessage(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read error'));
        reader.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new window.Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('image error'));
        i.src = dataUrl;
      });
      const MAX = 128;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      let resized = dataUrl;
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        resized = canvas.toDataURL('image/jpeg', 0.85);
      }
      const updated = await authApi.updateMe({ avatarUrl: resized });
      setAvatarUrl(updated.avatarUrl ?? null);
      setMessage({ type: 'success', text: 'アイコンを更新しました' });
    } catch {
      setMessage({ type: 'error', text: 'アイコンの設定に失敗しました' });
    } finally {
      setAvatarBusy(false);
    }
  };

  // アイコンを頭文字デフォルトに戻す。
  const handleClearAvatar = async () => {
    setAvatarBusy(true);
    setMessage(null);
    try {
      await authApi.updateMe({ avatarUrl: null });
      setAvatarUrl(null);
      setMessage({ type: 'success', text: 'アイコンを頭文字に戻しました' });
    } catch {
      setMessage({ type: 'error', text: '操作に失敗しました' });
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleProfileSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const updated = await authApi.updateMe({
        name: name.trim() || null,
        avatarUrl,
      });
      setUser({ name: updated.name ?? '', email });
      setName(updated.name ?? '');
      setMessage({ type: 'success', text: 'プロフィールを更新しました' });
    } catch {
      setMessage({ type: 'error', text: '更新に失敗しました' });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'パスワードが一致しません' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      // TODO: パスワード変更API
      await new Promise(resolve => setTimeout(resolve, 500));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({ type: 'success', text: 'パスワードを変更しました' });
    } catch (err) {
      setMessage({ type: 'error', text: '変更に失敗しました' });
    } finally {
      setLoading(false);
    }
  };

  // 公開APIキー（sk_…）: 発行 / 一覧 / 失効。バックエンドは POST/GET/DELETE /api/api-keys。
  const fetchApiKeys = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/api-keys`, { headers: getHeaders() });
      if (res.ok) setApiKeys(await res.json());
    } catch (err) {
      console.error('Failed to fetch api keys:', err);
    }
  }, [getHeaders]);

  // 自分が属する会社一覧（キーの発行先）。取得後、先頭を既定選択にする。
  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/organizations`, { headers: getHeaders() });
      if (res.ok) {
        const data: Array<{ id: string; name: string }> = await res.json();
        setOrgs(data);
        setSelectedOrgId((cur) => cur || data[0]?.id || '');
      }
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  }, [getHeaders]);

  // 選択中の会社のプロジェクト一覧（一般ユーザーキーの紐付け先）。
  const fetchOrgProjects = useCallback(async (orgId: string) => {
    if (!orgId) { setOrgProjects([]); return; }
    try {
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/projects`, { headers: getHeaders() });
      if (res.ok) {
        const data: Array<{ id: string; name: string }> = await res.json();
        setOrgProjects(data);
        setSelectedProjectId((cur) => cur || data[0]?.id || '');
      } else {
        setOrgProjects([]);
      }
    } catch {
      setOrgProjects([]);
    }
  }, [getHeaders]);

  // 一般ユーザーを選ぶか会社を変えたら、その会社のプロジェクトを読み直す。
  useEffect(() => {
    if (keyRole === 'GENERAL_USER' && selectedOrgId) fetchOrgProjects(selectedOrgId);
  }, [keyRole, selectedOrgId, fetchOrgProjects]);

  const handleIssueKey = async () => {
    const name = newKeyName.trim() || 'IPROくん連携';
    if (!selectedOrgId) {
      setMessage({ type: 'error', text: '会社を選択してください' });
      return;
    }
    if (keyRole === 'GENERAL_USER' && !selectedProjectId) {
      setMessage({ type: 'error', text: '一般ユーザーのキーには紐付けるプロジェクトが必要です' });
      return;
    }
    setKeysBusy(true);
    setMessage(null);
    setIssuedKey(null);
    try {
      const res = await fetch(`${API_URL}/api/api-keys`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name,
          role: keyRole,
          organizationId: selectedOrgId,
          ...(keyRole === 'GENERAL_USER' ? { projectId: selectedProjectId } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setIssuedKey(data.key); // 平文キーはこのレスポンスでのみ返る
        setNewKeyName('');
        await fetchApiKeys();
        setMessage({ type: 'success', text: 'APIキーを発行しました。下のキーを今すぐコピーしてください（再表示できません）。' });
      } else {
        const err = await res.json().catch(() => null);
        setMessage({ type: 'error', text: err?.message || 'APIキーの発行に失敗しました（会社の管理者のみ発行できます）' });
      }
    } catch {
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setKeysBusy(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!window.confirm('このAPIキーを失効しますか？このキーを使っている連携は無効になります。')) return;
    try {
      const res = await fetch(`${API_URL}/api/api-keys/${id}`, { method: 'DELETE', headers: getHeaders() });
      if (res.ok) {
        await fetchApiKeys();
        setMessage({ type: 'success', text: 'APIキーを失効しました' });
      } else {
        setMessage({ type: 'error', text: '失効に失敗しました' });
      }
    } catch {
      setMessage({ type: 'error', text: '失効に失敗しました' });
    }
  };

  const copyIssuedKey = () => {
    if (!issuedKey) return;
    navigator.clipboard.writeText(issuedKey);
    setMessage({ type: 'success', text: 'APIキーをコピーしました' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">アカウント設定</h1>
        <p className="text-gray-500 mt-1">アカウントの設定を管理</p>
      </div>

      {/* メッセージ表示 */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="bg-gray-100 border border-gray-200 max-w-full overflow-x-auto">
          <TabsTrigger value="profile" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <User className="h-4 w-4 mr-2" />
            プロフィール
          </TabsTrigger>
          <TabsTrigger value="ai" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <Bot className="h-4 w-4 mr-2" />
            AI設定
          </TabsTrigger>
          <TabsTrigger value="api" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <Key className="h-4 w-4 mr-2" />
            API
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900">プロフィール設定</CardTitle>
              <CardDescription className="text-gray-500">
                アカウントの基本情報を更新します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* プロフィールアイコン（未設定=頭文字デフォルト） */}
              <div className="flex items-center gap-4">
                <UserAvatar name={name} avatarUrl={avatarUrl} size={64} />
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-gray-500">
                    プロフィールアイコン（未設定のときは名前の頭文字を表示）
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                      {avatarBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      画像をアップロード
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={avatarBusy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleAvatarFile(f);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => void handleClearAvatar()}
                        disabled={avatarBusy}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        頭文字に戻す
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-gray-700">名前</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">メールアドレス</Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleProfileSave}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-gray-200 mt-6">
            <CardHeader>
              <CardTitle className="text-gray-900">パスワード変更</CardTitle>
              <CardDescription className="text-gray-500">
                セキュリティのためパスワードを定期的に更新してください
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-700">現在のパスワード</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-gray-700">新しいパスワード</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-700">確認用</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handlePasswordChange}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  パスワード変更
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Settings Tab */}
        <TabsContent value="ai">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900">AI API設定</CardTitle>
              <CardDescription className="text-gray-500">
                要求定義のAI変換機能に使用するAPIキーを設定します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Anthropic API Key */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">Anthropic (Claude) APIキー</h3>
                    <p className="text-sm text-gray-500">
                      要求定義のAI変換に使用されます
                    </p>
                  </div>
                  {hasAnthropicApiKey && (
                    <div className="flex items-center gap-2 text-green-600">
                      <Check className="h-4 w-4" />
                      <span className="text-sm">設定済み</span>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
                  <div className="relative">
                    <Input
                      type={showAnthropicKey ? 'text' : 'password'}
                      placeholder={hasAnthropicApiKey ? '新しいキーで上書き...' : 'sk-ant-api03-...'}
                      value={anthropicApiKey}
                      onChange={(e) => setAnthropicApiKey(e.target.value)}
                      className="bg-white border-gray-300 text-gray-900 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showAnthropicKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleSaveAiApiKey}
                      disabled={!anthropicApiKey || aiKeyLoading}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {aiKeyLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      保存
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleTestAiApiKey}
                      disabled={!hasAnthropicApiKey || aiKeyLoading}
                      className="border-gray-300"
                    >
                      接続テスト
                    </Button>
                    {hasAnthropicApiKey && (
                      <Button
                        variant="outline"
                        onClick={handleClearAiApiKey}
                        disabled={aiKeyLoading}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                      >
                        削除
                      </Button>
                    )}
                  </div>

                  {aiKeyTestResult && (
                    <div
                      className={`flex items-center gap-2 p-3 rounded-lg ${
                        aiKeyTestResult.success
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {aiKeyTestResult.success ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                      {aiKeyTestResult.message}
                    </div>
                  )}
                </div>

                <div className="text-sm text-gray-500">
                  <p>
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
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Tab */}
        <TabsContent value="api">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900">APIアクセス</CardTitle>
              <CardDescription className="text-gray-500">
                外部からのAPI連携やAIエージェント向けのアクセスキーを管理します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-600 mb-4">
                  公開API・AIエージェント（IPROくん等）向けの<strong>サービスアカウントAPIキー</strong>（<code className="font-mono">sk_…</code>）を発行します。
                  キーは<strong>会社とロール（企業管理者／一般ユーザー）</strong>を持ちます。
                  キーは<strong>発行時に一度だけ全体が表示され</strong>、以後は先頭のみ表示されます。必ず控えを保存してください。
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">会社</Label>
                    <select
                      value={selectedOrgId}
                      onChange={(e) => { setSelectedOrgId(e.target.value); setSelectedProjectId(''); }}
                      className="w-full h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700"
                    >
                      {orgs.length === 0 && <option value="">（会社がありません）</option>}
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">ロール</Label>
                    <select
                      value={keyRole}
                      onChange={(e) => setKeyRole(e.target.value as 'COMPANY_ADMIN' | 'GENERAL_USER')}
                      className="w-full h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700"
                    >
                      <option value="COMPANY_ADMIN">企業管理者（会社の全プロジェクト）</option>
                      <option value="GENERAL_USER">一般ユーザー（紐付けプロジェクトのみ）</option>
                    </select>
                  </div>
                  {keyRole === 'GENERAL_USER' && (
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs text-gray-600">紐付けるプロジェクト</Label>
                      <select
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        className="w-full h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700"
                      >
                        {orgProjects.length === 0 && <option value="">（この会社にプロジェクトがありません）</option>}
                        {orgProjects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row mt-3">
                  <Input
                    placeholder="キーの名前（例: IPROくん連携）"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="bg-white border-gray-300 text-gray-700"
                  />
                  <Button onClick={handleIssueKey} disabled={keysBusy || !selectedOrgId} className="shrink-0">
                    {keysBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'キーを発行'}
                  </Button>
                </div>
                {issuedKey && (
                  <div className="mt-4 p-3 rounded-lg border border-amber-300 bg-amber-50">
                    <p className="text-xs text-amber-800 mb-2">
                      ⚠️ このキーは今だけ表示されます。今すぐコピーして安全な場所に保存してください（再表示できません）。
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input readOnly value={issuedKey} className="bg-white border-gray-300 text-gray-800 font-mono" />
                      <Button variant="outline" onClick={copyIssuedKey} className="border-gray-300 text-gray-700 shrink-0">
                        コピー
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">発行済みのキー</p>
                {apiKeys.length === 0 ? (
                  <p className="text-sm text-gray-500">まだ発行されたキーはありません。</p>
                ) : (
                  apiKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white">
                      <div>
                        <p className="text-sm text-gray-800">
                          {k.name}
                          {k.role && (
                            <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 align-middle">
                              {k.role === 'COMPANY_ADMIN' ? '企業管理者' : '一般ユーザー'}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">
                          {k.keyPrefix}…
                          {k.organizationId && `・${orgs.find((o) => o.id === k.organizationId)?.name ?? '会社'}`}
                          {k.projectId && '・案件紐付け'}
                          ・{new Date(k.createdAt).toLocaleDateString('ja-JP')}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => handleRevokeKey(k.id)}
                        className="border-red-200 text-red-600 hover:bg-red-50 shrink-0"
                        title="このキーを失効"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <p className="text-xs text-gray-500">
                発行したキーを IPROくんの <span className="font-mono">agent.ipro.iplot.jp/agent/links</span> の「APIキー」欄に貼り、
                このBrain ProのURLと一緒に保存すると連携が有効になります。
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-gray-200 mt-6">
            <CardHeader>
              <CardTitle className="text-gray-900">AIエージェント向けエクスポート</CardTitle>
              <CardDescription className="text-gray-500">
                AIエージェントがプロジェクトを理解するためのエンドポイント
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <code className="text-sm text-gray-700">
                    GET /api/export/project/:projectId/ai
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    プロジェクト全体の構造化データをJSON形式で取得
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <code className="text-sm text-gray-700">
                    GET /api/export/project/:projectId/mermaid
                  </code>
                  <p className="text-xs text-gray-500 mt-2">
                    ER図と業務フローをmermaid形式で取得
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

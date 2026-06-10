'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Database, Plus, Search, Table as TableIcon, Loader2, ChevronLeft, Upload, Download, FileText, Check, AlertCircle, Sparkles, Server, Trash2, ScanLine } from 'lucide-react';
import { informationTypeApi, type InformationType } from '@/lib/dfd';
import { InformationTypePicker } from '@/components/masters/InformationTypePicker';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type TableData = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  tags: string[];
  columnsCount?: number;
  /** 紐づく INPUT/OUTPUT（情報種別）ID。未設定なら null。 */
  informationTypeId?: string | null;
};

type DatabaseConnection = {
  id: string;
  name: string;
  dialect?: string;
  // connString is never returned in full / used for display only
  createdAt?: string;
};

type SchemaAnalyzeResult = {
  tables: number;
  columns: number;
  statuses: number;
};

type IntrospectResult = {
  tables: number;
  columns: number;
};

export default function ProjectCatalogPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [tables, setTables] = useState<TableData[]>([]);
  // INPUT/OUTPUT（情報種別）一覧。テーブルごとの紐付け select で使う。
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);
  // 紐付け保存中のテーブルID（select を一時的に無効化）
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newTable, setNewTable] = useState({ name: '', displayName: '', description: '' });
  const [csvContent, setCsvContent] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    tablesCreated: number;
    columnsCreated: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const howToRef = useRef<HTMLSpanElement>(null);

  // スキーマから取り込み(AI)
  const [isSchemaDialogOpen, setIsSchemaDialogOpen] = useState(false);
  const [schemaText, setSchemaText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaResult, setSchemaResult] = useState<SchemaAnalyzeResult | null>(null);

  // DB直結（複数）
  const [dbConnections, setDbConnections] = useState<DatabaseConnection[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [isAddDbDialogOpen, setIsAddDbDialogOpen] = useState(false);
  const [newDbConn, setNewDbConn] = useState({ name: '', dialect: 'postgres', connString: '' });
  const [savingDb, setSavingDb] = useState(false);
  const [dbDialogError, setDbDialogError] = useState<string | null>(null);
  // 接続ごとの解析(introspect)結果・状態
  const [introspectingId, setIntrospectingId] = useState<string | null>(null);
  const [introspectResults, setIntrospectResults] = useState<Record<string, IntrospectResult>>({});
  const [introspectErrors, setIntrospectErrors] = useState<Record<string, string>>({});
  const [deletingDbId, setDeletingDbId] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchTables = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/tables/project/${projectId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTables(data);
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  const fetchDbConnections = useCallback(async () => {
    setDbLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/database-connections`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDbConnections(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch database connections:', err);
    } finally {
      setDbLoading(false);
    }
  }, [projectId, getHeaders]);

  // INPUT/OUTPUT（情報種別）一覧を取得
  const fetchInformationTypes = useCallback(async () => {
    try {
      const data = await informationTypeApi.list(projectId);
      setInformationTypes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch information types:', err);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTables();
    fetchDbConnections();
    fetchInformationTypes();
  }, [fetchTables, fetchDbConnections, fetchInformationTypes]);

  // テーブルの INPUT/OUTPUT 紐付けを更新（PUT /tables/:id）。保存後にローカル state を更新。
  const handleLinkInformationType = useCallback(
    async (tableId: string, value: string) => {
      const informationTypeId = value === '__none__' ? null : value;
      setSavingLinkId(tableId);
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/tables/${tableId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ informationTypeId }),
        });
        if (res.ok) {
          setTables((prev) =>
            prev.map((t) => (t.id === tableId ? { ...t, informationTypeId } : t)),
          );
        }
      } catch (err) {
        console.error('Failed to update table information type:', err);
      } finally {
        setSavingLinkId(null);
      }
    },
    [getHeaders],
  );

  // キーボードショートカット
  useKeyboardShortcuts([
    { combo: 'mod+enter', handler: () => setIsCreateDialogOpen(true) },
    { combo: 'n', handler: () => setIsCreateDialogOpen(true) },
    {
      combo: '/',
      handler: (e) => {
        e.preventDefault();
        searchInputRef.current?.focus();
      },
    },
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
  ]);

  // スキーマから取り込み(AI)
  const handleAnalyzeSchema = async () => {
    if (!schemaText.trim()) return;
    setAnalyzing(true);
    setSchemaError(null);
    setSchemaResult(null);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/catalog/analyze-schema`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ schemaText }),
      });
      if (res.ok) {
        const result = await res.json();
        setSchemaResult({
          tables: result?.tables ?? 0,
          columns: result?.columns ?? 0,
          statuses: result?.statuses ?? 0,
        });
        await fetchTables();
      } else {
        const body = await res.json().catch(() => null);
        setSchemaError(body?.message || 'スキーマの解析に失敗しました');
      }
    } catch (err) {
      setSchemaError('スキーマの解析に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  const closeSchemaDialog = () => {
    setIsSchemaDialogOpen(false);
    setSchemaText('');
    setSchemaError(null);
    setSchemaResult(null);
  };

  // DB接続を追加
  const handleAddDbConnection = async () => {
    if (!newDbConn.name.trim() || !newDbConn.connString.trim()) return;
    setSavingDb(true);
    setDbDialogError(null);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/database-connections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newDbConn.name,
          dialect: newDbConn.dialect,
          connString: newDbConn.connString,
        }),
      });
      if (res.ok) {
        await fetchDbConnections();
        setIsAddDbDialogOpen(false);
        setNewDbConn({ name: '', dialect: 'postgres', connString: '' });
      } else {
        const body = await res.json().catch(() => null);
        setDbDialogError(body?.message || 'DB接続の追加に失敗しました');
      }
    } catch (err) {
      setDbDialogError('DB接続の追加に失敗しました');
    } finally {
      setSavingDb(false);
    }
  };

  // 解析(introspect)
  const handleIntrospect = async (id: string) => {
    setIntrospectingId(id);
    setIntrospectErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/database-connections/${id}/introspect`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const result = await res.json();
        setIntrospectResults((prev) => ({
          ...prev,
          [id]: { tables: result?.tables ?? 0, columns: result?.columns ?? 0 },
        }));
        await fetchTables();
      } else {
        const body = await res.json().catch(() => null);
        setIntrospectErrors((prev) => ({
          ...prev,
          [id]: body?.message || '解析に失敗しました',
        }));
      }
    } catch (err) {
      setIntrospectErrors((prev) => ({ ...prev, [id]: '解析に失敗しました' }));
    } finally {
      setIntrospectingId(null);
    }
  };

  // DB接続を削除
  const handleDeleteDbConnection = async (id: string) => {
    setDeletingDbId(id);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/database-connections/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        await fetchDbConnections();
        setIntrospectResults((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setIntrospectErrors((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to delete database connection:', err);
    } finally {
      setDeletingDbId(null);
    }
  };

  const handleCreateTable = async () => {
    if (!newTable.name) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/tables`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          name: newTable.name,
          displayName: newTable.displayName || null,
          description: newTable.description || null,
          tags: [],
        }),
      });
      if (res.ok) {
        await fetchTables();
        setIsCreateDialogOpen(false);
        setNewTable({ name: '', displayName: '', description: '' });
      }
    } catch (err) {
      console.error('Failed to create table:', err);
    }
  };

  // CSVテンプレートをダウンロード
  const handleDownloadTemplate = async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/tables/import/csv/template`, { headers });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([data.template], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'data_catalog_template.csv';
        link.click();
      }
    } catch (err) {
      console.error('Failed to download template:', err);
    }
  };

  // ファイル選択ハンドラー
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCsvContent(content);
      };
      reader.readAsText(file);
    }
  };

  // CSVインポート実行
  const handleImportCsv = async () => {
    if (!csvContent.trim()) return;

    setImporting(true);
    setImportResult(null);

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/tables/import/csv`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          csv: csvContent,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setImportResult(result);
        if (result.success || result.tablesCreated > 0 || result.columnsCreated > 0) {
          await fetchTables();
        }
      }
    } catch (err) {
      setImportResult({
        success: false,
        tablesCreated: 0,
        columnsCreated: 0,
        errors: ['インポートに失敗しました'],
      });
    } finally {
      setImporting(false);
    }
  };

  // インポートダイアログを閉じる
  const closeImportDialog = () => {
    setIsImportDialogOpen(false);
    setCsvContent('');
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const filteredTables = tables.filter(
    (table) =>
      table.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      table.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      table.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="w-4 h-4 mr-1" />
              戻る
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              データカタログ
              <HelpTooltip text="システムが扱うデータの「設計図の一覧」です。テーブル（データのまとまり）とカラム（項目）のメタデータを一元管理し、CRUD表やER図の元データになります。" />
            </h1>
            <p className="text-gray-500 mt-1">テーブルとカラムのメタデータを管理</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span ref={howToRef} className="inline-flex">
            <HowToPanel
              steps={[
                'データの取り込み方法は3通り。①「DB直結」で接続文字列を登録し解析、②「スキーマから取り込み(AI)」でDDL/SQL/Prismaを貼り付けてAI解析、③「テーブル追加」で手動作成。',
                'DB直結またはスキーマ貼付で取り込むと、テーブル・カラム・ステータスがAIにより自動生成されます。',
                '生成・作成されたテーブルカードをクリックすると詳細画面でカラムやCRUD操作を編集できます。',
                '検索ボックスでテーブル名・表示名・説明を絞り込めます。',
              ]}
              shortcuts={[
                { keys: '⌘/Ctrl+Enter', desc: 'テーブル追加ダイアログを開く' },
                { keys: 'n', desc: 'テーブル追加ダイアログを開く' },
                { keys: '/', desc: '検索ボックスにフォーカス' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </span>
          <ManualButton feature="catalog" />
          {/* スキーマから取り込み(AI) */}
          <Dialog open={isSchemaDialogOpen} onOpenChange={(open) => {
            if (!open) closeSchemaDialog();
            else setIsSchemaDialogOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50">
                <Sparkles className="h-4 w-4 mr-2" />
                スキーマから取り込み(AI)
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-gray-200 max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-gray-900 flex items-center gap-2">
                  スキーマから取り込み(AI)
                  <HelpTooltip text="DBに接続せず、設計図テキスト（DDL/SQL/Prisma）を貼り付けるだけでAIがテーブル・カラム・ステータスを推定生成します。設計途中や接続情報が無い場面向け。実DBがある場合は「DB直結」の方が正確です。" />
                </DialogTitle>
                <DialogDescription className="text-gray-500">
                  DDL/SQL/Prisma など任意のスキーマテキストを貼り付けると、AIが解析してテーブル/カラム/ステータスを生成します。生成結果は既存のカタログ編集UIから編集できます。
                </DialogDescription>
              </DialogHeader>

              {!schemaResult ? (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label className="text-gray-700">スキーマテキスト（DDL / SQL / Prisma など）</Label>
                    <Textarea
                      value={schemaText}
                      onChange={(e) => setSchemaText(e.target.value)}
                      placeholder={`CREATE TABLE users (\n  id UUID PRIMARY KEY,\n  email VARCHAR(255) NOT NULL UNIQUE,\n  status VARCHAR(20)\n);\n\n-- または Prisma\nmodel User {\n  id    String @id\n  email String @unique\n}`}
                      className="bg-white border-gray-300 text-gray-900 font-mono text-xs h-64"
                    />
                  </div>
                  {schemaError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                      {schemaError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6">
                  <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                    <div className="flex items-center gap-2 mb-3">
                      <Check className="h-5 w-5 text-green-600" />
                      <span className="font-medium text-green-700">解析完了</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-gray-700">
                        生成されたテーブル: <strong>{schemaResult.tables}</strong>
                      </p>
                      <p className="text-gray-700">
                        生成されたカラム: <strong>{schemaResult.columns}</strong>
                      </p>
                      <p className="text-gray-700">
                        生成されたステータス: <strong>{schemaResult.statuses}</strong>
                      </p>
                    </div>
                    <p className="mt-3 text-xs text-gray-500">
                      生成されたテーブル/カラムは各テーブルの詳細画面から編集できます。
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter>
                {!schemaResult ? (
                  <>
                    <Button variant="outline" onClick={closeSchemaDialog} className="border-gray-300 text-gray-700">
                      キャンセル
                    </Button>
                    <Button
                      className="bg-violet-600 hover:bg-violet-700"
                      onClick={handleAnalyzeSchema}
                      disabled={!schemaText.trim() || analyzing}
                    >
                      {analyzing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          解析中...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          AIで解析
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button onClick={closeSchemaDialog}>閉じる</Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* CSVインポートボタン */}
          <Dialog open={isImportDialogOpen} onOpenChange={(open) => {
            if (!open) closeImportDialog();
            else setIsImportDialogOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-gray-300">
                <Upload className="h-4 w-4 mr-2" />
                CSVインポート
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-gray-200 max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-gray-900">CSVからインポート</DialogTitle>
                <DialogDescription className="text-gray-500">
                  CSVファイルからテーブルとカラムを一括インポートします
                </DialogDescription>
              </DialogHeader>
              
              {!importResult ? (
                <div className="space-y-4 py-4">
                  {/* テンプレートダウンロード */}
                  <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-blue-600" />
                      <span className="text-sm text-blue-700">CSVテンプレート</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                      <Download className="h-4 w-4 mr-1" />
                      ダウンロード
                    </Button>
                  </div>

                  {/* ファイル選択 */}
                  <div className="space-y-2">
                    <Label className="text-gray-700">CSVファイルを選択</Label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileSelect}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                  </div>

                  {/* CSVプレビュー/編集 */}
                  <div className="space-y-2">
                    <Label className="text-gray-700">CSVデータ（直接編集も可能）</Label>
                    <Textarea
                      value={csvContent}
                      onChange={(e) => setCsvContent(e.target.value)}
                      placeholder={`table_name,column_name,display_name,data_type,description,is_primary_key,is_foreign_key,is_nullable,is_unique,default_value,foreign_key_table,foreign_key_column
users,id,ユーザーID,UUID,ユーザーの識別子,true,false,false,true,,,
users,email,メールアドレス,STRING,メールアドレス,false,false,false,true,,,`}
                      className="bg-white border-gray-300 text-gray-900 font-mono text-xs h-48"
                    />
                  </div>
                </div>
              ) : (
                <div className="py-6">
                  {/* インポート結果 */}
                  <div className={`p-4 rounded-lg ${importResult.success ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      {importResult.success ? (
                        <Check className="h-5 w-5 text-green-600" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                      )}
                      <span className={`font-medium ${importResult.success ? 'text-green-700' : 'text-amber-700'}`}>
                        {importResult.success ? 'インポート完了' : '一部エラーあり'}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-gray-700">
                        作成されたテーブル: <strong>{importResult.tablesCreated}</strong>
                      </p>
                      <p className="text-gray-700">
                        作成されたカラム: <strong>{importResult.columnsCreated}</strong>
                      </p>
                    </div>
                    {importResult.errors.length > 0 && (
                      <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm">
                        <p className="font-medium text-red-700 mb-1">エラー:</p>
                        <ul className="list-disc list-inside text-red-600 text-xs space-y-1">
                          {importResult.errors.slice(0, 5).map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                          {importResult.errors.length > 5 && (
                            <li>...他 {importResult.errors.length - 5} 件のエラー</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter>
                {!importResult ? (
                  <>
                    <Button variant="outline" onClick={closeImportDialog} className="border-gray-300 text-gray-700">
                      キャンセル
                    </Button>
                    <Button
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={handleImportCsv}
                      disabled={!csvContent.trim() || importing}
                    >
                      {importing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          インポート中...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          インポート実行
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button onClick={closeImportDialog}>
                    閉じる
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* テーブル追加ボタン */}
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                テーブル追加
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-white border-gray-200">
            <DialogHeader>
              <DialogTitle className="text-gray-900">新規テーブル作成</DialogTitle>
              <DialogDescription className="text-gray-500">
                データカタログに新しいテーブルを追加します
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-gray-700">テーブル名 (英字)</Label>
                <Input
                  id="name"
                  placeholder="users"
                  value={newTable.name}
                  onChange={(e) => setNewTable({ ...newTable, name: e.target.value })}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName" className="text-gray-700">表示名</Label>
                <Input
                  id="displayName"
                  placeholder="ユーザー"
                  value={newTable.displayName}
                  onChange={(e) => setNewTable({ ...newTable, displayName: e.target.value })}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-gray-700">説明</Label>
                <Input
                  id="description"
                  placeholder="テーブルの説明を入力"
                  value={newTable.description}
                  onChange={(e) => setNewTable({ ...newTable, description: e.target.value })}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} className="border-gray-300 text-gray-700">
                キャンセル
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateTable}>
                作成
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* ── データカタログ本体（DB直結 / スキーマ貼付 / 手動テーブル）── */}
      <div className="space-y-6">
      {/* 取り込みの説明 */}
      <div className="flex items-start gap-2 p-3 bg-violet-50 border border-violet-200 rounded-lg">
        <Sparkles className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
        <p className="text-sm text-violet-800">
          DB直結 or スキーマ貼付でAIが解析し、テーブル/カラム/ステータスを生成。結果は編集可能。
        </p>
      </div>

      {/* DB直結（複数） */}
      <Card className="bg-white border-gray-200">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Server className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-gray-900 text-lg flex items-center gap-2">
                  DB直結（複数）
                  <HelpTooltip text="既存DBに接続文字列で直接つなぎ、解析(introspect)で実テーブル定義をそのまま取り込む方法。実装済みのDBが正解なので最も正確ですが、稼働中DBへの接続情報が必要です。一方「スキーマから取り込み(AI)」はDDL/SQLテキストを貼るだけで、接続不要・設計段階でも使えます。" />
                </CardTitle>
                <p className="text-xs text-gray-500">接続文字列を登録し、解析(introspect)でスキーマを取り込みます（解析は現在 postgres に対応）</p>
              </div>
            </div>
            <Dialog open={isAddDbDialogOpen} onOpenChange={(open) => {
              setIsAddDbDialogOpen(open);
              if (open) setDbDialogError(null);
            }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                  <Plus className="h-4 w-4 mr-2" />
                  DB接続を追加
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white border-gray-200">
                <DialogHeader>
                  <DialogTitle className="text-gray-900">DB接続を追加</DialogTitle>
                  <DialogDescription className="text-gray-500">
                    データベースへの直接接続を登録します。接続文字列は安全に保存されます。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="db-name" className="text-gray-700">接続名</Label>
                    <Input
                      id="db-name"
                      placeholder="本番DB"
                      value={newDbConn.name}
                      onChange={(e) => setNewDbConn({ ...newDbConn, name: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="db-dialect" className="text-gray-700">方言 (dialect)</Label>
                    <Select
                      value={newDbConn.dialect}
                      onValueChange={(value) => setNewDbConn({ ...newDbConn, dialect: value })}
                    >
                      <SelectTrigger id="db-dialect" className="bg-white border-gray-300 text-gray-900">
                        <SelectValue placeholder="方言を選択" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value="postgres">postgres</SelectItem>
                        <SelectItem value="mysql">mysql</SelectItem>
                        <SelectItem value="sqlite">sqlite</SelectItem>
                        <SelectItem value="mssql">mssql</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="db-connstring" className="text-gray-700">接続文字列 (connString)</Label>
                    <Input
                      id="db-connstring"
                      type="password"
                      placeholder="postgresql://user:pass@host:5432/db"
                      value={newDbConn.connString}
                      onChange={(e) => setNewDbConn({ ...newDbConn, connString: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900 font-mono"
                    />
                  </div>
                  {dbDialogError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                      {dbDialogError}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDbDialogOpen(false)} className="border-gray-300 text-gray-700">
                    キャンセル
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleAddDbConnection}
                    disabled={!newDbConn.name.trim() || !newDbConn.connString.trim() || savingDb}
                  >
                    {savingDb ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        追加中...
                      </>
                    ) : (
                      '追加'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {dbLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
            </div>
          ) : dbConnections.length > 0 ? (
            <div className="space-y-3">
              {dbConnections.map((conn) => {
                const result = introspectResults[conn.id];
                const error = introspectErrors[conn.id];
                return (
                  <div
                    key={conn.id}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3 border border-gray-200 rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">{conn.name}</span>
                        {conn.dialect && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                            {conn.dialect}
                          </span>
                        )}
                      </div>
                      {result && (
                        <p className="text-xs text-emerald-700 mt-1">
                          解析完了: テーブル <strong>{result.tables}</strong> / カラム <strong>{result.columns}</strong>
                        </p>
                      )}
                      {error && (
                        <p className="text-xs text-red-600 mt-1">{error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => handleIntrospect(conn.id)}
                        disabled={introspectingId === conn.id}
                      >
                        {introspectingId === conn.id ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            解析中...
                          </>
                        ) : (
                          <>
                            <ScanLine className="h-4 w-4 mr-1" />
                            解析(introspect)
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDeleteDbConnection(conn.id)}
                        disabled={deletingDbId === conn.id}
                      >
                        {deletingDbId === conn.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">
              DB接続がありません。「DB接続を追加」から登録してください。
            </p>
          )}
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          ref={searchInputRef}
          placeholder="テーブルを検索...（/ でフォーカス）"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
        />
      </div>

      {/* Tables Grid */}
      {filteredTables.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTables.map((table) => (
            <Link key={table.id} href={`/dashboard/projects/${projectId}/catalog/${table.id}`}>
              <Card className="bg-white border-gray-200 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                        <TableIcon className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle className="text-gray-900 text-lg">{table.displayName || table.name}</CardTitle>
                        <code className="text-xs text-gray-500">{table.name}</code>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                    {table.description || '説明なし'}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {table.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {table.columnsCount !== undefined && (
                      <span className="text-xs text-gray-500">{table.columnsCount} カラム</span>
                    )}
                  </div>

                  {/* INPUT/OUTPUT 紐付け（クリックは Link への遷移を抑止） */}
                  <div
                    className="mt-4 pt-3 border-t border-gray-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      INPUT/OUTPUT 紐付け
                      <HelpTooltip text="このテーブルが扱うINPUT/OUTPUT（情報種別）を選びます。1つのINPUT/OUTPUTに複数テーブルを紐づけられます。" />
                    </Label>
                    <InformationTypePicker
                      projectId={projectId}
                      informationTypes={informationTypes}
                      value={table.informationTypeId ?? null}
                      onChange={(id) => handleLinkInformationType(table.id, id ?? '__none__')}
                      onCreated={(created) => setInformationTypes((prev) => [...prev, created])}
                      disabled={savingLinkId === table.id}
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Database className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">テーブルが見つかりません</p>
            <p className="text-sm text-gray-400 mb-4">
              {searchQuery ? '検索条件を変更してください' : '最初のテーブルを追加しましょう'}
            </p>
            {!searchQuery && (
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={() => setIsCreateDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                テーブル追加
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}


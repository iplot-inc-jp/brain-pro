'use client';

// Jira（Atlassian）課題エクスポート CSV の取込ダイアログ。
//
// 入力経路は2つ:
//   1) CSV ファイル選択 … 文字コード（自動判定 / UTF-8 / Shift_JIS）を選んでデコード
//      し、UTF-8 文字列にしてから送る。Jira は通常 UTF-8 だが SJIS も選べる。
//   2) テキスト貼付      … すでに UTF-8 文字列なのでそのまま送る。
//
// 送信先は POST /projects/:id/tasks/import-jira { csv }。
// 結果（created / updated / skipped / errors[]）を表示し、成功時は親に取込完了を通知して
// タスク一覧をリフレッシュさせる。sourceKey='JIRA:<Issue key>' で冪等 upsert（再取込で更新）。

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { tasksApi, type ImportJiraResult } from '@/lib/tasks';
import {
  readFileAsText,
  ENCODING_OPTIONS,
  type SupportedEncoding,
} from '@/lib/text-encoding';

export function JiraImportDialog({
  open,
  onOpenChange,
  projectId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** 取込が成功（1件以上 created/updated もしくは API 完了）したときに呼ばれる。一覧リフレッシュ用。 */
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [encoding, setEncoding] = useState<SupportedEncoding>('auto');
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportJiraResult | null>(null);

  const resetState = () => {
    setFileName(null);
    setCsv('');
    setError(null);
    setResult(null);
    setEncoding('auto');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  // ファイル選択 → 指定文字コードでデコードしてテキスト欄へ反映
  const loadFile = async (file: File, enc: SupportedEncoding) => {
    setError(null);
    setResult(null);
    try {
      const text = await readFileAsText(file, enc);
      setCsv(text);
      setFileName(file.name);
    } catch (err) {
      console.error('Failed to read CSV file:', err);
      setError(
        'ファイルの読み込みに失敗しました。文字コードを変えて再度お試しください。',
      );
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadFile(file, encoding);
  };

  // 文字コードを変更したら、選択中ファイルがあれば読み直す（貼付テキストはそのまま）
  const handleEncodingChange = async (enc: SupportedEncoding) => {
    setEncoding(enc);
    const file = fileInputRef.current?.files?.[0];
    if (file) await loadFile(file, enc);
  };

  const handleImport = async () => {
    const payload = csv.trim();
    if (!payload) {
      setError('CSV が空です。ファイルを選択するかテキストを貼り付けてください。');
      return;
    }
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const res = await tasksApi.importJira(projectId, payload);
      setResult(res);
      // 1件でも作成/更新されたら一覧をリフレッシュ（エラーがあっても部分成功を反映）
      if (res.created > 0 || res.updated > 0) onImported();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '取り込みに失敗しました',
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-white border-gray-200 max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            Jira から取込
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            Jira（Atlassian）の課題エクスポート CSV を取り込みます。CSV
            ファイルを選択するか、テキストを貼り付けてください。同じ Issue key
            は再取込しても重複せず更新されます。
          </DialogDescription>
        </DialogHeader>

        {/* 対応フォーマット（CSVの列）の案内 */}
        <details className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-700">
            対応フォーマット（CSVの列）
          </summary>
          <div className="mt-2 space-y-1.5">
            <p>
              Jira の Issue 一覧 → Export → CSV（推奨: CSV(all fields)）の出力を使えます。
              ヘッダ行を見て次の列を自動対応します（日本語/英語の別名可）:
            </p>
            <ul className="ml-4 list-disc space-y-0.5 text-xs">
              <li><b>Summary</b>（件名 / タイトル）… <b>必須</b></li>
              <li>Description（詳細 / 説明）</li>
              <li>Status（状態 / ステータス）／ Priority（優先度）</li>
              <li>Issue Type（種別 / 課題種別）</li>
              <li>Assignee（担当者）</li>
              <li>Start date（開始日）／ Due date（期限 / 締切）… 日付列</li>
              <li>Issue key（キー）… 例 ABC-34 ／ <b>Parent</b>（親）… 親子関係(parentId)に解決</li>
              <li>Epic Link（Epic）… epic への紐付けに解決</li>
            </ul>
            <p className="text-xs text-gray-400">
              ※ Issue key は <code>JIRA:&lt;key&gt;</code> として保持し、再取込で冪等に更新します。未知の状態/優先度は既定値になります。
            </p>
          </div>
        </details>

        <div className="space-y-4 py-2">
          {/* 文字コード選択 */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label className="text-gray-700">文字コード</Label>
              <HelpTooltip text="CSV ファイルの文字コード。Jira の出力は通常 UTF-8 です。文字化けする場合は切り替えてください（「自動判定」は UTF-8 として読めなければ Shift_JIS とみなします）。貼り付けたテキストには影響しません。" />
            </div>
            <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
              {ENCODING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => void handleEncodingChange(opt.value)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                    encoding === opt.value
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  aria-pressed={encoding === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ファイル選択 */}
          <div className="space-y-1.5">
            <Label className="text-gray-700">CSV ファイル</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5 border-gray-300 text-gray-700"
              >
                <Upload className="h-4 w-4" />
                ファイルを選択
              </Button>
              {fileName && (
                <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                  <FileSpreadsheet className="h-4 w-4 text-gray-400" />
                  {fileName}
                </span>
              )}
            </div>
          </div>

          {/* テキスト貼付 */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label className="text-gray-700">CSV テキスト</Label>
              <HelpTooltip text="ファイルを選択するとここに内容が読み込まれます。直接貼り付けても取り込めます（1行目はヘッダ行＝「Summary」列が必須）。" />
            </div>
            <Textarea
              placeholder={
                'Summary,Issue key,Status,Priority,Assignee,Due date,Original Estimate,Parent\n在庫マスタの設計,PROJ-12,To Do,High,山田,2026/07/01,3600,'
              }
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                // 手入力に切り替わったらファイル名表示はそのままにしつつ結果はクリア
                setResult(null);
              }}
              className="bg-white border-gray-300 min-h-[140px] font-mono text-xs"
            />
          </div>

          {/* エラー */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {/* 取込結果 */}
          {result && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  作成: <strong className="tabular-nums">{result.created}</strong> 件
                </span>
                <span className="inline-flex items-center gap-1.5 text-blue-700">
                  <CheckCircle2 className="h-4 w-4" />
                  更新: <strong className="tabular-nums">{result.updated}</strong> 件
                </span>
                <span className="inline-flex items-center gap-1.5 text-gray-500">
                  <X className="h-4 w-4" />
                  スキップ:{' '}
                  <strong className="tabular-nums">{result.skipped}</strong> 件
                </span>
                <span className="inline-flex items-center gap-1.5 text-amber-700">
                  <AlertCircle className="h-4 w-4" />
                  エラー:{' '}
                  <strong className="tabular-nums">
                    {result.errors.length}
                  </strong>{' '}
                  件
                </span>
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded border border-amber-200 bg-white">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-amber-50/60 text-left text-amber-800">
                        <th className="px-2 py-1 w-16">行</th>
                        <th className="px-2 py-1">内容</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr
                          key={`${e.row}-${i}`}
                          className="border-b border-gray-50 last:border-0"
                        >
                          <td className="px-2 py-1 tabular-nums text-gray-500">
                            {e.row === 0 ? 'ヘッダ' : e.row}
                          </td>
                          <td className="px-2 py-1 text-gray-700">
                            {e.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(result.created > 0 || result.updated > 0) && (
                <p className="text-xs text-gray-500">
                  取り込んだタスクは一覧に反映されました。
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {result ? '閉じる' : 'キャンセル'}
          </Button>
          <Button
            onClick={handleImport}
            disabled={!csv.trim() || importing}
            className="bg-blue-600 hover:bg-blue-700 gap-1.5"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                取込中...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                取り込む
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

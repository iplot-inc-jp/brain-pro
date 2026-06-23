'use client';

// Excel(.xlsx) を生成AIで読み取り、大項目/中項目などの階層を推測してタスクを自動生成するダイアログ。
// 送信先: POST /api/projects/:id/tasks/import-excel-ai （multipart: file, instructions?）
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, FileSpreadsheet, Check, AlertCircle } from 'lucide-react';
import { tasksApi, type ImportExcelAiResult } from '@/lib/tasks';

export function ExcelAiImportDialog({
  open,
  onOpenChange,
  projectId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportExcelAiResult | null>(null);

  const reset = () => {
    setFile(null);
    setInstructions('');
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleImport = async () => {
    if (!file) {
      setError('Excel（.xlsx）ファイルを選択してください');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await tasksApi.importExcelAi(projectId, file, instructions);
      setResult(res);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            Excelから取込（AI）
          </DialogTitle>
          <DialogDescription>
            Excel(.xlsx)をアップロードすると、生成AIが列（大項目・中項目・日付・担当など）を読み取り、
            階層付きのタスクを自動生成します。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <Check className="h-4 w-4" />
              {result.created}件のタスクを生成しました（うち大項目 {result.rootCount}件）。
            </div>
            {result.preview.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
                <ul className="divide-y divide-gray-100 text-sm">
                  {result.preview.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="truncate">{p.title}</span>
                      {p.childCount > 0 && (
                        <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                          子 {p.childCount}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-gray-400">
              内容が想定と違う場合は、タスク一覧から個別に編集・削除できます。
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Excelファイル（.xlsx）</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
                className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-gray-50 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-100"
              />
              {file && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {file.name}（{Math.round(file.size / 1024)}KB）
                </p>
              )}
              <p className="text-xs text-gray-400">4MBまで。1枚目以降のシートも読み取ります。</p>
            </div>
            <div className="space-y-2">
              <Label>読み取りのヒント（任意）</Label>
              <Textarea
                placeholder="例: A列が大項目、B列が中項目、C列が担当、D列が期限です。完了列が「済」なら RESOLVED にしてください。"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="min-h-[72px] bg-white"
              />
            </div>
            {error && (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)} className="bg-blue-600 hover:bg-blue-700">
              閉じる
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={loading}>
                キャンセル
              </Button>
              <Button
                onClick={handleImport}
                disabled={loading || !file}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    AIで生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    AIでタスク生成
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

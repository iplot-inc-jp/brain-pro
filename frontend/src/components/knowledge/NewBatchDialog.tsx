'use client'

// 新規取り込みバッチ ダイアログ。
//   ① ソース選択（アップロード（ZIP可・複数） / 既存添付から選択）
//   ② ファイル一覧プレビュー
//   ③ 抽出オプション（プロジェクト設定を初期値に AI抽出/OCR ON/OFF・モデルをバッチ上書き）
//   ④ 開始（POST ingestion-batches）
//
// Drive ソースは Phase 3。本ダイアログは UPLOAD / ATTACHMENT のみ扱う。

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import {
  Loader2,
  X,
  FileArchive,
  FileText,
  Paperclip,
  Upload as UploadIcon,
} from 'lucide-react'
import {
  ingestionApi,
  listSelectableAttachments,
  formatBytes,
  isArchiveFile,
  type IngestionBatchSource,
  type IngestionBatchOptions,
  type IngestionUploadResult,
  type SelectableAttachment,
  type ProjectKnowledgeSettings,
} from '@/lib/knowledge'

/** アップロード済みで取り込み対象に確定したファイル。 */
type StagedUpload = IngestionUploadResult

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  /** 初期オプション（プロジェクト設定）。未取得なら全 ON 既定で扱う。 */
  settings: ProjectKnowledgeSettings | null
  /** 作成成功時（バッチ id を親に渡す）。 */
  onCreated: (batchId: string) => void
}

const ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv,.docx,.doc,.pptx,.txt,.md,.json,.zip'

export function NewBatchDialog({
  open,
  onClose,
  projectId,
  settings,
  onCreated,
}: Props) {
  const [name, setName] = useState('')
  const [uploads, setUploads] = useState<StagedUpload[]>([])
  const [attachments, setAttachments] = useState<SelectableAttachment[]>([])
  const [selectedAttIds, setSelectedAttIds] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [loadingAtt, setLoadingAtt] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // オプション（プロジェクト設定を初期値に、バッチ単位で上書き）
  const [aiExtractionEnabled, setAiExtractionEnabled] = useState(true)
  const [ocrEnabled, setOcrEnabled] = useState(true)
  const [model, setModel] = useState<string>('')

  // ダイアログを開くたびに初期化（設定を反映）
  useEffect(() => {
    if (!open) return
    setName('')
    setUploads([])
    setSelectedAttIds(new Set())
    setError(null)
    setAiExtractionEnabled(settings?.aiExtractionEnabled ?? true)
    setOcrEnabled(settings?.ocrEnabled ?? true)
    setModel(settings?.defaultModel ?? '')
  }, [open, settings])

  const loadAttachments = useCallback(async () => {
    setLoadingAtt(true)
    try {
      const list = await listSelectableAttachments(projectId)
      setAttachments(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '既存添付の取得に失敗しました')
    } finally {
      setLoadingAtt(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) loadAttachments()
  }, [open, loadAttachments])

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setUploading(true)
      setError(null)
      try {
        const results = await ingestionApi.upload(projectId, files)
        setUploads((prev) => [...prev, ...results])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'アップロードに失敗しました')
      } finally {
        setUploading(false)
      }
    },
    [projectId],
  )

  const removeUpload = (idx: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== idx))
  }

  const toggleAttachment = (id: string) => {
    setSelectedAttIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalSelected = uploads.length + selectedAttIds.size

  const handleSubmit = async () => {
    if (totalSelected === 0) {
      setError('取り込むファイルを 1 件以上選択してください')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      // contract: files[] に UPLOAD / ATTACHMENT を変換して送る。
      const files: IngestionBatchSource[] = []
      for (const u of uploads) {
        files.push({
          sourceType: 'UPLOAD',
          filename: u.filename,
          blobUrl: u.blobUrl,
          mimeType: u.mimeType,
          size: u.size,
          ...(u.isArchive != null ? { isArchive: u.isArchive } : {}),
        })
      }
      for (const att of attachments) {
        if (!selectedAttIds.has(att.id)) continue
        files.push({
          sourceType: 'ATTACHMENT',
          sourceRef: att.id,
          filename: att.displayName || att.filename,
          ...(att.mimeType ? { mimeType: att.mimeType } : {}),
          ...(att.size != null ? { size: att.size } : {}),
        })
      }
      const options: IngestionBatchOptions = {
        aiExtractionEnabled,
        ocrEnabled,
        ...(model ? { model } : {}),
      }
      // name 未入力時は既定名を補完（400 回避・空文字を送らない）。
      const batchName = name.trim() || `取り込み ${files.length}件`
      const batch = await ingestionApi.createBatch(projectId, {
        name: batchName,
        options,
        files,
      })
      onCreated(batch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'バッチの作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新規取り込みバッチ</DialogTitle>
          <DialogDescription>
            アップロード（ZIP・複数可）または既存添付から素材を選び、AI でナレッジグラフへ取り込みます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* バッチ名 */}
          <div className="space-y-1.5">
            <Label htmlFor="batch-name">バッチ名（任意）</Label>
            <Input
              id="batch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 2026Q2 業務資料"
            />
          </div>

          {/* ソース選択 */}
          <Tabs defaultValue="upload">
            <TabsList>
              <TabsTrigger value="upload">
                <UploadIcon className="h-3.5 w-3.5 mr-1.5" />
                アップロード
              </TabsTrigger>
              <TabsTrigger value="attachment">
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                既存添付から選択
              </TabsTrigger>
            </TabsList>

            {/* アップロード（ZIP 可・複数） */}
            <TabsContent value="upload" className="space-y-3 pt-2">
              <FileDropZone
                onFiles={handleFiles}
                accept={ACCEPT}
                multiple
                busy={uploading}
                className="h-28"
              >
                <div className="text-center text-sm text-muted-foreground">
                  ファイルをドロップ、またはクリックして選択
                  <div className="text-xs mt-1 opacity-70">
                    PDF / 画像 / Excel / Word / テキスト / ZIP（複数可）
                  </div>
                </div>
              </FileDropZone>

              {uploads.length > 0 && (
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {uploads.map((u, i) => (
                    <li
                      key={`${u.blobUrl}-${i}`}
                      className="flex items-center gap-2 text-sm rounded-md border border-border px-2 py-1.5"
                    >
                      {u.isArchive || isArchiveFile(u.filename, u.mimeType) ? (
                        <FileArchive className="h-4 w-4 flex-shrink-0 text-amber-500" />
                      ) : (
                        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate flex-1">{u.filename}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(u.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeUpload(i)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="削除"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            {/* 既存添付から選択 */}
            <TabsContent value="attachment" className="space-y-2 pt-2">
              {loadingAtt ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  読み込み中…
                </div>
              ) : attachments.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  選択できる添付ファイルがありません。
                </div>
              ) : (
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {attachments.map((att) => {
                    const checked = selectedAttIds.has(att.id)
                    return (
                      <li key={att.id}>
                        <label className="flex items-center gap-2 text-sm rounded-md border border-border px-2 py-1.5 cursor-pointer hover:bg-secondary">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAttachment(att.id)}
                            className="h-4 w-4"
                          />
                          {isArchiveFile(att.filename, att.mimeType ?? undefined) ? (
                            <FileArchive className="h-4 w-4 flex-shrink-0 text-amber-500" />
                          ) : (
                            <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate flex-1">
                            {att.displayName || att.filename}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(att.size)}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </TabsContent>
          </Tabs>

          {/* 抽出オプション（料金ガード。プロジェクト設定を初期値にバッチ上書き） */}
          <div className="rounded-md border border-border p-3 space-y-2.5">
            <div className="text-xs font-semibold text-muted-foreground">
              抽出オプション（このバッチのみ上書き）
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={aiExtractionEnabled}
                onChange={(e) => setAiExtractionEnabled(e.target.checked)}
                className="h-4 w-4 mt-0.5"
              />
              <span>
                AI 抽出（要約・タグ・実体・関係）
                <span className="block text-xs text-muted-foreground">
                  Claude を呼びます（料金が発生）。OFF なら原本テキストのみ保持。
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={ocrEnabled}
                onChange={(e) => setOcrEnabled(e.target.checked)}
                className="h-4 w-4 mt-0.5"
              />
              <span>
                OCR / 画像解析
                <span className="block text-xs text-muted-foreground">
                  画像・スキャン PDF を vision/document で読みます（画像トークン分の料金）。
                </span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="batch-model" className="text-xs">
                モデル（任意・空欄でサーバ既定）
              </Label>
              <Select
                value={model || '__default__'}
                onValueChange={(v) => setModel(v === '__default__' ? '' : v)}
              >
                <SelectTrigger id="batch-model" className="h-9">
                  <SelectValue placeholder="サーバ既定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">サーバ既定</SelectItem>
                  <SelectItem value="claude-sonnet-4-6">
                    claude-sonnet-4-6（標準）
                  </SelectItem>
                  <SelectItem value="claude-opus-4-6">
                    claude-opus-4-6（高品質・高単価）
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="mr-auto text-sm text-muted-foreground self-center">
            選択中: {totalSelected} 件
          </div>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || uploading || totalSelected === 0}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            取り込みを開始
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

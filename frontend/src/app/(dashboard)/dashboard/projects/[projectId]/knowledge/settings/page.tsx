'use client'

// ナレッジ設定（課金ガード）。
//   aiExtractionEnabled / ocrEnabled / defaultModel / imagingMode / maxFilesPerBatch。
//   料金が発生する旨の注記つき。ProjectKnowledgeSettings を編集（get-or-create 既定）。

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useReadOnly } from '@/components/read-only-context'
import { Brain, Loader2, AlertTriangle, Save } from 'lucide-react'
import {
  knowledgeSettingsApi,
  type ProjectKnowledgeSettings,
  type UpdateSettingsInput,
} from '@/lib/knowledge'

export default function KnowledgeSettingsPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { canEdit } = useReadOnly()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [aiExtractionEnabled, setAiExtractionEnabled] = useState(true)
  const [ocrEnabled, setOcrEnabled] = useState(true)
  const [defaultModel, setDefaultModel] = useState<string>('')
  const [imagingMode, setImagingMode] = useState<string>('auto')
  const [maxFilesPerBatch, setMaxFilesPerBatch] = useState<number>(200)

  const apply = useCallback((s: ProjectKnowledgeSettings) => {
    setAiExtractionEnabled(s.aiExtractionEnabled)
    setOcrEnabled(s.ocrEnabled)
    setDefaultModel(s.defaultModel ?? '')
    setImagingMode(s.imagingMode || 'auto')
    setMaxFilesPerBatch(s.maxFilesPerBatch)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const s = await knowledgeSettingsApi.get(projectId)
        if (!cancelled) apply(s)
      } catch (e) {
        if (!cancelled) {
          setMessage({
            type: 'error',
            text: e instanceof Error ? e.message : '設定の取得に失敗しました',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, apply])

  const handleSave = async () => {
    if (!canEdit) return
    setSaving(true)
    setMessage(null)
    try {
      const input: UpdateSettingsInput = {
        aiExtractionEnabled,
        ocrEnabled,
        defaultModel: defaultModel || null,
        imagingMode,
        maxFilesPerBatch,
      }
      const s = await knowledgeSettingsApi.update(projectId, input)
      apply(s)
      setMessage({ type: 'success', text: '設定を保存しました' })
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : '保存に失敗しました',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            ナレッジ設定
          </span>
        }
        description="AI 抽出・OCR の課金ガードや、既定モデル・1 バッチ上限を設定します。"
        help="OFF にした処理はジョブで無音にスキップせず、各ファイルに理由を残します。バッチ作成時にこの設定をバッチ単位で上書きできます。"
      />

      {/* 料金注記 */}
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div>
          AI 抽出・OCR/画像解析は Claude API の利用料金が発生します。料金を抑えたい場合は OFF
          にして「素材だけ溜める」運用も可能です（後から AI 再処理できます）。
        </div>
      </div>

      {message && (
        <div
          className={
            message.type === 'success'
              ? 'text-sm text-emerald-700 bg-emerald-50 rounded-md px-3 py-2'
              : 'text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2'
          }
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          読み込み中…
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">課金ガード・抽出設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* AI 抽出 */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={aiExtractionEnabled}
                onChange={(e) => setAiExtractionEnabled(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">AI 抽出を有効にする</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Claude による 要約・タグ・実体・関係 の抽出（$）。OFF なら原本テキストのみ保持。
                </span>
              </span>
            </label>

            {/* OCR */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ocrEnabled}
                onChange={(e) => setOcrEnabled(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">OCR / 画像解析を有効にする</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  画像・スキャン PDF を vision/document で読みます（$$、画像トークン）。
                  テキスト層のある PDF/Office/テキストには影響しません。
                </span>
              </span>
            </label>

            {/* 既定モデル */}
            <div className="space-y-1.5">
              <Label htmlFor="default-model">既定モデル</Label>
              <Select
                value={defaultModel || '__default__'}
                onValueChange={(v) =>
                  setDefaultModel(v === '__default__' ? '' : v)
                }
                disabled={!canEdit}
              >
                <SelectTrigger id="default-model" className="max-w-md">
                  <SelectValue placeholder="サーバ既定（EXTRACTION_MODEL）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    サーバ既定（EXTRACTION_MODEL）
                  </SelectItem>
                  <SelectItem value="claude-sonnet-4-6">
                    claude-sonnet-4-6（標準）
                  </SelectItem>
                  <SelectItem value="claude-opus-4-6">
                    claude-opus-4-6（高品質・高単価）
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                未設定ならサーバ側の既定モデルを使います。
              </p>
            </div>

            {/* imagingMode */}
            <div className="space-y-1.5">
              <Label htmlFor="imaging-mode">Office の画像化方針</Label>
              <Select
                value={imagingMode}
                onValueChange={setImagingMode}
                disabled={!canEdit}
              >
                <SelectTrigger id="imaging-mode" className="max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto（自動判定・推奨）</SelectItem>
                  <SelectItem value="always">always（常に画像化）</SelectItem>
                  <SelectItem value="never">never（テキスト抽出のみ）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Excel/Word などをテキストとして扱うか画像化するかの方針です（画像化は外部変換キー設定時のみ有効）。
              </p>
            </div>

            {/* maxFilesPerBatch */}
            <div className="space-y-1.5">
              <Label htmlFor="max-files">1 バッチの最大ファイル数</Label>
              <Input
                id="max-files"
                type="number"
                min={1}
                max={1000}
                value={maxFilesPerBatch}
                onChange={(e) =>
                  setMaxFilesPerBatch(
                    Math.max(1, Number(e.target.value) || 1),
                  )
                }
                disabled={!canEdit}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                ZIP 展開を含む取り込み上限。超過分は警告ログに残ります。
              </p>
            </div>

            {canEdit && (
              <div className="pt-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  設定を保存
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

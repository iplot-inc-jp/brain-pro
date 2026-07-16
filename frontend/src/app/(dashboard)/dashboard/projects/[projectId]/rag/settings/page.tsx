'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  History,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useReadOnly } from '@/components/read-only-context'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  getRagSettings,
  resetRagSettings,
  updateRagSettings,
  type RagPromptVersion,
  type RagSettingsResponse,
} from '@/lib/rag-settings'
import {
  ragSettingsDirty,
  validateRagSettingsDraft,
  type RagSettingsDraft,
} from '@/components/rag/rag-settings-state'

const modelNames: Record<string, string> = {
  'claude-haiku-4-5': 'Haiku 4.5 — 高速・低コスト',
  'claude-sonnet-4-6': 'Sonnet 4.6 — 標準・バランス',
  'claude-opus-4-8': 'Opus 4.8 — 高品質',
  'claude-fable-5': 'Fable 5 — 最高性能',
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function editorFrom(version: RagPromptVersion): RagSettingsDraft {
  return { model: version.model, systemPrompt: version.systemPrompt }
}

export default function RagSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { canEdit } = useReadOnly()
  const [settings, setSettings] = useState<RagSettingsResponse | null>(null)
  const [draft, setDraft] = useState<RagSettingsDraft>({ model: '', systemPrompt: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getRagSettings(projectId)
      setSettings(result)
      setDraft(editorFrom(result.active))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'RAG設定を取得できませんでした')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const errors = useMemo(
    () => validateRagSettingsDraft(draft, settings?.allowedModels ?? []),
    [draft, settings],
  )
  const dirty = settings ? ragSettingsDirty(editorFrom(settings.active), draft) : false
  const canSave = canEdit && dirty && !saving && Object.keys(errors).length === 0

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const version = await updateRagSettings(projectId, draft)
      setNotice(`プロンプト v${version.version} を有効化しました`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'RAG設定を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!canEdit || saving) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const version = await resetRagSettings(projectId)
      setNotice(`既定値をプロンプト v${version.version} として有効化しました`)
      setConfirmReset(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '既定値へ戻せませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-full bg-slate-50/70 px-5 py-6 lg:px-9">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title={(
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-cyan-700" />
              RAG設定
            </span>
          )}
          description="索引生成で使用するClaudeモデルとシステムプロンプトを版管理します。"
          help="保存するたびに新しい版を作ります。過去の索引・使用量から、そのとき使用した版を追跡できます。"
        />

        {error ? (
          <div className="flex items-start gap-2 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        ) : null}
        {notice ? (
          <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />{notice}
          </div>
        ) : null}

        {loading && !settings ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-700" />
          </div>
        ) : settings ? (
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="overflow-hidden border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-slate-50">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Active configuration</div>
                  <div className="mt-1 flex items-center gap-2">
                    <DatabaseZap className="h-4 w-4" />
                    <span className="font-semibold">プロンプト v{settings.active.version}</span>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div>{formatDate(settings.active.createdAt)}</div>
                  <div className="mt-0.5">{settings.active.createdBy?.name || settings.active.createdBy?.email || settings.active.createdById || 'システム'}</div>
                </div>
              </div>

              <div className="space-y-6 p-5 lg:p-6">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700" htmlFor="rag-model">Claudeモデル</label>
                  <Select
                    value={draft.model}
                    onValueChange={(model) => {
                      setDraft((current) => ({ ...current, model }))
                      setNotice(null)
                    }}
                    disabled={!canEdit || saving}
                  >
                    <SelectTrigger id="rag-model" className="h-11 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.allowedModels.map((model) => (
                        <SelectItem key={model} value={model}>{modelNames[model] ?? model}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.model ? <p className="text-xs text-red-600">{errors.model}</p> : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <label className="text-xs font-semibold text-slate-700" htmlFor="rag-system-prompt">システムプロンプト</label>
                    <span className={`font-mono text-[10px] ${draft.systemPrompt.length > 20_000 ? 'text-red-600' : 'text-slate-400'}`}>
                      {draft.systemPrompt.length.toLocaleString()} / 20,000
                    </span>
                  </div>
                  <Textarea
                    id="rag-system-prompt"
                    value={draft.systemPrompt}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, systemPrompt: event.target.value }))
                      setNotice(null)
                    }}
                    disabled={!canEdit || saving}
                    spellCheck={false}
                    className="min-h-[28rem] resize-y border-slate-300 bg-slate-50/40 font-mono text-xs leading-6"
                  />
                  {errors.systemPrompt ? <p className="text-xs text-red-600">{errors.systemPrompt}</p> : null}
                </div>

                {!canEdit ? (
                  <div className="flex items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                    <ShieldCheck className="h-4 w-4" />閲覧権限では設定を変更できません
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-slate-500"
                    disabled={!canEdit || saving}
                    onClick={() => setConfirmReset(true)}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />既定値へ戻す
                  </Button>
                  <div className="flex items-center gap-3">
                    {dirty ? <span className="text-xs text-amber-700">未保存の変更があります</span> : null}
                    <Button type="button" disabled={!canSave} onClick={() => void save()}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      新しい版として保存
                    </Button>
                  </div>
                </div>

                {confirmReset ? (
                  <div className="flex flex-col gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                    <span>現在の設定は履歴に残し、既定値を新しい版として有効化します。</span>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>キャンセル</Button>
                      <Button size="sm" variant="outline" onClick={() => void reset()} disabled={saving}>既定値を有効化</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="lg:sticky lg:top-5 lg:self-start">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <History className="h-4 w-4 text-slate-500" />変更履歴
                </h2>
                <span className="font-mono text-[10px] text-slate-400">{settings.history.length} VERSIONS</span>
              </div>
              <ol className="border-l border-slate-300 pl-4">
                {settings.history.map((version) => (
                  <li key={version.id} className="relative pb-5 last:pb-0">
                    <span className={`absolute -left-[1.22rem] top-1 h-2 w-2 rounded-full ring-4 ring-slate-50 ${version.isActive ? 'bg-cyan-600' : 'bg-slate-300'}`} />
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-slate-800">v{version.version}</strong>
                      {version.isActive ? <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-700">Active</span> : null}
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] leading-4 text-slate-500">{version.model}</div>
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                      <Clock3 className="h-3 w-3" />{formatDate(version.createdAt)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {version.createdBy?.name || version.createdBy?.email || version.createdById || 'システム'}
                    </div>
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="cursor-pointer select-none hover:text-slate-800">プロンプトを確認</summary>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-slate-200 bg-white p-2 font-mono text-[10px] leading-4">{version.systemPrompt}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  )
}

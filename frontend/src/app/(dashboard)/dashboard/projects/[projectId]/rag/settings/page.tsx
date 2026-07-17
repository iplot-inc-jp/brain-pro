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
  getPromptList,
  getPromptSettings,
  resetPromptSettings,
  updatePromptSettings,
  type PromptListResponse,
  type PromptSettingsResponse,
  type PromptVersion,
} from '@/lib/prompt-settings'
import {
  promptSettingsDirty,
  validatePromptSettingsDraft,
  type PromptSettingsDraft,
} from '@/components/prompts/prompt-settings-state'

const modelNames: Record<string, string> = {
  'claude-haiku-4-5': 'Haiku 4.5 — 高速・低コスト',
  'claude-sonnet-4-6': 'Sonnet 4.6 — 標準・バランス',
  'claude-opus-4-8': 'Opus 4.8 — 高品質',
  'claude-fable-5': 'Fable 5 — 最高性能',
}

function modelShortName(model: string): string {
  return modelNames[model]?.split(' — ')[0] ?? model
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function editorFrom(version: PromptVersion): PromptSettingsDraft {
  return { model: version.model, systemPrompt: version.systemPrompt }
}

export default function PromptSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { canEdit } = useReadOnly()
  const [listing, setListing] = useState<PromptListResponse | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [settings, setSettings] = useState<PromptSettingsResponse | null>(null)
  const [draft, setDraft] = useState<PromptSettingsDraft>({ model: '', systemPrompt: '' })
  const [loadingList, setLoadingList] = useState(true)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const result = await getPromptList(projectId)
      setListing(result)
      setSelectedKey((current) => current ?? result.prompts[0]?.key ?? null)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'プロンプト一覧を取得できませんでした')
    } finally {
      setLoadingList(false)
    }
  }, [projectId])

  const loadSettings = useCallback(async (key: string) => {
    setLoadingSettings(true)
    try {
      const result = await getPromptSettings(projectId, key)
      setSettings(result)
      setDraft(editorFrom(result.active))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'プロンプト設定を取得できませんでした')
    } finally {
      setLoadingSettings(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (selectedKey) void loadSettings(selectedKey)
  }, [selectedKey, loadSettings])

  const activeDraft = settings ? editorFrom(settings.active) : null
  const dirty = activeDraft ? promptSettingsDirty(activeDraft, draft) : false
  const errors = useMemo(
    () =>
      settings
        ? validatePromptSettingsDraft(
            draft,
            settings.allowedModels,
            settings.maxLength,
            settings.active.model,
          )
        : {},
    [draft, settings],
  )
  const canSave = canEdit && dirty && !saving && Object.keys(errors).length === 0
  const maxLength = settings?.maxLength ?? 20_000

  const categories = useMemo(() => {
    if (!listing) return []
    const groups: Array<{ name: string; items: PromptListResponse['prompts'] }> = []
    for (const prompt of listing.prompts) {
      const group = groups.find((entry) => entry.name === prompt.category)
      if (group) group.items.push(prompt)
      else groups.push({ name: prompt.category, items: [prompt] })
    }
    return groups
  }, [listing])

  const selectPrompt = (key: string) => {
    if (key === selectedKey) return
    if (dirty && !window.confirm('未保存の変更があります。破棄して切り替えますか？')) return
    setNotice(null)
    setConfirmReset(false)
    setSelectedKey(key)
  }

  const save = async () => {
    if (!canSave || !selectedKey) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const version = await updatePromptSettings(projectId, selectedKey, draft)
      setNotice(`プロンプト v${version.version} を有効化しました`)
      await Promise.all([loadSettings(selectedKey), loadList()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'プロンプト設定を保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!canEdit || saving || !selectedKey) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const version = await resetPromptSettings(projectId, selectedKey)
      setNotice(`既定値をプロンプト v${version.version} として有効化しました`)
      setConfirmReset(false)
      await Promise.all([loadSettings(selectedKey), loadList()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '既定値へ戻せませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-full bg-slate-50/70 px-5 py-6 lg:px-9">
      <div className="mx-auto max-w-[90rem] space-y-6">
        <PageHeader
          title={(
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-cyan-700" />
              プロンプト設定
            </span>
          )}
          description="システム全体のAI機能で使うシステムプロンプトとClaudeモデルを、プロンプトごとに版管理します。"
          help="保存するたびに新しい版を作ります。過去のAI実行・使用量から、そのとき使用した版を追跡できます。"
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

        {loadingList && !listing ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-cyan-700" />
          </div>
        ) : listing ? (
          <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <nav className="lg:sticky lg:top-5 lg:self-start">
              <div className="border border-slate-200 bg-white">
                {categories.map((category) => (
                  <div key={category.name}>
                    <div className="border-b border-slate-200 bg-slate-100/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {category.name}
                    </div>
                    <ul>
                      {category.items.map((prompt) => {
                        const selected = prompt.key === selectedKey
                        return (
                          <li key={prompt.key} className="border-b border-slate-100 last:border-b-0">
                            <button
                              type="button"
                              onClick={() => selectPrompt(prompt.key)}
                              className={`block w-full px-4 py-3 text-left transition-colors ${
                                selected ? 'bg-slate-950 text-slate-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className={`text-sm font-medium ${selected ? 'text-slate-50' : 'text-slate-800'}`}>
                                  {prompt.label}
                                </span>
                                {prompt.customized ? (
                                  <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider ${selected ? 'text-cyan-300' : 'text-cyan-700'}`}>
                                    カスタム
                                  </span>
                                ) : null}
                              </span>
                              <span className={`mt-1 block font-mono text-[10px] ${selected ? 'text-slate-400' : 'text-slate-500'}`}>
                                {modelShortName(prompt.model)}
                                {prompt.version ? ` ・ v${prompt.version}` : ''}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </nav>

            {loadingSettings && !settings ? (
              <div className="flex min-h-72 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-cyan-700" />
              </div>
            ) : settings ? (
              <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_19rem]">
                <section className="overflow-hidden border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-950 px-5 py-4 text-slate-50">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Active configuration</div>
                      <div className="mt-1 flex items-center gap-2">
                        <DatabaseZap className="h-4 w-4" />
                        <span className="font-semibold">{settings.definition.label} — プロンプト v{settings.active.version}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{formatDate(settings.active.createdAt)}</div>
                      <div className="mt-0.5">{settings.active.createdBy?.name || settings.active.createdBy?.email || settings.active.createdById || 'システム'}</div>
                    </div>
                  </div>

                  <div className="space-y-6 p-5 lg:p-6">
                    <p className="text-xs leading-5 text-slate-500">{settings.definition.description}</p>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-700" htmlFor="prompt-model">Claudeモデル</label>
                      <Select
                        value={draft.model}
                        onValueChange={(model) => {
                          setDraft((current) => ({ ...current, model }))
                          setNotice(null)
                        }}
                        disabled={!canEdit || saving}
                      >
                        <SelectTrigger id="prompt-model" className="h-11 bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(settings.allowedModels.includes(settings.active.model)
                            ? settings.allowedModels
                            : [settings.active.model, ...settings.allowedModels]
                          ).map((model) => (
                            <SelectItem key={model} value={model}>{modelNames[model] ?? model}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.model ? <p className="text-xs text-red-600">{errors.model}</p> : null}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-end justify-between gap-3">
                        <label className="text-xs font-semibold text-slate-700" htmlFor="prompt-system-prompt">システムプロンプト</label>
                        <span className={`font-mono text-[10px] ${draft.systemPrompt.length > maxLength ? 'text-red-600' : 'text-slate-400'}`}>
                          {draft.systemPrompt.length.toLocaleString()} / {maxLength.toLocaleString()}
                        </span>
                      </div>
                      <Textarea
                        id="prompt-system-prompt"
                        value={draft.systemPrompt}
                        onChange={(event) => {
                          setDraft((current) => ({ ...current, systemPrompt: event.target.value }))
                          setNotice(null)
                        }}
                        disabled={!canEdit || saving}
                        spellCheck={false}
                        className="min-h-[26rem] resize-y border-slate-300 bg-slate-50/40 font-mono text-xs leading-6"
                      />
                      {errors.systemPrompt ? <p className="text-xs text-red-600">{errors.systemPrompt}</p> : null}
                      {settings.definition.variables.length > 0 ? (
                        <div className="space-y-1 border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">利用できる変数（実行時に置換されます）</div>
                          <ul className="space-y-0.5">
                            {settings.definition.variables.map((variable) => (
                              <li key={variable.name} className="text-[11px] leading-5 text-slate-600">
                                <code className="bg-white px-1 font-mono text-[10px] text-cyan-800">{`{{${variable.name}}}`}</code>
                                {' '}{variable.description}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
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

                <aside className="xl:sticky xl:top-5 xl:self-start">
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
            ) : (
              <div className="flex min-h-72 items-center justify-center text-sm text-slate-500">
                左の一覧からプロンプトを選択してください
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  )
}

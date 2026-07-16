'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookmarkPlus, Check, LayoutTemplate, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  knowledgeLibraryApi,
  normalizeFolderTemplates,
  type NormalizedFolderTemplate,
} from '@/lib/knowledge-library'

interface FolderTemplateMenuProps {
  projectId: string
  onApplied: () => void
}

export function FolderTemplateMenu({ projectId, onApplied }: FolderTemplateMenuProps) {
  const [templates, setTemplates] = useState<NormalizedFolderTemplate[]>([])
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await knowledgeLibraryApi.templates(projectId)
      const next = normalizeFolderTemplates(response)
      setTemplates(next)
      setDraftNames(Object.fromEntries(next.map((template) => [template.id, template.name])))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'テンプレートを取得できませんでした')
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key)
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(success)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'テンプレートを更新できませんでした')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="folder-templates-heading" className="border-t border-slate-200 pt-5">
      <div className="mb-3 flex items-center gap-2">
        <LayoutTemplate className="h-4 w-4 text-amber-600" />
        <h2 id="folder-templates-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-slate-700">構成テンプレート</h2>
      </div>

      <div className="space-y-2">
        {templates.map((template) => (
          <div key={template.id} className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0">
            {template.kind === 'builtIn' ? (
              <>
                <div className="text-sm font-semibold text-slate-900">{template.name}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{template.description}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-9 w-full justify-start"
                  disabled={busy !== null}
                  onClick={() => void run(template.id, async () => {
                    await knowledgeLibraryApi.applyTemplate(projectId, template.id)
                    onApplied()
                  }, `${template.name}を適用しました`)}
                >
                  {busy === template.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
                  {template.name}を適用
                </Button>
              </>
            ) : (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="sr-only" htmlFor={`template-${template.id}`}>{template.name}の名前</label>
                <Input
                  id={`template-${template.id}`}
                  value={draftNames[template.id] ?? template.name}
                  onChange={(event) => setDraftNames((current) => ({ ...current, [template.id]: event.target.value }))}
                  className="h-9 bg-white text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2 text-red-700"
                  aria-label={`${template.name}を削除`}
                  disabled={busy !== null}
                  onClick={() => void run(`delete:${template.id}`, () => knowledgeLibraryApi.deleteTemplate(projectId, template.id), `${template.name}を削除しました`)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="col-span-2 h-9"
                  disabled={busy !== null || !(draftNames[template.id] ?? '').trim()}
                  aria-label={`${template.name}の名前を保存`}
                  onClick={() => void run(`rename:${template.id}`, () => knowledgeLibraryApi.updateTemplate(projectId, template.id, draftNames[template.id].trim()), 'テンプレート名を保存しました')}
                >
                  名前を保存
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <label htmlFor="company-template-name" className="mb-2 block text-xs font-semibold text-slate-700">会社テンプレート名</label>
        <Input
          id="company-template-name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="例: 監査プロジェクト標準"
          className="h-9 bg-white"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-9 w-full"
          disabled={busy !== null || !newName.trim()}
          onClick={() => void run('create', async () => {
            await knowledgeLibraryApi.createTemplate(projectId, newName.trim())
            setNewName('')
          }, '現在の構成を会社テンプレートへ保存しました')}
        >
          <BookmarkPlus className="mr-2 h-3.5 w-3.5" />現在の構成を保存
        </Button>
      </div>

      {message ? <p role="status" className="mt-3 text-xs leading-5 text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-xs leading-5 text-red-700">{error}</p> : null}
    </section>
  )
}

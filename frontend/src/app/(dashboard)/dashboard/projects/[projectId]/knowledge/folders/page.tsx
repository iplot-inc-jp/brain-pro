'use client'

import { useParams } from 'next/navigation'
import { Archive } from 'lucide-react'
import { KnowledgeFolderWorkspace } from '@/components/knowledge-library/knowledge-folder-workspace'

export default function KnowledgeFoldersPage() {
  const { projectId } = useParams<{ projectId: string }>()

  return (
    <main className="min-h-full bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white px-5 py-6 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[92rem]">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            <Archive className="h-4 w-4 text-amber-600" />Knowledge archive
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ナレッジフォルダ</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">資料の保存場所を変えずに、用途ごとの棚へ複数分類できます。</p>
        </div>
      </header>
      <div className="mx-auto max-w-[92rem] px-0 py-5 sm:px-6 lg:px-10 lg:py-8">
        <KnowledgeFolderWorkspace projectId={projectId} />
      </div>
    </main>
  )
}

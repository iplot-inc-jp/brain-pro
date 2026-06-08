'use client'

import * as React from 'react'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getManualEntry } from '@/components/manual/manual-content'

export interface ManualButtonProps {
  /** 表示する機能のキー（MANUAL_ENTRIES のキー）。未登録なら何も描画しません。 */
  feature: string
  /** ボタンのラベル（既定: マニュアルを見る） */
  label?: string
  /** ボタンに付ける追加クラス */
  className?: string
}

/**
 * 「マニュアルを見る」アウトラインボタン。
 * クリックで該当機能のマニュアル(目的・簡易図解・手順)をモーダル表示します。
 * feature が未登録の場合は何も描画しません。
 */
export function ManualButton({
  feature,
  label = 'マニュアルを見る',
  className,
}: ManualButtonProps) {
  const entry = getManualEntry(feature)
  if (!entry) return null

  const { title, purpose, steps, Illustration } = entry

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <BookOpen className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle style={{ color: '#050f3e' }}>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 目的 */}
          <p className="text-sm leading-relaxed text-slate-600">{purpose}</p>

          {/* 簡易図解 */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              画面イメージ（簡易図解）
            </h3>
            <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-2">
              <Illustration />
            </div>
          </section>

          {/* 手順 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <span
                className="inline-block h-3 w-1 rounded-full"
                style={{ backgroundColor: '#2563eb' }}
                aria-hidden="true"
              />
              操作手順
            </h3>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ManualButton

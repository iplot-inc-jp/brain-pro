'use client'

// 取り込みファイル状況テーブル。
//   行ごと: ファイル名 / 種別 / status バッジ / step / 進捗バー / 試行回数 / エラー(展開) /
//           [リトライ][スキップ][原本]。
//   ZIP（isArchive）は子ファイル（parentFileId）をぶら下げた展開可能行として表示。

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronRight,
  ChevronDown,
  FileArchive,
  FileText,
  ExternalLink,
  RotateCw,
  SkipForward,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FILE_STATUS_LABEL,
  isFileTerminal,
  formatBytes,
  type IngestionFile,
  type IngestionFileStatus,
} from '@/lib/knowledge'

/** status ごとの色（pill）。 */
const STATUS_STYLE: Record<IngestionFileStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  FETCHING: 'bg-blue-100 text-blue-700',
  EXPANDING: 'bg-blue-100 text-blue-700',
  PREPROCESSING: 'bg-blue-100 text-blue-700',
  EXTRACTING: 'bg-indigo-100 text-indigo-700',
  MERGING: 'bg-violet-100 text-violet-700',
  SUCCEEDED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-amber-100 text-amber-700',
}

function StatusPill({ status }: { status: IngestionFileStatus }) {
  const active = !isFileTerminal(status) && status !== 'PENDING'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_STYLE[status],
      )}
    >
      {active && <Loader2 className="h-3 w-3 animate-spin" />}
      {FILE_STATUS_LABEL[status]}
    </span>
  )
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

interface RowProps {
  file: IngestionFile
  depth: number
  busy: boolean
  canEdit: boolean
  onRetry: (id: string) => void
  onSkip: (id: string) => void
  expanded: boolean
  hasChildren: boolean
  onToggle: () => void
  errorOpen: boolean
  onToggleError: () => void
}

function FileRow({
  file,
  depth,
  busy,
  canEdit,
  onRetry,
  onSkip,
  expanded,
  hasChildren,
  onToggle,
  errorOpen,
  onToggleError,
}: RowProps) {
  const canRetry = canEdit && file.status === 'FAILED'
  const canSkip = canEdit && !isFileTerminal(file.status)

  return (
    <>
      <tr className="border-b border-border hover:bg-secondary/40">
        {/* ファイル名（+ 展開トグル / アイコン） */}
        <td className="py-2 pr-2">
          <div
            className="flex items-center gap-1.5 min-w-0"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={onToggle}
                className="text-muted-foreground hover:text-foreground"
                aria-label={expanded ? '閉じる' : '展開'}
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="w-4" />
            )}
            {file.isArchive ? (
              <FileArchive className="h-4 w-4 flex-shrink-0 text-amber-500" />
            ) : (
              <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <span className="truncate" title={file.displayName || file.filename}>
              {file.displayName || file.filename}
            </span>
          </div>
        </td>

        {/* 種別（mime） */}
        <td className="py-2 pr-2 text-xs text-muted-foreground whitespace-nowrap">
          {file.mimeType || '-'}
          {file.size != null && (
            <span className="ml-1 opacity-70">{formatBytes(file.size)}</span>
          )}
        </td>

        {/* status */}
        <td className="py-2 pr-2">
          <StatusPill status={file.status} />
        </td>

        {/* step + 進捗 */}
        <td className="py-2 pr-2 min-w-[160px]">
          <div className="text-xs text-muted-foreground truncate mb-1" title={file.step || ''}>
            {file.step || '-'}
          </div>
          <ProgressBar value={file.progress} />
        </td>

        {/* 試行 */}
        <td className="py-2 pr-2 text-xs text-muted-foreground text-center whitespace-nowrap">
          {file.attempts}/{file.maxAttempts}
        </td>

        {/* 操作 */}
        <td className="py-2 pl-2">
          <div className="flex items-center justify-end gap-1">
            {file.error && (
              <button
                type="button"
                onClick={onToggleError}
                className={cn(
                  'inline-flex items-center gap-1 text-xs px-1.5 py-1 rounded hover:bg-secondary',
                  errorOpen ? 'text-destructive' : 'text-muted-foreground',
                )}
                title="エラー詳細"
              >
                <AlertCircle className="h-3.5 w-3.5" />
              </button>
            )}
            {canRetry && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={busy}
                onClick={() => onRetry(file.id)}
                title="リトライ"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            )}
            {canSkip && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={busy}
                onClick={() => onSkip(file.id)}
                title="スキップ"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
            )}
            {file.blobUrl && /^https?:\/\//.test(file.blobUrl) && (
              <a
                href={file.blobUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center h-7 px-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                title="原本を開く"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </td>
      </tr>

      {/* エラー展開行 */}
      {errorOpen && file.error && (
        <tr className="border-b border-border bg-red-50/50">
          <td colSpan={6} className="py-2 px-3">
            <pre
              className="text-xs text-red-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              {file.error}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

interface Props {
  files: IngestionFile[]
  busy: boolean
  canEdit: boolean
  onRetry: (id: string) => void
  onSkip: (id: string) => void
}

/**
 * ファイル群を parentFileId で 親→子（ZIP 展開）にまとめて描画する。
 * 親（parentFileId=null）を上位行、子をぶら下げて表示。
 */
export function FileStatusTable({
  files,
  busy,
  canEdit,
  onRetry,
  onSkip,
}: Props) {
  // 展開トグル（ZIP 行ごと）・エラー展開（ファイル行ごと）
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [errorOpen, setErrorOpen] = useState<Set<string>>(new Set())

  const toggle = (id: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  // parentFileId で子をグルーピング
  const childrenByParent = new Map<string, IngestionFile[]>()
  for (const f of files) {
    if (f.parentFileId) {
      const list = childrenByParent.get(f.parentFileId) ?? []
      list.push(f)
      childrenByParent.set(f.parentFileId, list)
    }
  }
  const roots = files.filter((f) => !f.parentFileId)

  const rows: React.ReactNode[] = []
  const renderNode = (file: IngestionFile, depth: number) => {
    const children = childrenByParent.get(file.id) ?? []
    const hasChildren = children.length > 0
    const isExpanded = expanded.has(file.id)
    rows.push(
      <FileRow
        key={file.id}
        file={file}
        depth={depth}
        busy={busy}
        canEdit={canEdit}
        onRetry={onRetry}
        onSkip={onSkip}
        expanded={isExpanded}
        hasChildren={hasChildren}
        onToggle={() => toggle(file.id, expanded, setExpanded)}
        errorOpen={errorOpen.has(file.id)}
        onToggleError={() => toggle(file.id, errorOpen, setErrorOpen)}
      />,
    )
    if (hasChildren && isExpanded) {
      for (const child of children) renderNode(child, depth + 1)
    }
  }
  for (const root of roots) renderNode(root, 0)

  if (files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        ファイルがありません。
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="text-left font-medium py-2 pr-2">ファイル</th>
            <th className="text-left font-medium py-2 pr-2">種別</th>
            <th className="text-left font-medium py-2 pr-2">状態</th>
            <th className="text-left font-medium py-2 pr-2">ステップ / 進捗</th>
            <th className="text-center font-medium py-2 pr-2">試行</th>
            <th className="text-right font-medium py-2 pl-2">操作</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}

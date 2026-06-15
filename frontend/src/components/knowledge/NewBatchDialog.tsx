'use client'

// 新規取り込みバッチ ダイアログ。
//   ① ソース選択（アップロード（ZIP可・複数） / 既存添付から選択 / Google Drive）
//   ② ファイル一覧プレビュー
//   ③ 抽出オプション（プロジェクト設定を初期値に AI抽出/OCR ON/OFF・モデルをバッチ上書き）
//   ④ 開始（POST ingestion-batches）
//
// Drive タブ（Phase 3）: 未接続なら getAuthUrl→新規ウィンドウで認証、接続済なら
// listFiles でファイル一覧→選択。Drive 機能が未設定/未許可（401/未設定）なら
// 「未設定」表示にして、他タブ（アップロード/既存添付）は使えるままにする。

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
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { uploadProjectFile } from '@/lib/upload'
import {
  Loader2,
  X,
  FileArchive,
  FileText,
  Folder,
  Paperclip,
  RefreshCw,
  ChevronRight,
  HardDrive,
  Upload as UploadIcon,
} from 'lucide-react'
import {
  ingestionApi,
  listSelectableAttachments,
  driveApi,
  formatBytes,
  isArchiveFile,
  CLAUDE_MODEL_OPTIONS,
  DriveNotConfiguredError,
  type IngestionBatchSource,
  type IngestionBatchOptions,
  type IngestionUploadResult,
  type SelectableAttachment,
  type ProjectKnowledgeSettings,
  type DriveFile,
} from '@/lib/knowledge'

/** Drive のフォルダ（mimeType でも isFolder でも判定）。 */
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'
function isDriveFolder(f: DriveFile): boolean {
  return f.isFolder === true || f.mimeType === DRIVE_FOLDER_MIME
}

/** パンくず 1 要素（root は id=null）。 */
interface DriveCrumb {
  id: string | null
  name: string
}

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
  /**
   * 開いた時に事前選択しておく既存添付の id 群（背景・目的の関連資料から
   * 「ナレッジに取り込む」で渡る共有プール導線で使う）。指定時は「既存添付」タブを既定で開く。
   */
  initialAttachmentIds?: string[]
}

const ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv,.docx,.doc,.pptx,.txt,.md,.json,.zip'

export function NewBatchDialog({
  open,
  onClose,
  projectId,
  settings,
  onCreated,
  initialAttachmentIds,
}: Props) {
  const [name, setName] = useState('')
  // 事前選択の id 群（配列の参照変化で effect が暴発しないよう安定キーで扱う）。
  const initialAttKey = (initialAttachmentIds ?? []).join(',')
  // ソース選択タブ（事前選択があれば「既存添付」を開く）。
  const [tab, setTab] = useState<string>('upload')
  const [uploads, setUploads] = useState<StagedUpload[]>([])
  const [attachments, setAttachments] = useState<SelectableAttachment[]>([])
  const [selectedAttIds, setSelectedAttIds] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [loadingAtt, setLoadingAtt] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Google Drive タブ
  const [driveEnabled, setDriveEnabled] = useState(true) // 401/未設定なら false
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveEmail, setDriveEmail] = useState<string | null>(null)
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveAuthing, setDriveAuthing] = useState(false)
  const [driveCrumbs, setDriveCrumbs] = useState<DriveCrumb[]>([
    { id: null, name: 'マイドライブ' },
  ])
  // 選択した Drive ファイル（id→メタ）。フォルダ間移動でも保持するため Map で持つ。
  const [selectedDrive, setSelectedDrive] = useState<Map<string, DriveFile>>(
    new Map(),
  )

  // オプション（プロジェクト設定を初期値に、バッチ単位で上書き）
  const [aiExtractionEnabled, setAiExtractionEnabled] = useState(true)
  const [ocrEnabled, setOcrEnabled] = useState(true)
  const [model, setModel] = useState<string>('')

  // ダイアログを開くたびに初期化（設定を反映）
  useEffect(() => {
    if (!open) return
    setName('')
    setUploads([])
    // 共有プール導線で渡った既存添付を事前選択し、「既存添付」タブを開く。
    const preselect = initialAttKey ? initialAttKey.split(',') : []
    setSelectedAttIds(new Set(preselect))
    setTab(preselect.length > 0 ? 'attachment' : 'upload')
    setError(null)
    setAiExtractionEnabled(settings?.aiExtractionEnabled ?? true)
    setOcrEnabled(settings?.ocrEnabled ?? true)
    setModel(settings?.defaultModel ?? '')
    // Drive
    setDriveEnabled(true)
    setDriveConnected(false)
    setDriveEmail(null)
    setDriveFiles([])
    setDriveCrumbs([{ id: null, name: 'マイドライブ' }])
    setSelectedDrive(new Map())
  }, [open, settings, initialAttKey])

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

  // Drive: 指定フォルダ（既定 root）の一覧を取得。401/未設定なら driveEnabled=false。
  const loadDriveFiles = useCallback(
    async (folderId: string | null) => {
      setDriveLoading(true)
      setError(null)
      try {
        const res = await driveApi.listFiles(projectId, folderId ?? undefined)
        setDriveEnabled(true)
        setDriveConnected(res.connected)
        setDriveEmail(res.email ?? null)
        setDriveFiles(res.connected ? res.files : [])
      } catch (e) {
        if (e instanceof DriveNotConfiguredError) {
          // 機能未設定: タブは「未設定」表示。他タブは使えるまま。
          setDriveEnabled(false)
          setDriveConnected(false)
          setDriveFiles([])
        } else {
          setError(e instanceof Error ? e.message : 'Drive の取得に失敗しました')
        }
      } finally {
        setDriveLoading(false)
      }
    },
    [projectId],
  )

  // 開いた時に Drive 接続状態を一度だけ確認（root を引いて connected を判定）。
  useEffect(() => {
    if (open) loadDriveFiles(null)
  }, [open, loadDriveFiles])

  // 未接続→認証 URL を新規ウィンドウで開く。閉じたら一覧を再取得して接続反映。
  const connectDrive = useCallback(async () => {
    setDriveAuthing(true)
    setError(null)
    try {
      const { authUrl } = await driveApi.getAuthUrl(projectId)
      const popup = window.open(
        authUrl,
        'drive-oauth',
        'width=520,height=640,menubar=no,toolbar=no',
      )
      if (!popup) {
        setError(
          'ポップアップがブロックされました。ブラウザの設定で許可してください。',
        )
        setDriveAuthing(false)
        return
      }
      // ポップアップが閉じたら接続状態を再取得（callback は別ウィンドウで完結）。
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer)
          setDriveAuthing(false)
          // root から取り直して接続を反映
          setDriveCrumbs([{ id: null, name: 'マイドライブ' }])
          loadDriveFiles(null)
        }
      }, 800)
    } catch (e) {
      if (e instanceof DriveNotConfiguredError) {
        setDriveEnabled(false)
      } else {
        setError(e instanceof Error ? e.message : 'Drive 認証に失敗しました')
      }
      setDriveAuthing(false)
    }
  }, [projectId, loadDriveFiles])

  // フォルダを開く（パンくず追加して一覧取得）。
  const openDriveFolder = useCallback(
    (folder: DriveFile) => {
      setDriveCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }])
      loadDriveFiles(folder.id)
    },
    [loadDriveFiles],
  )

  // パンくずクリックでそこまで戻る。
  const goToCrumb = useCallback(
    (index: number) => {
      setDriveCrumbs((prev) => {
        const next = prev.slice(0, index + 1)
        const target = next[next.length - 1]
        loadDriveFiles(target.id)
        return next
      })
    },
    [loadDriveFiles],
  )

  // Drive ファイル選択トグル（フォルダは選択不可）。
  const toggleDriveFile = useCallback((f: DriveFile) => {
    setSelectedDrive((prev) => {
      const next = new Map(prev)
      if (next.has(f.id)) next.delete(f.id)
      else next.set(f.id, f)
      return next
    })
  }, [])

  const disconnectDrive = useCallback(async () => {
    setError(null)
    try {
      await driveApi.deleteConnection(projectId)
    } catch (e) {
      if (!(e instanceof DriveNotConfiguredError)) {
        setError(e instanceof Error ? e.message : 'Drive 接続の解除に失敗しました')
      }
    } finally {
      setDriveConnected(false)
      setDriveEmail(null)
      setDriveFiles([])
      setDriveCrumbs([{ id: null, name: 'マイドライブ' }])
      setSelectedDrive(new Map())
    }
  }, [projectId])

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setUploading(true)
      setError(null)
      try {
        // 共有プール: アップロードは即 Attachment 化（client直Blob、未設定時はサーバ経由）。
        // 取り込みは ATTACHMENT ソースで参照するため、再アップロードなしで何度でも再開/再試行できる。
        const ids: string[] = []
        for (const f of files) {
          const att = await uploadProjectFile(projectId, f)
          ids.push(att.id)
        }
        // 既存添付一覧を再取得し、アップロード分を選択状態に（「既存添付」タブで確認できる）。
        await loadAttachments()
        setSelectedAttIds((prev) => {
          const next = new Set(prev)
          for (const id of ids) next.add(id)
          return next
        })
        setTab('attachment')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'アップロードに失敗しました')
      } finally {
        setUploading(false)
      }
    },
    [projectId, loadAttachments],
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

  const totalSelected = uploads.length + selectedAttIds.size + selectedDrive.size

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
      // Drive 選択分（既存の files 配列に統合）。sourceRef = driveFileId。
      for (const f of Array.from(selectedDrive.values())) {
        files.push({
          sourceType: 'DRIVE',
          sourceRef: f.id,
          filename: f.name,
          ...(f.mimeType ? { mimeType: f.mimeType } : {}),
          ...(f.size != null ? { size: f.size } : {}),
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
      <DialogContent className="w-[80vw] max-w-[80vw] sm:max-w-[80vw] max-h-[90vh] overflow-y-auto">
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

          {/* ソース選択（事前選択があれば「既存添付」タブを開く） */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="upload">
                <UploadIcon className="h-3.5 w-3.5 mr-1.5" />
                アップロード
              </TabsTrigger>
              <TabsTrigger value="attachment">
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                既存添付から選択
              </TabsTrigger>
              <TabsTrigger value="drive">
                <HardDrive className="h-3.5 w-3.5 mr-1.5" />
                Google Drive
              </TabsTrigger>
            </TabsList>

            {/* 取り込み元（ソース）の説明 */}
            <p className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
              取り込む素材（ファイル）の集め方を選びます。
              <HelpTooltip text="アップロード=PC上のファイルを新規アップロード（ZIPは自動展開）。既存添付から選択=このプロジェクトに既にある添付ファイルを再利用。Google Drive=連携済みなら Drive のファイルを取り込み。どれを選んでも AI でナレッジグラフ化されます。" />
            </p>

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
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                このプロジェクトに既にある添付ファイルから選びます。
                <HelpTooltip text="「既存添付」= このプロジェクトのどこかに既にアップロード済みのファイル（背景・目的ページの関連資料、タスクの添付、業務フローの添付、情報種別の具体データ など）。アップロードし直さずに、そのままナレッジ取り込みの素材にできます。" />
              </p>
              {loadingAtt ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  読み込み中…
                </div>
              ) : attachments.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center space-y-1">
                  <div>選択できる添付ファイルがありません。</div>
                  <div className="text-xs">
                    このプロジェクトにはまだ添付がありません。「アップロード」タブから追加するか、
                    背景・目的ページなどで資料を添付してください。
                  </div>
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

            {/* Google Drive */}
            <TabsContent value="drive" className="space-y-2 pt-2">
              {!driveEnabled ? (
                <div className="text-sm text-muted-foreground py-6 text-center space-y-1">
                  <HardDrive className="h-6 w-6 mx-auto opacity-50" />
                  <div>Google Drive 連携は未設定です。</div>
                  <div className="text-xs">
                    アップロード／既存添付タブはそのまま利用できます。
                  </div>
                </div>
              ) : driveLoading && !driveConnected ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  読み込み中…
                </div>
              ) : !driveConnected ? (
                <div className="text-sm text-muted-foreground py-6 text-center space-y-3">
                  <div>Google Drive と接続するとファイルを取り込めます。</div>
                  <Button
                    type="button"
                    onClick={connectDrive}
                    disabled={driveAuthing}
                  >
                    {driveAuthing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <HardDrive className="h-4 w-4 mr-1.5" />
                    )}
                    Google Drive に接続
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* 接続情報＋操作 */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate flex-1">
                      接続中{driveEmail ? `: ${driveEmail}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        loadDriveFiles(
                          driveCrumbs[driveCrumbs.length - 1]?.id ?? null,
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${driveLoading ? 'animate-spin' : ''}`}
                      />
                      再読込
                    </button>
                    <button
                      type="button"
                      onClick={disconnectDrive}
                      className="hover:text-destructive"
                    >
                      接続解除
                    </button>
                  </div>

                  {/* パンくず */}
                  <div className="flex items-center flex-wrap gap-0.5 text-xs">
                    {driveCrumbs.map((c, i) => (
                      <span key={`${c.id ?? 'root'}-${i}`} className="flex items-center">
                        {i > 0 && (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        )}
                        <button
                          type="button"
                          onClick={() => goToCrumb(i)}
                          disabled={i === driveCrumbs.length - 1}
                          className={
                            i === driveCrumbs.length - 1
                              ? 'font-medium text-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }
                        >
                          {c.name}
                        </button>
                      </span>
                    ))}
                  </div>

                  {/* ファイル一覧 */}
                  {driveLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      読み込み中…
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-6 text-center">
                      このフォルダにファイルはありません。
                    </div>
                  ) : (
                    <ul className="space-y-1 max-h-56 overflow-y-auto">
                      {driveFiles.map((f) => {
                        if (isDriveFolder(f)) {
                          return (
                            <li key={f.id}>
                              <button
                                type="button"
                                onClick={() => openDriveFolder(f)}
                                className="w-full flex items-center gap-2 text-sm rounded-md border border-border px-2 py-1.5 hover:bg-secondary text-left"
                              >
                                <Folder className="h-4 w-4 flex-shrink-0 text-sky-500" />
                                <span className="truncate flex-1">{f.name}</span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </li>
                          )
                        }
                        const checked = selectedDrive.has(f.id)
                        return (
                          <li key={f.id}>
                            <label className="flex items-center gap-2 text-sm rounded-md border border-border px-2 py-1.5 cursor-pointer hover:bg-secondary">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDriveFile(f)}
                                className="h-4 w-4"
                              />
                              {isArchiveFile(f.name, f.mimeType ?? undefined) ? (
                                <FileArchive className="h-4 w-4 flex-shrink-0 text-amber-500" />
                              ) : (
                                <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                              )}
                              <span className="truncate flex-1">{f.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatBytes(f.size)}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {selectedDrive.size > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Drive 選択: {selectedDrive.size} 件
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* 抽出オプション（料金ガード。プロジェクト設定を初期値にバッチ上書き） */}
          <div className="rounded-md border border-border p-3 space-y-2.5">
            <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              抽出オプション（このバッチのみ上書き）
              <HelpTooltip text="プロジェクトの既定設定（設定 > AI使用量、またはナレッジ設定）を初期値とし、このバッチだけ一時的に上書きします。次回以降の既定は変わりません。" />
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
              <Label htmlFor="batch-model" className="flex items-center gap-1 text-xs">
                モデル（任意・空欄でサーバ既定）
                <HelpTooltip text="抽出に使う Claude モデル。下に行くほど高品質・高単価です。空欄（サーバ既定）はサーバの環境変数 EXTRACTION_MODEL（既定 claude-sonnet-4-6）を使います。高品質が必要な文書だけ opus / fable を選ぶのがおすすめ。" />
              </Label>
              <Select
                value={model || '__default__'}
                onValueChange={(v) => setModel(v === '__default__' ? '' : v)}
              >
                <SelectTrigger id="batch-model" className="h-9">
                  <SelectValue placeholder="サーバ既定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    サーバ既定（EXTRACTION_MODEL / 既定 claude-sonnet-4-6）
                  </SelectItem>
                  {CLAUDE_MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
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

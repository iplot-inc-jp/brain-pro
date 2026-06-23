'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Database,
  GitBranch,
  Users,
  Settings,
  LogOut,
  FolderOpen,
  Menu,
  PanelLeftClose,
  PanelLeft,
  FileText,
  Grid3X3,
  Home,
  Inbox,
  ChevronRight,
  ChevronDown,
  Zap,
  Network,
  Share2,
  GitCompare,
  Layers,
  Github,
  Building2,
  UserCog,
  ClipboardList,
  Presentation,
  Target,
  ListTodo,
  GanttChartSquare,
  CalendarClock,
  Map as MapIcon,
  ShieldAlert,
  FileSpreadsheet,
  Landmark,
  History,
  ArrowLeftRight,
  Server,
  Lock,
  Compass,
  Boxes,
  Table2,
  TableProperties,
  Brain,
  FileStack,
  BarChart3,
  Goal,
  Gauge,
  Activity,
  ListChecks,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

// プロジェクトIDを抽出する関数
function extractProjectId(pathname: string): string | null {
  const match = pathname.match(/\/dashboard\/projects\/([^/]+)/)
  return match ? match[1] : null
}

// 認証ヘッダーを生成
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

// プロジェクト名を取得するhook
function useProjectName(projectId: string | null) {
  const [projectName, setProjectName] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setProjectName(null)
      return
    }

    const fetchProject = async () => {
      try {
        const res = await fetch(`${API_URL}/api/projects/${projectId}`, {
          headers: authHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          setProjectName(data.name)
        }
      } catch (err) {
        console.error('Failed to fetch project:', err)
      }
    }

    fetchProject()
  }, [projectId])

  return projectName
}

// 現在のユーザー情報を一度だけ取得するhook（RBACナビゲーション制御用）
function useCurrentUser() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchMe = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: authHeaders(),
        })
        if (!cancelled && res.ok) {
          const data = await res.json()
          setIsSuperAdmin(Boolean(data?.isSuperAdmin))
        }
      } catch (err) {
        console.error('Failed to fetch current user:', err)
      }
    }

    fetchMe()

    return () => {
      cancelled = true
    }
  }, [])

  return { isSuperAdmin }
}

// 業務フローツリー用の型
// 領域（SubProject）は parentId で 領域→サブ領域 の入れ子を持つ。
type SubProject = {
  id: string
  name: string
  parentId?: string | null
  order?: number
}

type BusinessFlow = {
  id: string
  name: string
  kind: 'ASIS' | 'TOBE'
  subProjectId?: string | null
}

// 領域（SubProject）・フローを取得するhook（projectId変更時のみ）
function useFlowTree(projectId: string | null) {
  const [subProjects, setSubProjects] = useState<SubProject[]>([])
  const [flows, setFlows] = useState<BusinessFlow[]>([])

  useEffect(() => {
    if (!projectId) {
      setSubProjects([])
      setFlows([])
      return
    }

    let cancelled = false

    const fetchTree = async () => {
      try {
        const [subRes, flowRes] = await Promise.all([
          fetch(`${API_URL}/api/projects/${projectId}/sub-projects`, {
            headers: authHeaders(),
          }),
          fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
            headers: authHeaders(),
          }),
        ])

        if (!cancelled && subRes.ok) {
          const subData = await subRes.json()
          setSubProjects(Array.isArray(subData) ? subData : [])
        }
        if (!cancelled && flowRes.ok) {
          const flowData = await flowRes.json()
          setFlows(Array.isArray(flowData) ? flowData : [])
        }
      } catch (err) {
        console.error('Failed to fetch flow tree:', err)
      }
    }

    fetchTree()

    return () => {
      cancelled = true
    }
  }, [projectId])

  return { subProjects, flows }
}

// フローの子タブ（メニューダウン）。flows/[flowId] の ?tab= と一致させる。
const FLOW_LEAF_TABS = [
  { tab: 'flow', name: 'フロー図' },
  { tab: 'definition', name: '個別定義' },
  { tab: 'cruoa', name: '情報の地図(CRUOA)' },
  { tab: 'dfd', name: 'DFD' },
] as const

// フロー1本のサイドメニュー項目。名前リンク＋右端シェブロンで子タブの開閉。
// アクティブなフローのみ初期展開し、各子タブは ?tab= へ deep-link する
// （ページ内タブと双方向同期。useTabParam 参照）。
function FlowLeaf({
  flow,
  projectId,
  pathname,
  onNavigate,
}: {
  flow: BusinessFlow
  projectId: string
  pathname: string
  onNavigate: () => void
}) {
  const href = `/dashboard/projects/${projectId}/flows/${flow.id}`
  const isActive = pathname === href
  const searchParams = useSearchParams()
  const currentTab = isActive ? searchParams.get('tab') ?? 'flow' : null
  const [open, setOpen] = useState(isActive)

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 pr-1 rounded-md transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-secondary',
          isActive && 'text-primary font-medium bg-primary/10'
        )}
      >
        <Link
          href={href}
          onClick={onNavigate}
          title={flow.name}
          className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 text-xs"
        >
          <GitBranch className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
          <span className="truncate">{flow.name}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'タブを閉じる' : 'タブを開く'}
          aria-expanded={open}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/80 flex-shrink-0"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {open && (
        <div className="ml-5 pl-2 mt-0.5 space-y-0.5 border-l border-border/60">
          {FLOW_LEAF_TABS.map((t) => {
            const tabHref = t.tab === 'flow' ? href : `${href}?tab=${t.tab}`
            const tabActive = currentTab === t.tab
            return (
              <Link
                key={t.tab}
                href={tabHref}
                onClick={onNavigate}
                title={t.name}
                className={cn(
                  'block px-3 py-1 rounded-md text-[11px] transition-colors',
                  'text-muted-foreground hover:text-foreground hover:bg-secondary',
                  tabActive && 'text-primary font-medium bg-primary/10'
                )}
              >
                {t.name}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ASIS/TOBE サブグループ
function FlowKindGroup({
  label,
  flows,
  projectId,
  pathname,
  onNavigate,
}: {
  label: 'ASIS' | 'TOBE'
  flows: BusinessFlow[]
  projectId: string
  pathname: string
  onNavigate: () => void
}) {
  const [open, setOpen] = useState(true)
  if (flows.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        <span
          className={cn(
            'tracking-wide',
            label === 'ASIS' ? 'text-amber-600' : 'text-emerald-600'
          )}
        >
          {label}
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground/70">({flows.length})</span>
      </button>
      {open && (
        <div className="space-y-0.5 pl-3">
          {flows.map((flow) => (
            <FlowLeaf
              key={flow.id}
              flow={flow}
              projectId={projectId}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// 領域（SubProject）ノード（入れ子サブ領域 → 配下の ASIS/TOBE フロー）
// parentId による 領域→サブ領域 の入れ子をそのまま描画する。
function SubProjectNode({
  subProject,
  childSubProjectsByParent,
  flowsBySubProject,
  projectId,
  pathname,
  onNavigate,
}: {
  subProject: SubProject
  childSubProjectsByParent: Map<string | null, SubProject[]>
  flowsBySubProject: Map<string | null, BusinessFlow[]>
  projectId: string
  pathname: string
  onNavigate: () => void
}) {
  const childSubProjects = childSubProjectsByParent.get(subProject.id) ?? []
  const ownFlows = flowsBySubProject.get(subProject.id) ?? []

  // 配下（自領域 + 子孫サブ領域）に現在開いているフローがあれば初期展開
  const containsActive = useMemo(() => {
    const matches = (flows: BusinessFlow[]) =>
      flows.some((f) => pathname === `/dashboard/projects/${projectId}/flows/${f.id}`)
    if (matches(ownFlows)) return true
    const stack = [...childSubProjects]
    const seen = new Set<string>() // 循環(parentId ループ)で無限ループしないよう防止
    while (stack.length) {
      const c = stack.pop()!
      if (seen.has(c.id)) continue
      seen.add(c.id)
      if (matches(flowsBySubProject.get(c.id) ?? [])) return true
      stack.push(...(childSubProjectsByParent.get(c.id) ?? []))
    }
    return false
  }, [ownFlows, childSubProjects, childSubProjectsByParent, flowsBySubProject, pathname, projectId])

  const [open, setOpen] = useState(containsActive)

  // フローもサブ領域も無い空の領域は表示しない
  if (childSubProjects.length === 0 && ownFlows.length === 0) return null

  const totalCount = (() => {
    let n = ownFlows.length
    const stack = [...childSubProjects]
    const seen = new Set<string>() // 循環(parentId ループ)で無限ループしないよう防止
    while (stack.length) {
      const c = stack.pop()!
      if (seen.has(c.id)) continue
      seen.add(c.id)
      n += (flowsBySubProject.get(c.id) ?? []).length
      stack.push(...(childSubProjectsByParent.get(c.id) ?? []))
    }
    return n
  })()

  const asisFlows = ownFlows.filter((f) => f.kind === 'ASIS')
  const tobeFlows = ownFlows.filter((f) => f.kind === 'TOBE')

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        title={subProject.name}
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors',
          'text-foreground/80 hover:text-foreground hover:bg-secondary'
        )}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Layers className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
        <span className="truncate">{subProject.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">{totalCount}</span>
      </button>
      {open && (
        <div className="pl-3 mt-0.5 space-y-0.5 border-l border-border/60 ml-2">
          {/* 子領域（サブ領域・入れ子） */}
          {childSubProjects.map((child) => (
            <SubProjectNode
              key={child.id}
              subProject={child}
              childSubProjectsByParent={childSubProjectsByParent}
              flowsBySubProject={flowsBySubProject}
              projectId={projectId}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
          {/* この領域直下のフロー（ASIS/TOBE 構造） */}
          <FlowKindGroup
            label="ASIS"
            flows={asisFlows}
            projectId={projectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
          <FlowKindGroup
            label="TOBE"
            flows={tobeFlows}
            projectId={projectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  )
}

// 領域なし（領域未割当）のフローノード（ASIS/TOBE 構造）
function UnassignedNode({
  flows,
  projectId,
  pathname,
  onNavigate,
}: {
  flows: BusinessFlow[]
  projectId: string
  pathname: string
  onNavigate: () => void
}) {
  const containsActive = flows.some(
    (f) => pathname === `/dashboard/projects/${projectId}/flows/${f.id}`
  )
  const [open, setOpen] = useState(containsActive)

  if (flows.length === 0) return null

  const asisFlows = flows.filter((f) => f.kind === 'ASIS')
  const tobeFlows = flows.filter((f) => f.kind === 'TOBE')

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        title="領域なし"
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors',
          'text-foreground/80 hover:text-foreground hover:bg-secondary'
        )}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Layers className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
        <span className="truncate">領域なし</span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">{flows.length}</span>
      </button>
      {open && (
        <div className="pl-3 mt-0.5 space-y-0.5 border-l border-border/60 ml-2">
          <FlowKindGroup
            label="ASIS"
            flows={asisFlows}
            projectId={projectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
          <FlowKindGroup
            label="TOBE"
            flows={tobeFlows}
            projectId={projectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  )
}

// 業務フローツリー全体（領域 → サブ領域 → ASIS/TOBE → フロー）
function FlowTree({
  projectId,
  subProjects,
  flows,
  pathname,
  onNavigate,
}: {
  projectId: string
  subProjects: SubProject[]
  flows: BusinessFlow[]
  pathname: string
  onNavigate: () => void
}) {
  if (flows.length === 0 && subProjects.length === 0) return null

  // 領域の親子インデックス（孤児はルート扱い）
  const validSubProjectIds = new Set(subProjects.map((s) => s.id))
  const childSubProjectsByParent = new Map<string | null, SubProject[]>()
  for (const s of subProjects) {
    const parent = s.parentId && validSubProjectIds.has(s.parentId) ? s.parentId : null
    const list = childSubProjectsByParent.get(parent) ?? []
    list.push(s)
    childSubProjectsByParent.set(parent, list)
  }
  const sortSubProjects = (a: SubProject, b: SubProject) =>
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'ja')
  childSubProjectsByParent.forEach((list) => list.sort(sortSubProjects))

  // 領域IDごとのフロー（無効な領域参照は領域なし扱い）
  const flowsBySubProject = new Map<string | null, BusinessFlow[]>()
  for (const flow of flows) {
    const sid =
      flow.subProjectId && validSubProjectIds.has(flow.subProjectId) ? flow.subProjectId : null
    const list = flowsBySubProject.get(sid) ?? []
    list.push(flow)
    flowsBySubProject.set(sid, list)
  }

  const rootSubProjects = childSubProjectsByParent.get(null) ?? []
  const unassignedFlows = flowsBySubProject.get(null) ?? []

  return (
    <div className="mt-1 ml-2 pl-2 border-l border-border space-y-1 max-h-[40vh] overflow-y-auto">
      {/* 領域層（領域 → サブ領域 → ASIS/TOBE → フロー） */}
      {rootSubProjects.map((sp) => (
        <SubProjectNode
          key={sp.id}
          subProject={sp}
          childSubProjectsByParent={childSubProjectsByParent}
          flowsBySubProject={flowsBySubProject}
          projectId={projectId}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}

      {/* 領域未割当のフロー（領域なし） */}
      <UnassignedNode
        flows={unassignedFlows}
        projectId={projectId}
        pathname={pathname}
        onNavigate={onNavigate}
      />
    </div>
  )
}

// ====== 縮小（アイコンのみ）サイドバー用ヘルパー ======

// 縮小時にアイコン下へ表示する短縮ラベル（全名は title 属性で補完）
const COLLAPSED_SHORT_LABELS: Record<string, string> = {
  'ダッシュボード': 'ホーム',
  'INPUT/OUTPUT': 'IN/OUT',
  '業務定義シート': '業務定義',
  'データカタログ': 'カタログ',
  'オブジェクト関係性マップ': 'オブジェクト',
  'ステークホルダーマネジメント': 'ステーク…',
  'リスクマネジメント': 'リスク…',
  '背景・目的': '背景',
  '変更履歴': '履歴',
  'GAP（課題）': 'GAP',
  'ページ別スクリーンショット': 'スクショ',
}

function collapsedLabel(name: string): string {
  const mapped = COLLAPSED_SHORT_LABELS[name]
  if (mapped) return mapped
  // 未登録の長い名前は 5 文字 + … に短縮（全名は title で確認できる）
  return name.length > 6 ? `${name.slice(0, 5)}…` : name
}

// 縮小時のグループ小見出し（2〜3文字程度）
const COLLAPSED_GROUP_LABELS: Record<string, string> = {
  '共通マスタ': 'マスタ',
  '現状把握': '現状',
  '現状システム把握': '現シス',
  '課題・打ち手': '課題',
}

// 縮小時のナビ項目（アイコン＋その下に小さな名前の縦積み）
function CollapsedNavLink({
  item,
  isActive,
  onNavigate,
}: {
  item: { name: string; href: string; icon: LucideIcon }
  isActive: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.name}
      className={cn(
        'w-full flex flex-col items-center gap-0.5 py-2 px-0.5 rounded-lg transition-colors',
        'text-muted-foreground hover:text-foreground hover:bg-secondary',
        isActive && 'text-primary font-medium bg-primary/10'
      )}
    >
      <item.icon className="h-5 w-5 flex-shrink-0" />
      <span className="w-full text-[9px] leading-tight text-center truncate">
        {collapsedLabel(item.name)}
      </span>
    </Link>
  )
}

// 縮小時のグループ区切り（薄い線＋短い小見出し）
function CollapsedGroupDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1 pt-3 pb-1" title={label}>
      <div className="h-px flex-1 bg-border" />
      <span className="text-[9px] font-semibold tracking-wide text-muted-foreground/70 whitespace-nowrap">
        {COLLAPSED_GROUP_LABELS[label] ?? label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

// ====== ナビ項目（ページ内タブを子に持てる）======

// 子（ページ内タブ）。href は親の href + ?tab=<tab>。
type NavChild = { name: string; tab: string }
type NavItem = { name: string; href: string; icon: LucideIcon; children?: NavChild[] }

// 展開サイドバーのナビ項目。
// - children を持たない場合は従来どおり単純な Link。
// - children（ページ内タブ）を持つ場合は、親行（ページ名リンク＋シェブロン）の下に
//   子リンク（?tab=<tab> へ遷移）を折りたためる「メニューダウン」として描画する。
function ProjectNavItem({
  item,
  isActive,
  currentTab,
  onNavigate,
}: {
  item: NavItem
  isActive: boolean
  // 現在の ?tab=（未指定なら null）。親ページがアクティブなときの子ハイライト判定に使う。
  currentTab: string | null
  onNavigate: () => void
}) {
  const hasChildren = !!item.children && item.children.length > 0
  // 親ページがアクティブなら初期展開。
  const [open, setOpen] = useState(isActive)
  // 別ページから遷移してアクティブになったら自動展開（手動で閉じた状態は遷移までは維持）。
  useEffect(() => {
    if (isActive) setOpen(true)
  }, [isActive])

  if (!hasChildren) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn('sidebar-link ml-2', isActive && 'active')}
      >
        <item.icon className="h-5 w-5 flex-shrink-0" />
        <span className="text-sm">{item.name}</span>
        {isActive && <ChevronRight className="h-4 w-4 ml-auto text-primary" />}
      </Link>
    )
  }

  // 既定（先頭）タブ。?tab= 未指定で親がアクティブなときは先頭タブを選択中とみなす。
  const defaultTab = item.children![0].tab
  const activeTab = isActive ? (currentTab ?? defaultTab) : null

  return (
    <div>
      {/* 親行: ページ名はリンク（既定タブへ）、右端シェブロンで子（タブ）の開閉 */}
      <div className={cn('sidebar-link ml-2 pr-1.5', isActive && 'active')}>
        <Link
          href={item.href}
          onClick={onNavigate}
          title={item.name}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          <item.icon className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm truncate">{item.name}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'タブを閉じる' : 'タブを開く'}
          aria-expanded={open}
          className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <div className="ml-6 pl-2 mt-0.5 space-y-0.5 border-l border-border/60">
          {item.children!.map((child) => {
            const childActive = activeTab === child.tab
            return (
              <Link
                key={child.tab}
                href={`${item.href}?tab=${child.tab}`}
                onClick={onNavigate}
                title={child.name}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors',
                  'text-muted-foreground hover:text-foreground hover:bg-secondary',
                  childActive && 'text-primary font-medium bg-primary/10',
                )}
              >
                <span className="truncate">{child.name}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ====== 会議別ドキュメント（サイドメニューにぶら下げるツリー）======

type MeetingLite = { id: string; name: string; order?: number }
type MeetingDocLite = { id: string; meetingId: string; title: string; kind: string }

// 会議 + 会議別ドキュメントを取得（projectId 変更時のみ）。
function useMeetingDocsTree(projectId: string | null) {
  const [meetings, setMeetings] = useState<MeetingLite[]>([])
  const [docs, setDocs] = useState<MeetingDocLite[]>([])

  useEffect(() => {
    if (!projectId) {
      setMeetings([])
      setDocs([])
      return
    }
    let cancelled = false
    const run = async () => {
      try {
        const [mRes, dRes] = await Promise.all([
          fetch(`${API_URL}/api/projects/${projectId}/meetings`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/projects/${projectId}/meeting-documents`, {
            headers: authHeaders(),
          }),
        ])
        if (!cancelled && mRes.ok) {
          const d = await mRes.json()
          setMeetings(Array.isArray(d) ? d : [])
        }
        if (!cancelled && dRes.ok) {
          const d = await dRes.json()
          setDocs(Array.isArray(d) ? d : [])
        }
      } catch (err) {
        console.error('Failed to fetch meeting docs tree:', err)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { meetings, docs }
}

// 1会議ノード（折りたたみ → 配下の会議別ドキュメント）。
function MeetingDocNode({
  meeting,
  docs,
  base,
  onPage,
  currentDoc,
  onNavigate,
}: {
  meeting: MeetingLite
  docs: MeetingDocLite[]
  base: string
  onPage: boolean
  currentDoc: string | null
  onNavigate: () => void
}) {
  const containsActive = onPage && docs.some((d) => d.id === currentDoc)
  const [open, setOpen] = useState(containsActive)

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        title={meeting.name}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <CalendarClock className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
        <span className="truncate">{meeting.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">{docs.length}</span>
      </button>
      {open && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-border/60 pl-3">
          {docs.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-muted-foreground/70">（なし）</div>
          ) : (
            docs.map((d) => {
              const href = `${base}?doc=${d.id}`
              const isActive = onPage && currentDoc === d.id
              return (
                <Link
                  key={d.id}
                  href={href}
                  onClick={onNavigate}
                  title={d.title || '無題のドキュメント'}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    isActive && 'bg-primary/10 font-medium text-primary',
                  )}
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                  <span className="truncate">{d.title || '無題のドキュメント'}</span>
                </Link>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// 会議別ドキュメントのツリー全体（ミーティングドキュメント項目の下にぶら下げる）。
function MeetingDocsTree({
  projectId,
  meetings,
  docs,
  pathname,
  currentDoc,
  onNavigate,
}: {
  projectId: string
  meetings: MeetingLite[]
  docs: MeetingDocLite[]
  pathname: string
  currentDoc: string | null
  onNavigate: () => void
}) {
  if (meetings.length === 0 && docs.length === 0) return null

  const base = `/dashboard/projects/${projectId}/meeting-documents`
  const onPage = pathname === base
  const docsByMeeting = new Map<string, MeetingDocLite[]>()
  for (const d of docs) {
    const arr = docsByMeeting.get(d.meetingId) ?? []
    arr.push(d)
    docsByMeeting.set(d.meetingId, arr)
  }
  docsByMeeting.forEach((arr) =>
    arr.sort((a, b) => a.title.localeCompare(b.title, 'ja')),
  )
  const sorted = [...meetings].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'ja'),
  )

  return (
    <div className="ml-2 space-y-0.5">
      <div className="flex items-center gap-1.5 px-3 pt-1 text-[11px] font-semibold tracking-wide text-gray-400">
        <CalendarClock className="h-3.5 w-3.5 text-primary/70" />
        会議別ドキュメント
      </div>
      <div className="ml-2 mt-1 max-h-[32vh] space-y-1 overflow-y-auto border-l border-border pl-2">
        {sorted.map((m) => (
          <MeetingDocNode
            key={m.id}
            meeting={m}
            docs={docsByMeeting.get(m.id) ?? []}
            base={base}
            onPage={onPage}
            currentDoc={currentDoc}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const projectId = useMemo(() => extractProjectId(pathname), [pathname])
  const projectName = useProjectName(projectId)
  const { subProjects, flows } = useFlowTree(projectId)
  const { meetings: mtgDocsMeetings, docs: mtgDocs } = useMeetingDocsTree(projectId)
  const { isSuperAdmin } = useCurrentUser()

  // プロジェクト非依存のトップナビ（フラット）
  // ガイド（全体マニュアル）はプロジェクトに依存しない汎用マニュアルなので、
  // トップレベル（/dashboard/guide）に置きトップナビへ常設する。
  const baseNav = useMemo(() => {
    const nav = [
      { name: 'ダッシュボード', href: '/dashboard', icon: Home },
      { name: 'ガイド', href: '/dashboard/guide', icon: Compass },
      { name: 'プロジェクト', href: '/dashboard/projects', icon: FolderOpen },
      { name: '取り込みバッチ', href: '/dashboard/batches', icon: Inbox },
    ]

    // 全体管理者のみ「会社管理」を表示
    if (isSuperAdmin) {
      nav.push({ name: '会社管理', href: '/dashboard/companies', icon: Building2 })
    }

    return nav
  }, [isSuperAdmin])

  // プロジェクト依存のナビ（ステージごとにグループ化した構造）
  const projectGroups = useMemo(() => {
    if (!projectId) return []
    const base = `/dashboard/projects/${projectId}`
    return [
      {
        label: '背景・目的',
        items: [
          { name: '背景・目的', href: `${base}/background`, icon: Landmark },
          { name: 'ナレッジ取り込み', href: `${base}/knowledge/ingestion`, icon: FileStack },
          { name: 'ナレッジグラフ', href: `${base}/knowledge/graph`, icon: Brain },
          {
            name: 'ナレッジ一覧編集',
            href: `${base}/knowledge/list`,
            icon: ListTodo,
            children: [
              { name: 'ノード', tab: 'nodes' },
              { name: '文書', tab: 'documents' },
              { name: '関係', tab: 'relations' },
            ],
          },
          { name: 'ナレッジ設定', href: `${base}/knowledge/settings`, icon: Settings },
        ],
      },
      {
        label: '共通マスタ',
        items: [
          { name: '領域', href: `${base}/domains`, icon: Layers },
          { name: 'INPUT/OUTPUT', href: `${base}/io-types`, icon: ArrowLeftRight },
          { name: 'システム', href: `${base}/systems`, icon: Server },
          { name: '制約条件', href: `${base}/constraints`, icon: Lock },
          { name: 'ロール', href: `${base}/roles`, icon: UserCog },
          { name: '会議マスタ', href: `${base}/meetings`, icon: CalendarClock },
          { name: 'ミーティングドキュメント', href: `${base}/meeting-documents`, icon: FileText },
        ],
      },
      {
        label: '課題・打ち手',
        items: [
          { name: '課題ツリー', href: `${base}/issue-trees`, icon: Network },
          {
            name: 'GAP（課題）',
            href: `${base}/gap-items`,
            icon: GitCompare,
            children: [
              { name: 'GAP一覧', tab: 'list' },
              { name: '分析', tab: 'analysis' },
              { name: '課題一覧 / 対応表', tab: 'ledger' },
            ],
          },
        ],
      },
      {
        label: '現状把握',
        items: [
          { name: 'ASIS管理', href: `${base}/asis`, icon: ClipboardList },
          { name: '業務イメージボード', href: `${base}/image-board`, icon: Presentation },
          { name: '業務定義シート', href: `${base}/business-definition`, icon: FileSpreadsheet },
          { name: '業務一覧', href: `${base}/business-list`, icon: ListChecks },
        ],
      },
      {
        label: '現状システム把握',
        items: [
          { name: 'コード連携', href: `${base}/integrations`, icon: Github },
          { name: 'ページ別スクリーンショット', href: `${base}/page-screenshots`, icon: ImageIcon },
          { name: 'DFD', href: `${base}/dfd`, icon: Share2 },
          { name: 'オブジェクト関係性マップ', href: `${base}/object-map`, icon: Boxes },
          { name: 'ER図', href: `${base}/er-diagram`, icon: Table2 },
          { name: 'データカタログ', href: `${base}/catalog`, icon: Database },
        ],
      },
      {
        label: '設計',
        items: [
          { name: 'TOBE管理', href: `${base}/tobe`, icon: Target },
          { name: 'ロードマップ', href: `${base}/roadmap`, icon: MapIcon },
          { name: '要求定義', href: `${base}/requirements`, icon: FileText },
          { name: 'CRUD表', href: `${base}/crud-matrix`, icon: Grid3X3 },
          { name: '俯瞰思考', href: `${base}/overview-matrix`, icon: TableProperties },
          { name: '業務KPI', href: `${base}/business-kpi`, icon: Goal },
          { name: 'AI精度指標', href: `${base}/ai-accuracy`, icon: Gauge },
        ],
      },
      {
        label: '推進',
        items: [
          {
            name: 'ステークホルダーマネジメント',
            href: `${base}/stakeholder-management`,
            icon: Users,
            children: [
              { name: 'ステークホルダー', tab: 'stakeholders' },
              { name: '関心ごと', tab: 'interests' },
              { name: '会議・報告', tab: 'meetings' },
              { name: '導入状況', tab: 'adoption' },
            ],
          },
          { name: 'リスクマネジメント', href: `${base}/risk-management`, icon: ShieldAlert },
          { name: 'タスク管理', href: `${base}/tasks`, icon: ListTodo },
          { name: 'アジャイル', href: `${base}/tasks/agile`, icon: Layers },
          { name: 'WBS/ガント', href: `${base}/tasks/gantt`, icon: GanttChartSquare },
          { name: '変更履歴', href: `${base}/history`, icon: History },
        ],
      },
      {
        label: '設定',
        items: [
          { name: '処理状況', href: `${base}/jobs`, icon: Activity },
          { name: 'AI使用量', href: `${base}/ai-usage`, icon: BarChart3 },
          {
            name: '設定',
            href: `${base}/settings`,
            icon: Settings,
            children: [
              { name: '一般', tab: 'general' },
              { name: 'ロール', tab: 'roles' },
            ],
          },
          { name: 'メンバー権限', href: `${base}/members`, icon: Users },
        ],
      },
    ]
  }, [projectId])

  // アカウント（最下部、フラット）
  const accountNav = useMemo(
    () => [{ name: 'アカウント', href: '/dashboard/settings', icon: Settings }],
    [],
  )

  // アクティブ判定。
  const isLinkActive = (href: string) => {
    const [base, query] = href.split('?')
    const pathMatches =
      pathname === base || (base !== '/dashboard' && pathname.startsWith(base + '/'))
    if (!query) return pathMatches
    // kind クエリ付きはパス一致 + kind 一致で判定
    if (pathname !== base) return false
    const kind = new URLSearchParams(query).get('kind')
    return searchParams.get('kind') === kind
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
              <Database className="h-4 w-4 text-primary" />
            </div>
            <span className="font-mono font-semibold text-foreground">Brain Pro</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-card border-r border-border transform transition-all duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
          sidebarCollapsed ? 'lg:w-20' : 'lg:w-64',
          'w-64'
        )}
      >
        {/* ===== 展開表示（モバイルは常にこちら。lg は非縮小時のみ） ===== */}
        <div className={cn('flex flex-col h-full', sidebarCollapsed && 'lg:hidden')}>
          {/* Logo（プロジェクトを開いている間は左上をプロジェクト名にする） */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <Link
              href={projectId ? `/dashboard/projects/${projectId}` : '/dashboard'}
              title={projectId ? projectName || 'プロジェクト' : 'Brain Pro'}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <div className="w-9 h-9 flex-shrink-0 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-cyan">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <span className="truncate font-mono text-lg font-semibold text-foreground">
                {projectId ? projectName || 'プロジェクト' : 'Brain Pro'}
              </span>
            </Link>
            <button
              onClick={() => setSidebarCollapsed(true)}
              title="メニューを縮小"
              className="ml-1 hidden lg:flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {/* プロジェクト非依存のトップナビ（フラット・ガイド含む） */}
            {baseNav.map((item) => {
              const isActive = isLinkActive(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn('sidebar-link', isActive && 'active')}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm">{item.name}</span>
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto text-primary" />}
                </Link>
              )
            })}

            {/* プロジェクト名は左上ロゴ位置に表示するため、ここでの重複ヘッダーは廃止。
                プロジェクトを開いている間の区切りとして薄い境界線だけ残す。 */}
            {projectId && <div className="pt-2 mb-1 border-t border-border/60" />}

            {/* ステージごとにグループ化したプロジェクトナビ
                （業務フローブラウザは「現状把握」グループ配下に階層表示する。下記参照） */}
            {projectId &&
              projectGroups.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  {/* グループ見出し */}
                  <div className="text-[11px] font-semibold text-gray-400 tracking-wide px-3 pt-3">
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <ProjectNavItem
                      key={item.name}
                      item={item}
                      isActive={isLinkActive(item.href)}
                      currentTab={searchParams.get('tab')}
                      onNavigate={() => setSidebarOpen(false)}
                    />
                  ))}
                  {/* 業務フローブラウザ（領域 → サブ領域 → ASIS/TOBE → フロー）は
                      ASIS/TOBE 業務フローの一覧なので「現状把握」グループ配下に階層表示する。
                      以前はサイドメニュー最上部に浮いていたのをここへ移動。 */}
                  {group.label === '現状把握' && projectId && (
                    <div className="ml-2 space-y-0.5">
                      <div className="flex items-center gap-1.5 px-3 pt-1 text-[11px] font-semibold tracking-wide text-gray-400">
                        <GitBranch className="h-3.5 w-3.5 text-primary/70" />
                        業務フロー
                      </div>
                      <FlowTree
                        projectId={projectId}
                        subProjects={subProjects}
                        flows={flows}
                        pathname={pathname}
                        onNavigate={() => setSidebarOpen(false)}
                      />
                    </div>
                  )}
                  {/* 会議別ドキュメント（ミーティングドキュメント項目の下にぶら下げる）。
                      ミーティングドキュメントは「共通マスタ」グループの最後の項目なので、ここに描画する。 */}
                  {group.label === '共通マスタ' && projectId && (
                    <MeetingDocsTree
                      projectId={projectId}
                      meetings={mtgDocsMeetings}
                      docs={mtgDocs}
                      pathname={pathname}
                      currentDoc={searchParams.get('doc')}
                      onNavigate={() => setSidebarOpen(false)}
                    />
                  )}
                </div>
              ))}

            {/* アカウント（最下部、フラット） */}
            <div className="pt-3 mt-1">
              {accountNav.map((item) => {
                const isActive = isLinkActive(item.href)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={cn('sidebar-link', isActive && 'active')}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm">{item.name}</span>
                    {isActive && <ChevronRight className="h-4 w-4 ml-auto text-primary" />}
                  </Link>
                )
              })}
            </div>

            {/* Hint when no project selected */}
            {!projectId && (
              <div className="pt-6 px-1">
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-start gap-2">
                    <Zap className="h-4 w-4 text-primary mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      プロジェクトを選択すると、データカタログ・業務フロー・ロール管理メニューが表示されます
                    </p>
                  </div>
                </div>
              </div>
            )}
          </nav>

          {/* User section */}
          <div className="px-3 py-4 border-t border-border">
            <button
              onClick={() => {
                localStorage.removeItem('accessToken')
                window.location.href = '/login'
              }}
              className="sidebar-link w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm">ログアウト</span>
            </button>
          </div>
        </div>

        {/* ===== 縮小（アイコンのみ）表示: lg かつ縮小時のみ ===== */}
        <div className={cn('hidden h-full flex-col', sidebarCollapsed && 'lg:flex')}>
          {/* 縮小カラム全体をスクロール（スクロールバーは細く、アイコンに重ねない） */}
          <div className="sidebar-scroll flex-1 min-h-0 overflow-y-auto">
            {/* ヘッダー（ロゴ＋展開トグル）: sticky でアイコン列と重ならない */}
            <div className="sticky top-0 z-10 bg-card border-b border-border flex flex-col items-center gap-1 px-1.5 py-3">
              <Link href="/dashboard" title="ダッシュボード">
                <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-cyan">
                  <Database className="h-5 w-5 text-primary" />
                </div>
              </Link>
              <button
                onClick={() => setSidebarCollapsed(false)}
                title="メニューを展開"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </div>

            {/* アイコン列（アイコン＋その下に名前） */}
            <nav className="px-1.5 py-2 space-y-0.5">
              {/* プロジェクト非依存のトップナビ（ガイド含む） */}
              {baseNav.map((item) => (
                <CollapsedNavLink
                  key={item.name}
                  item={item}
                  isActive={isLinkActive(item.href)}
                  onNavigate={() => setSidebarOpen(false)}
                />
              ))}

              {/* プロジェクト依存ナビ（グループは薄い線＋小見出しで区切る。
                  FlowTree は縮小時は描画しない（領域はグループ内アイコンから辿れる） */}
              {projectId &&
                projectGroups.map((group) => (
                  <div key={group.label}>
                    <CollapsedGroupDivider label={group.label} />
                    <div className="space-y-0.5">
                      {group.items.map((item) => (
                        <CollapsedNavLink
                          key={item.name}
                          item={item}
                          isActive={isLinkActive(item.href)}
                          onNavigate={() => setSidebarOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                ))}

              {/* アカウント（最下部、フラット） */}
              <div className="pt-2 mt-2 border-t border-border space-y-0.5">
                {accountNav.map((item) => (
                  <CollapsedNavLink
                    key={item.name}
                    item={item}
                    isActive={isLinkActive(item.href)}
                    onNavigate={() => setSidebarOpen(false)}
                  />
                ))}
              </div>
            </nav>
          </div>

          {/* ログアウト（最下部固定） */}
          <div className="px-1.5 py-2 border-t border-border">
            <button
              onClick={() => {
                localStorage.removeItem('accessToken')
                window.location.href = '/login'
              }}
              title="ログアウト"
              className="w-full flex flex-col items-center gap-0.5 py-2 px-0.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              <span className="w-full text-[9px] leading-tight text-center truncate">ログアウト</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className={cn(
        "min-h-screen pt-14 lg:pt-0 transition-all duration-200",
        sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
      )}>
        <div className="p-5 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  )
}

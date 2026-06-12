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
  Sparkles,
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
          {flows.map((flow) => {
            const href = `/dashboard/projects/${projectId}/flows/${flow.id}`
            const isActive = pathname === href
            return (
              <Link
                key={flow.id}
                href={href}
                onClick={onNavigate}
                title={flow.name}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
                  'text-muted-foreground hover:text-foreground hover:bg-secondary',
                  isActive && 'text-primary font-medium bg-primary/10'
                )}
              >
                <GitBranch className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                <span className="truncate">{flow.name}</span>
              </Link>
            )
          })}
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
  const { isSuperAdmin } = useCurrentUser()

  // ガイド（全体マニュアル＋背景・目的）。プロジェクト選択時のみ・サイドメニュー最上部に表示
  const guideNav = useMemo(() => {
    if (!projectId) return []
    return [
      { name: 'ガイド', href: `/dashboard/projects/${projectId}/guide`, icon: Compass },
      { name: '背景・目的', href: `/dashboard/projects/${projectId}/background`, icon: Landmark },
    ]
  }, [projectId])

  // プロジェクト非依存のトップナビ（フラット）
  const baseNav = useMemo(() => {
    const nav = [
      { name: 'ダッシュボード', href: '/dashboard', icon: Home },
      { name: 'プロジェクト', href: '/dashboard/projects', icon: FolderOpen },
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
        label: '共通マスタ',
        items: [
          { name: '領域', href: `${base}/domains`, icon: Layers },
          { name: 'INPUT/OUTPUT', href: `${base}/io-types`, icon: ArrowLeftRight },
          { name: 'システム', href: `${base}/systems`, icon: Server },
          { name: '制約条件', href: `${base}/constraints`, icon: Lock },
          { name: 'ロール', href: `${base}/roles`, icon: UserCog },
          { name: '会議マスタ', href: `${base}/meetings`, icon: CalendarClock },
        ],
      },
      {
        label: '現状把握',
        items: [
          { name: 'ASIS管理', href: `${base}/asis`, icon: ClipboardList },
          { name: '業務定義シート', href: `${base}/business-definition`, icon: FileSpreadsheet },
        ],
      },
      {
        label: '現状システム把握',
        items: [
          { name: 'コード連携', href: `${base}/integrations`, icon: Github },
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
          { name: 'AI作成', href: `${base}/ai-create`, icon: Sparkles },
        ],
      },
      {
        label: '課題・打ち手',
        items: [
          { name: '課題ツリー', href: `${base}/issue-trees`, icon: Network },
          { name: 'GAP', href: `${base}/gap-items`, icon: GitCompare },
        ],
      },
      {
        label: '推進',
        items: [
          { name: 'ステークホルダーマネジメント', href: `${base}/stakeholder-management`, icon: Users },
          { name: 'リスクマネジメント', href: `${base}/risk-management`, icon: ShieldAlert },
          { name: 'タスク管理', href: `${base}/tasks`, icon: ListTodo },
          { name: 'WBS/ガント', href: `${base}/tasks/gantt`, icon: GanttChartSquare },
          { name: '変更履歴', href: `${base}/history`, icon: History },
        ],
      },
      {
        label: '設定',
        items: [
          { name: '設定', href: `${base}/settings`, icon: Settings },
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
          {/* Logo */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <Link href="/dashboard" className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-cyan">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <span className="font-mono text-lg font-semibold text-foreground">Brain Pro</span>
            </Link>
            <button
              onClick={() => setSidebarCollapsed(true)}
              title="メニューを縮小"
              className="hidden lg:flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {/* ガイド（全体マニュアル）: 最上部 */}
            {guideNav.map((item) => {
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

            {/* プロジェクト非依存のトップナビ（フラット） */}
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

            {/* プロジェクト名ヘッダー */}
            {projectId && (
              <div className="pt-4 pb-2 px-1">
                <div className="section-title text-xs">
                  <FolderOpen className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate">{projectName || 'プロジェクト'}</span>
                </div>
              </div>
            )}

            {/* 業務フローブラウザ（プロジェクト → サブプロジェクト → ASIS/TOBE → フロー） */}
            {projectId && (
              <div className="space-y-0.5">
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

            {/* ステージごとにグループ化したプロジェクトナビ */}
            {projectId &&
              projectGroups.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  {/* グループ見出し */}
                  <div className="text-[11px] font-semibold text-gray-400 tracking-wide px-3 pt-3">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const isActive = isLinkActive(item.href)
                    return (
                      <div key={item.name}>
                        <Link
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          className={cn('sidebar-link ml-2', isActive && 'active')}
                        >
                          <item.icon className="h-5 w-5 flex-shrink-0" />
                          <span className="text-sm">{item.name}</span>
                          {isActive && <ChevronRight className="h-4 w-4 ml-auto text-primary" />}
                        </Link>
                      </div>
                    )
                  })}
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
              {/* ガイド（全体マニュアル）: 最上部 */}
              {guideNav.map((item) => (
                <CollapsedNavLink
                  key={item.name}
                  item={item}
                  isActive={isLinkActive(item.href)}
                  onNavigate={() => setSidebarOpen(false)}
                />
              ))}

              {/* プロジェクト非依存のトップナビ */}
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

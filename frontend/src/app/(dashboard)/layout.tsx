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
  History,
  ArrowLeftRight,
  Server,
  Lock,
  Compass,
  Boxes,
  Table2,
  TableProperties,
  BarChart3,
  Goal,
  Gauge,
  Activity,
  ListChecks,
  Image as ImageIcon,
  Search,
  Loader2,
  SlidersHorizontal,
  Star,
  Kanban,
  type LucideIcon,
} from 'lucide-react'
import { useState, useMemo, useEffect, useRef } from 'react'
import { CompanySwitcher } from '@/components/company/CompanySwitcher'
import { meetingDocumentApi, type GoogleTabs } from '@/lib/meeting-documents'
import {
  buildKnowledgeNavigation,
  type ProjectNavigationItem,
} from '@/lib/knowledge-navigation'
import {
  SidebarFavoritesContext,
  useSidebarFavorites,
  useSidebarFavoritesState,
  visibleFavorites,
  type SidebarFavorite,
} from '@/lib/sidebar-favorites'

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
          'flex items-center gap-1 pr-1 rounded-md transition-colors group',
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
        <FavoriteStar item={{ href, name: flow.name, kind: 'flow' }} />
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

// ====== サイドメニューお気に入り（ユーザー単位） ======

// お気に入り行が指す先の最新情報（名前・アイコン）。href で引く。
type FavoriteTarget = { name: string; icon: LucideIcon }

// kind ごとのフォールバックアイコン（対象がナビ定義・取得済み一覧から引けないとき用）。
function favoriteFallbackIcon(kind: SidebarFavorite['kind']): LucideIcon {
  if (kind === 'flow') return GitBranch
  return FileText
}

// 各行に出す星トグル。行側に `group` クラスを付けると、未登録時はホバーでのみ表示される。
function FavoriteStar({ item }: { item: SidebarFavorite }) {
  const { isFavorite, toggleFavorite, loaded } = useSidebarFavorites()
  if (!loaded) return null
  const active = isFavorite(item.href)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleFavorite(item)
      }}
      title={active ? 'お気に入りから外す' : 'お気に入りに追加'}
      aria-pressed={active}
      className={cn(
        'p-0.5 rounded flex-shrink-0 transition-colors',
        active
          ? 'text-amber-400 hover:text-amber-500'
          : 'text-muted-foreground/60 hover:text-amber-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <Star className={cn('h-3.5 w-3.5', active && 'fill-current')} />
    </button>
  )
}

// お気に入りセクション（展開サイドバー最上部）。
// 開いているプロジェクトのお気に入り＋プロジェクト非依存項目だけを表示する。
function FavoritesSection({
  projectId,
  targetsByHref,
  isFavActive,
  onNavigate,
}: {
  projectId: string | null
  targetsByHref: Map<string, FavoriteTarget>
  isFavActive: (href: string) => boolean
  onNavigate: () => void
}) {
  const { favorites, loaded } = useSidebarFavorites()
  const visible = visibleFavorites(favorites, projectId)
  if (!loaded || visible.length === 0) return null

  return (
    <div className="pb-2 mb-1 border-b border-border/60 space-y-0.5">
      <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-semibold tracking-wide text-gray-400">
        <Star className="h-3.5 w-3.5 text-amber-400 fill-current" />
        お気に入り
      </div>
      {visible.map((f) => {
        const target = targetsByHref.get(f.href)
        const Icon = target?.icon ?? favoriteFallbackIcon(f.kind)
        const name = target?.name ?? f.name
        return (
          <div
            key={f.href}
            className={cn('sidebar-link group pr-1.5', isFavActive(f.href) && 'active')}
          >
            <Link
              href={f.href}
              onClick={onNavigate}
              title={name}
              className="flex items-center gap-3 flex-1 min-w-0"
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm truncate">{name}</span>
            </Link>
            <FavoriteStar item={f} />
          </div>
        )
      })}
    </div>
  )
}

// 縮小表示のお気に入り（最上部にアイコンで並べ、下を線で区切る）。
function CollapsedFavorites({
  projectId,
  targetsByHref,
  isFavActive,
  onNavigate,
}: {
  projectId: string | null
  targetsByHref: Map<string, FavoriteTarget>
  isFavActive: (href: string) => boolean
  onNavigate: () => void
}) {
  const { favorites, loaded } = useSidebarFavorites()
  const visible = visibleFavorites(favorites, projectId)
  if (!loaded || visible.length === 0) return null

  return (
    <div>
      <div className="space-y-0.5">
        {visible.map((f) => {
          const target = targetsByHref.get(f.href)
          return (
            <CollapsedNavLink
              key={f.href}
              item={{
                name: target?.name ?? f.name,
                href: f.href,
                icon: target?.icon ?? favoriteFallbackIcon(f.kind),
              }}
              isActive={isFavActive(f.href)}
              onNavigate={onNavigate}
            />
          )
        })}
      </div>
      <div className="h-px bg-border my-1.5" />
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
  'ナレッジ': '知識',
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
type NavItem = ProjectNavigationItem

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
      <div className={cn('sidebar-link ml-2 pr-1.5 group', isActive && 'active')}>
        <Link
          href={item.href}
          onClick={onNavigate}
          title={item.name}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          <item.icon className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm truncate">{item.name}</span>
        </Link>
        <FavoriteStar item={{ href: item.href, name: item.name, kind: 'page' }} />
        {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
      </div>
    )
  }

  // 既定（先頭）タブ。?tab= 未指定で親がアクティブなときは先頭タブを選択中とみなす。
  const defaultTab = item.children![0].tab
  const activeTab = isActive ? (currentTab ?? defaultTab) : null

  return (
    <div>
      {/* 親行: ページ名はリンク（既定タブへ）、右端シェブロンで子（タブ）の開閉 */}
      <div className={cn('sidebar-link ml-2 pr-1.5 group', isActive && 'active')}>
        <Link
          href={item.href}
          onClick={onNavigate}
          title={item.name}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          <item.icon className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm truncate">{item.name}</span>
        </Link>
        <FavoriteStar item={{ href: item.href, name: item.name, kind: 'page' }} />
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
type MeetingDocLite = {
  id: string
  meetingId: string
  title: string
  kind: string
  // GOOGLE_DOC のとき：Google 側のタブ構成キャッシュ（Docsのタブ / Sheetsのシート）。
  googleTabs?: GoogleTabs | null
}

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
    void run()
    // ドキュメントの作成・削除・改名時に meeting-documents ページが 'meeting-docs-changed' を
    // 発火する。ダッシュボードレイアウトは画面遷移で再マウントされないため、これを購読して
    // サイドバーのツリー（Google ドキュメント含む）を即時更新する。
    const onChanged = () => {
      void run()
    }
    window.addEventListener('meeting-docs-changed', onChanged)
    return () => {
      cancelled = true
      window.removeEventListener('meeting-docs-changed', onChanged)
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
  currentGtab,
  onNavigate,
}: {
  meeting: MeetingLite
  docs: MeetingDocLite[]
  base: string
  onPage: boolean
  currentDoc: string | null
  currentGtab: string | null
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
            docs.map((d) => (
              <MeetingDocLeaf
                key={d.id}
                doc={d}
                base={base}
                isActive={onPage && currentDoc === d.id}
                currentGtab={onPage && currentDoc === d.id ? currentGtab : null}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// 1ドキュメント行。GOOGLE_DOC は Google 側のタブ（Docsのタブ / Sheetsのシート）を
// 第3階層としてぶら下げる（?doc=<id>&gtab=<tabId|gid> で該当タブを開く）。
function MeetingDocLeaf({
  doc,
  base,
  isActive,
  currentGtab,
  onNavigate,
}: {
  doc: MeetingDocLite
  base: string
  isActive: boolean
  currentGtab: string | null
  onNavigate: () => void
}) {
  const isGoogle = doc.kind === 'GOOGLE_DOC'
  const [open, setOpen] = useState(isActive)
  // キャッシュ未取得のドキュメントを展開したときの遅延取得結果（一覧の再取得を待たず即表示する）。
  const [fetched, setFetched] = useState<GoogleTabs | null>(null)
  const [loading, setLoading] = useState(false)
  const failedRef = useRef(false)
  // 多重取得ガードは ref で行う。state の loading を effect 依存に入れると
  // setLoading(true) 自身が前回 effect の cleanup（cancelled=true）を走らせ、
  // 取得結果が捨てられてスピナーが止まらなくなる。
  const inFlightRef = useRef(false)
  // 一覧（'meeting-docs-changed' で再取得される）を優先し、遅延取得の結果はその繋ぎに使う。
  const tabs = doc.googleTabs ?? fetched

  // 選択中ドキュメントはタブを自動展開（サイドメニューから今開いている場所を辿れるように）。
  useEffect(() => {
    if (isActive) setOpen(true)
  }, [isActive])

  // 展開時にキャッシュが無ければ一度だけ Google から取得（失敗してもリトライループしない）。
  useEffect(() => {
    if (!isGoogle || !open || tabs || inFlightRef.current || failedRef.current) return
    let cancelled = false
    inFlightRef.current = true
    setLoading(true)
    meetingDocumentApi
      .refreshGoogleTabs(doc.id)
      .then((updated) => {
        if (!cancelled) setFetched(updated.googleTabs ?? { kind: 'other', tabs: [] })
      })
      .catch(() => {
        // 未連携・共有漏れ等。サイドメニューでは黙って畳む（ページ側で案内される）。
        failedRef.current = true
        if (!cancelled) setFetched({ kind: 'other', tabs: [] })
      })
      .finally(() => {
        inFlightRef.current = false
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isGoogle, open, tabs, doc.id])

  const hasTabs = isGoogle && !!tabs && tabs.kind !== 'other' && tabs.tabs.length > 0
  // キャッシュ取得前でも Google ドキュメントには展開ボタンを出す（開いた時に取得）。
  const showChevron = isGoogle && (hasTabs || !tabs)

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md pr-1 transition-colors group',
          'text-muted-foreground hover:bg-secondary hover:text-foreground',
          isActive && 'bg-primary/10 font-medium text-primary',
        )}
      >
        <Link
          href={`${base}?doc=${doc.id}`}
          onClick={onNavigate}
          title={doc.title || '無題のドキュメント'}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs"
        >
          {isGoogle ? (
            <span
              className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm bg-blue-100 text-[8px] font-bold leading-none text-blue-600"
              title="Google ドキュメント"
            >
              G
            </span>
          ) : (
            <FileText className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
          )}
          <span className="truncate">{doc.title || '無題のドキュメント'}</span>
        </Link>
        <FavoriteStar
          item={{
            href: `${base}?doc=${doc.id}`,
            name: doc.title || '無題のドキュメント',
            kind: 'meetingDoc',
          }}
        />
        {showChevron && (
          <button
            onClick={() => setOpen((v) => !v)}
            title={open ? 'タブを閉じる' : 'タブを表示'}
            className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
      {open && hasTabs && (
        <GoogleTabList
          docId={doc.id}
          base={base}
          googleTabs={tabs}
          currentGtab={currentGtab}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}

// タブが多いとき（シート数の多いスプレッドシート等）に検索ボックスを出す閾値。
const GOOGLE_TAB_SEARCH_MIN = 6

// Google タブの一覧（第3階層）。クリックで ?doc=&gtab= を開く。多数なら名前で絞り込み可能。
function GoogleTabList({
  docId,
  base,
  googleTabs,
  currentGtab,
  onNavigate,
}: {
  docId: string
  base: string
  googleTabs: GoogleTabs
  currentGtab: string | null
  onNavigate: () => void
}) {
  const [query, setQuery] = useState('')
  const sorted = useMemo(
    () => [...googleTabs.tabs].sort((a, b) => a.index - b.index),
    [googleTabs.tabs],
  )
  const q = query.trim().toLowerCase()
  const filtered = q ? sorted.filter((t) => t.title.toLowerCase().includes(q)) : sorted
  const isSheet = googleTabs.kind === 'spreadsheet'

  return (
    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/60 pl-1.5">
      {sorted.length >= GOOGLE_TAB_SEARCH_MIN && (
        <div className="flex items-center gap-1 px-1 py-0.5">
          <Search className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isSheet ? 'シートを検索' : 'タブを検索'}
            className="w-full min-w-0 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground/70">
          （該当するタブがありません）
        </div>
      ) : (
        filtered.map((t) => {
          const tabActive = currentGtab === t.id
          return (
            <Link
              key={t.id}
              href={`${base}?doc=${docId}&gtab=${encodeURIComponent(t.id)}`}
              onClick={onNavigate}
              title={t.title || '（無題のタブ）'}
              // Docs のタブは入れ子（level）に応じてインデント。
              style={{ paddingLeft: `${8 + t.level * 12}px` }}
              className={cn(
                'block truncate rounded-md py-1 pr-2 text-[11px] transition-colors',
                'text-muted-foreground hover:bg-secondary hover:text-foreground',
                tabActive && 'bg-primary/10 font-medium text-primary',
              )}
            >
              {t.title || '（無題のタブ）'}
            </Link>
          )
        })
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
  currentGtab,
  onNavigate,
}: {
  projectId: string
  meetings: MeetingLite[]
  docs: MeetingDocLite[]
  pathname: string
  currentDoc: string | null
  currentGtab: string | null
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
            currentGtab={currentGtab}
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
  // お気に入り（ユーザー単位・UserSetting.settings に保存）。context で各行の星へ配る。
  const favoritesState = useSidebarFavoritesState()

  // プロジェクト非依存のトップナビ（フラット）
  // ガイド（全体マニュアル）はプロジェクトに依存しない汎用マニュアルなので、
  // トップレベル（/dashboard/guide）に置きトップナビへ常設する。
  const baseNav = useMemo(() => {
    const nav = [
      { name: 'ダッシュボード', href: '/dashboard', icon: Home },
      { name: 'ガイド', href: '/dashboard/guide', icon: Compass },
      { name: '会社', href: '/dashboard/organizations', icon: Building2 },
      { name: 'プロジェクト', href: '/dashboard/projects', icon: FolderOpen },
      { name: '取り込みバッチ', href: '/dashboard/batches', icon: Inbox },
    ]

    // すべての管理者のみ「会社管理（全社）」を表示
    if (isSuperAdmin) {
      nav.push({ name: '会社管理', href: '/dashboard/companies', icon: Building2 })
    }

    return nav
  }, [isSuperAdmin])

  // プロジェクト依存のナビ（ステージごとにグループ化した構造）
  const projectGroups = useMemo(() => {
    if (!projectId) return []
    const base = `/dashboard/projects/${projectId}`
    const knowledgeNavigation = buildKnowledgeNavigation(projectId)
    return [
      knowledgeNavigation.background,
      knowledgeNavigation.knowledge,
      {
        label: '共通マスタ',
        items: [
          { name: '領域', href: `${base}/domains`, icon: Layers },
          { name: 'INPUT/OUTPUT', href: `${base}/io-types`, icon: ArrowLeftRight },
          { name: 'システム', href: `${base}/systems`, icon: Server },
          { name: '制約条件', href: `${base}/constraints`, icon: Lock },
          { name: 'ロール', href: `${base}/roles`, icon: UserCog },
          { name: '会議マスタ', href: `${base}/meetings`, icon: CalendarClock },
          { name: '実会議（議事録）', href: `${base}/meeting-occurrences`, icon: FileText },
          { name: 'ミーティングドキュメント', href: `${base}/meeting-documents`, icon: FileText },
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
          { name: '看板', href: `${base}/tasks?view=board`, icon: Kanban },
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
          { name: 'プロンプト設定', href: `${base}/rag/settings`, icon: SlidersHorizontal },
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
    // クエリ付き（?kind= / ?view= 等）はパス一致 + href 側の全クエリ一致で判定
    if (pathname !== base) return false
    let matches = true
    new URLSearchParams(query).forEach((v, k) => {
      if (searchParams.get(k) !== v) matches = false
    })
    return matches
  }

  // お気に入り行のアクティブ判定（?doc= 等の任意クエリ付き href に対応）。
  const isFavActive = (href: string) => {
    const [base, query] = href.split('?')
    if (!query) return isLinkActive(href)
    if (pathname !== base) return false
    let matches = true
    new URLSearchParams(query).forEach((v, k) => {
      if (searchParams.get(k) !== v) matches = false
    })
    return matches
  }

  // お気に入り行の表示用に、現在把握している遷移先（ナビ項目・フロー・会議ドキュメント）を
  // href で引けるようにしておく。登録後に対象の名前が変わっても最新名・アイコンで表示するため。
  const favoriteTargetsByHref = useMemo(() => {
    const map = new Map<string, { name: string; icon: LucideIcon }>()
    for (const item of baseNav) map.set(item.href, { name: item.name, icon: item.icon })
    for (const item of accountNav) map.set(item.href, { name: item.name, icon: item.icon })
    for (const group of projectGroups) {
      for (const item of group.items) map.set(item.href, { name: item.name, icon: item.icon })
    }
    if (projectId) {
      for (const f of flows) {
        map.set(`/dashboard/projects/${projectId}/flows/${f.id}`, {
          name: f.name,
          icon: GitBranch,
        })
      }
      const docBase = `/dashboard/projects/${projectId}/meeting-documents`
      for (const d of mtgDocs) {
        map.set(`${docBase}?doc=${d.id}`, {
          name: d.title || '無題のドキュメント',
          icon: FileText,
        })
      }
    }
    return map
  }, [baseNav, accountNav, projectGroups, projectId, flows, mtgDocs])

  return (
    <SidebarFavoritesContext.Provider value={favoritesState}>
    <div className="min-h-screen bg-background">
      {/* Mobile header（safe-area: ノッチ分を上に足す） */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border px-4 pb-3 pt-[calc(0.75rem+var(--safe-top))]">
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
          // safe-area: ドロワー内の先頭・末尾がノッチ／ホームバーに隠れないようにする
          'pt-[var(--safe-top)] pb-[var(--safe-bottom)]',
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
          <CompanySwitcher />

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {/* お気に入り（ユーザー単位・最上部）。開いているプロジェクト＋共通項目のみ */}
            <FavoritesSection
              projectId={projectId}
              targetsByHref={favoriteTargetsByHref}
              isFavActive={isFavActive}
              onNavigate={() => setSidebarOpen(false)}
            />

            {/* プロジェクト非依存のトップナビ（フラット・ガイド含む） */}
            {baseNav.map((item) => {
              const isActive = isLinkActive(item.href)
              return (
                <div
                  key={item.name}
                  className={cn('sidebar-link group pr-1.5', isActive && 'active')}
                >
                  <Link
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    title={item.name}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm truncate">{item.name}</span>
                  </Link>
                  <FavoriteStar item={{ href: item.href, name: item.name, kind: 'page' }} />
                  {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
                </div>
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
                      currentGtab={searchParams.get('gtab')}
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
                  <div
                    key={item.name}
                    className={cn('sidebar-link group pr-1.5', isActive && 'active')}
                  >
                    <Link
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      title={item.name}
                      className="flex items-center gap-3 flex-1 min-w-0"
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                      <span className="text-sm truncate">{item.name}</span>
                    </Link>
                    <FavoriteStar item={{ href: item.href, name: item.name, kind: 'page' }} />
                    {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
                  </div>
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
              {/* お気に入り（最上部） */}
              <CollapsedFavorites
                projectId={projectId}
                targetsByHref={favoriteTargetsByHref}
                isFavActive={isFavActive}
                onNavigate={() => setSidebarOpen(false)}
              />

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

      {/* Main content（モバイルはヘッダー高 3.5rem + ノッチ分だけ下げる） */}
      <main className={cn(
        "min-h-screen pt-[calc(3.5rem+var(--safe-top))] lg:pt-0 transition-all duration-200",
        sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
      )}>
        <div className="p-5 sm:p-6 lg:p-8 pb-[calc(1.25rem+var(--safe-bottom))]">{children}</div>
      </main>
    </div>
    </SidebarFavoritesContext.Provider>
  )
}

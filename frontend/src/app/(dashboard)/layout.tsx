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
  GitCompare,
  Folder,
  Layers,
  Github,
  Building2,
  UserCog,
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
type SubProject = {
  id: string
  name: string
  order?: number
}

type BusinessFlow = {
  id: string
  name: string
  kind: 'ASIS' | 'TOBE'
  subProjectId?: string | null
  folderId?: string | null
}

type FlowFolder = {
  id: string
  parentId?: string | null
  name: string
  order?: number
}

// サブプロジェクト・フォルダ・フローを取得するhook（projectId変更時のみ）
function useFlowTree(projectId: string | null) {
  const [subProjects, setSubProjects] = useState<SubProject[]>([])
  const [flows, setFlows] = useState<BusinessFlow[]>([])
  const [folders, setFolders] = useState<FlowFolder[]>([])

  useEffect(() => {
    if (!projectId) {
      setSubProjects([])
      setFlows([])
      setFolders([])
      return
    }

    let cancelled = false

    const fetchTree = async () => {
      try {
        const [subRes, flowRes, folderRes] = await Promise.all([
          fetch(`${API_URL}/api/projects/${projectId}/sub-projects`, {
            headers: authHeaders(),
          }),
          fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
            headers: authHeaders(),
          }),
          fetch(`${API_URL}/api/projects/${projectId}/flow-folders`, {
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
        if (!cancelled && folderRes.ok) {
          const folderData = await folderRes.json()
          setFolders(Array.isArray(folderData) ? folderData : [])
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

  return { subProjects, flows, folders }
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

// サブプロジェクトノード（展開可能）
function SubProjectNode({
  label,
  icon: Icon,
  flows,
  projectId,
  pathname,
  onNavigate,
  defaultOpen,
}: {
  label: string
  icon: typeof Folder
  flows: BusinessFlow[]
  projectId: string
  pathname: string
  onNavigate: () => void
  defaultOpen?: boolean
}) {
  // このサブプロジェクト内に現在開いているフローがあれば初期展開
  const containsActive = flows.some(
    (f) => pathname === `/dashboard/projects/${projectId}/flows/${f.id}`
  )
  const [open, setOpen] = useState(defaultOpen ?? containsActive)

  if (flows.length === 0) return null

  const asisFlows = flows.filter((f) => f.kind === 'ASIS')
  const tobeFlows = flows.filter((f) => f.kind === 'TOBE')

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        title={label}
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
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
        <span className="truncate">{label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">{flows.length}</span>
      </button>
      {open && (
        <div className="pl-3 mt-0.5 space-y-0.5">
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

// サブプロジェクト → ASIS/TOBE → フロー の構造（フォルダ内 / フォルダ無しで再利用）
function SubProjectTree({
  subProjects,
  flows,
  projectId,
  pathname,
  onNavigate,
}: {
  subProjects: SubProject[]
  flows: BusinessFlow[]
  projectId: string
  pathname: string
  onNavigate: () => void
}) {
  const unassignedFlows = flows.filter((f) => !f.subProjectId)

  return (
    <>
      {subProjects.map((sp) => {
        const spFlows = flows.filter((f) => f.subProjectId === sp.id)
        if (spFlows.length === 0) return null
        return (
          <SubProjectNode
            key={sp.id}
            label={sp.name}
            icon={Folder}
            flows={spFlows}
            projectId={projectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        )
      })}
      {unassignedFlows.length > 0 && (
        <SubProjectNode
          label="(未分類)"
          icon={Layers}
          flows={unassignedFlows}
          projectId={projectId}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      )}
    </>
  )
}

// フォルダノード（入れ子フォルダ → 配下の SubProject/ASIS-TOBE 構造）
function FolderTreeNode({
  folder,
  childFoldersByParent,
  flowsByFolder,
  subProjects,
  projectId,
  pathname,
  onNavigate,
}: {
  folder: FlowFolder
  childFoldersByParent: Map<string | null, FlowFolder[]>
  flowsByFolder: Map<string | null, BusinessFlow[]>
  subProjects: SubProject[]
  projectId: string
  pathname: string
  onNavigate: () => void
}) {
  const childFolders = childFoldersByParent.get(folder.id) ?? []
  const folderFlows = flowsByFolder.get(folder.id) ?? []

  // 配下（自フォルダ + 子孫フォルダ）に現在開いているフローがあれば初期展開
  const containsActive = useMemo(() => {
    const matches = (flows: BusinessFlow[]) =>
      flows.some((f) => pathname === `/dashboard/projects/${projectId}/flows/${f.id}`)
    if (matches(folderFlows)) return true
    const stack = [...childFolders]
    while (stack.length) {
      const c = stack.pop()!
      if (matches(flowsByFolder.get(c.id) ?? [])) return true
      stack.push(...(childFoldersByParent.get(c.id) ?? []))
    }
    return false
  }, [folderFlows, childFolders, childFoldersByParent, flowsByFolder, pathname, projectId])

  const [open, setOpen] = useState(containsActive)

  // フローも子フォルダも無い空フォルダは表示しない
  if (childFolders.length === 0 && folderFlows.length === 0) return null

  const totalCount = (() => {
    let n = folderFlows.length
    const stack = [...childFolders]
    while (stack.length) {
      const c = stack.pop()!
      n += (flowsByFolder.get(c.id) ?? []).length
      stack.push(...(childFoldersByParent.get(c.id) ?? []))
    }
    return n
  })()

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        title={folder.name}
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
        <Folder className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
        <span className="truncate">{folder.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">{totalCount}</span>
      </button>
      {open && (
        <div className="pl-3 mt-0.5 space-y-0.5 border-l border-border/60 ml-2">
          {/* 子フォルダ（入れ子） */}
          {childFolders.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              childFoldersByParent={childFoldersByParent}
              flowsByFolder={flowsByFolder}
              subProjects={subProjects}
              projectId={projectId}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
          {/* このフォルダ直下のフロー（SubProject/ASIS-TOBE 構造） */}
          <SubProjectTree
            subProjects={subProjects}
            flows={folderFlows}
            projectId={projectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  )
}

// 業務フローツリー全体（フォルダ層 → SubProject/ASIS-TOBE 層）
function FlowTree({
  projectId,
  subProjects,
  flows,
  folders,
  pathname,
  onNavigate,
}: {
  projectId: string
  subProjects: SubProject[]
  flows: BusinessFlow[]
  folders: FlowFolder[]
  pathname: string
  onNavigate: () => void
}) {
  if (flows.length === 0 && subProjects.length === 0 && folders.length === 0) return null

  // フォルダの親子インデックス（孤児はルート扱い）
  const validFolderIds = new Set(folders.map((f) => f.id))
  const childFoldersByParent = new Map<string | null, FlowFolder[]>()
  for (const f of folders) {
    const parent = f.parentId && validFolderIds.has(f.parentId) ? f.parentId : null
    const list = childFoldersByParent.get(parent) ?? []
    list.push(f)
    childFoldersByParent.set(parent, list)
  }
  const sortFolders = (a: FlowFolder, b: FlowFolder) =>
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'ja')
  childFoldersByParent.forEach((list) => list.sort(sortFolders))

  // フォルダIDごとのフロー（無効フォルダ参照は未分類扱い）
  const flowsByFolder = new Map<string | null, BusinessFlow[]>()
  for (const flow of flows) {
    const fid = flow.folderId && validFolderIds.has(flow.folderId) ? flow.folderId : null
    const list = flowsByFolder.get(fid) ?? []
    list.push(flow)
    flowsByFolder.set(fid, list)
  }

  const rootFolders = childFoldersByParent.get(null) ?? []
  const unfolderedFlows = flowsByFolder.get(null) ?? []

  return (
    <div className="mt-1 ml-2 pl-2 border-l border-border space-y-1 max-h-[40vh] overflow-y-auto">
      {/* フォルダ層 */}
      {rootFolders.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          childFoldersByParent={childFoldersByParent}
          flowsByFolder={flowsByFolder}
          subProjects={subProjects}
          projectId={projectId}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}

      {/* フォルダ未割当のフロー（既存の SubProject/ASIS-TOBE 構造をそのまま維持） */}
      <SubProjectTree
        subProjects={subProjects}
        flows={unfolderedFlows}
        projectId={projectId}
        pathname={pathname}
        onNavigate={onNavigate}
      />
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
  const { subProjects, flows, folders } = useFlowTree(projectId)
  const { isSuperAdmin } = useCurrentUser()

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
        label: '現状把握',
        items: [
          { name: '業務フロー(ASIS)', href: `${base}/flows?kind=asis`, icon: GitBranch },
          { name: 'データカタログ', href: `${base}/catalog`, icon: Database },
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
        label: '設計',
        items: [
          { name: '業務フロー(TOBE)', href: `${base}/flows?kind=tobe`, icon: GitBranch },
          { name: '要求定義', href: `${base}/requirements`, icon: FileText },
          { name: 'CRUD表', href: `${base}/crud-matrix`, icon: Grid3X3 },
        ],
      },
      {
        label: '推進',
        items: [
          { name: 'ステークホルダーマネジメント', href: `${base}/stakeholder-management`, icon: Users },
          { name: 'コード連携', href: `${base}/integrations`, icon: Github },
        ],
      },
      {
        label: '設定',
        items: [
          { name: 'ロール', href: `${base}/roles`, icon: UserCog },
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

  // 業務フローツリーを差し込む対象の href（ASIS エントリの下に展開）
  const asisFlowsHref = projectId ? `/dashboard/projects/${projectId}/flows?kind=asis` : null

  // アクティブ判定。/flows を共有する ASIS/TOBE は kind クエリで区別する。
  const isLinkActive = (href: string) => {
    const [base, query] = href.split('?')
    const pathMatches =
      pathname === base || (base !== '/dashboard' && pathname.startsWith(base + '/'))
    if (!query) return pathMatches
    // kind クエリ付き（ASIS/TOBE フロー）はパス一致 + kind 一致で判定
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
            <span className="font-mono font-semibold text-foreground">DataFlow</span>
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
          sidebarCollapsed ? 'lg:w-16' : 'lg:w-64',
          'w-64'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <Link
              href="/dashboard"
              className={cn("flex items-center gap-3", sidebarCollapsed && "lg:hidden")}
            >
              <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-cyan">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <span className="font-mono text-lg font-semibold text-foreground">DataFlow</span>
            </Link>
            {sidebarCollapsed && (
              <Link href="/dashboard" className="hidden lg:flex items-center justify-center w-full">
                <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-cyan">
                  <Database className="h-5 w-5 text-primary" />
                </div>
              </Link>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={cn(
                "hidden lg:flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors",
                sidebarCollapsed && "w-full justify-center mt-2"
              )}
            >
              {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {/* プロジェクト非依存のトップナビ（フラット） */}
            {baseNav.map((item) => {
              const isActive = isLinkActive(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  title={sidebarCollapsed ? item.name : undefined}
                  className={cn(
                    'sidebar-link',
                    isActive && 'active',
                    sidebarCollapsed && 'lg:justify-center lg:px-2'
                  )}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span className={cn('text-sm', sidebarCollapsed && 'lg:hidden')}>{item.name}</span>
                  {isActive && !sidebarCollapsed && (
                    <ChevronRight className="h-4 w-4 ml-auto text-primary" />
                  )}
                </Link>
              )
            })}

            {/* プロジェクト名ヘッダー */}
            {projectId && !sidebarCollapsed && (
              <div className="pt-4 pb-2 px-1">
                <div className="section-title text-xs">
                  <FolderOpen className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate">{projectName || 'プロジェクト'}</span>
                </div>
              </div>
            )}
            {projectId && sidebarCollapsed && (
              <div className="hidden lg:block py-2">
                <div className="border-t border-border" />
              </div>
            )}

            {/* ステージごとにグループ化したプロジェクトナビ */}
            {projectId &&
              projectGroups.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  {/* グループ見出し */}
                  {!sidebarCollapsed && (
                    <div className="text-[11px] font-semibold text-gray-400 tracking-wide px-3 pt-3">
                      {group.label}
                    </div>
                  )}
                  {group.items.map((item) => {
                    const isActive = isLinkActive(item.href)
                    const isAsisFlows = !!asisFlowsHref && item.href === asisFlowsHref
                    return (
                      <div key={item.name}>
                        <Link
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          title={sidebarCollapsed ? item.name : undefined}
                          className={cn(
                            'sidebar-link',
                            isActive && 'active',
                            !sidebarCollapsed && 'ml-2',
                            sidebarCollapsed && 'lg:justify-center lg:px-2'
                          )}
                        >
                          <item.icon className="h-5 w-5 flex-shrink-0" />
                          <span className={cn('text-sm', sidebarCollapsed && 'lg:hidden')}>
                            {item.name}
                          </span>
                          {isActive && !sidebarCollapsed && (
                            <ChevronRight className="h-4 w-4 ml-auto text-primary" />
                          )}
                        </Link>

                        {/* 業務フロー展開ツリー（サブプロジェクト → ASIS/TOBE → フロー） */}
                        {isAsisFlows && !sidebarCollapsed && projectId && (
                          <FlowTree
                            projectId={projectId}
                            subProjects={subProjects}
                            flows={flows}
                            folders={folders}
                            pathname={pathname}
                            onNavigate={() => setSidebarOpen(false)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}

            {/* アカウント（最下部、フラット） */}
            <div className={cn('pt-3', !sidebarCollapsed && 'mt-1')}>
              {accountNav.map((item) => {
                const isActive = isLinkActive(item.href)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    title={sidebarCollapsed ? item.name : undefined}
                    className={cn(
                      'sidebar-link',
                      isActive && 'active',
                      sidebarCollapsed && 'lg:justify-center lg:px-2'
                    )}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className={cn('text-sm', sidebarCollapsed && 'lg:hidden')}>{item.name}</span>
                    {isActive && !sidebarCollapsed && (
                      <ChevronRight className="h-4 w-4 ml-auto text-primary" />
                    )}
                  </Link>
                )
              })}
            </div>

            {/* Hint when no project selected */}
            {!projectId && !sidebarCollapsed && (
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
              title={sidebarCollapsed ? 'ログアウト' : undefined}
              className={cn(
                "sidebar-link w-full text-red-400 hover:text-red-300 hover:bg-red-500/10",
                sidebarCollapsed ? 'lg:justify-center lg:px-2' : 'justify-start'
              )}
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              <span className={cn("text-sm", sidebarCollapsed && 'lg:hidden')}>ログアウト</span>
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
        sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'
      )}>
        <div className="p-5 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  )
}

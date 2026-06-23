'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  FolderOpen,
  Plus,
  ArrowRight,
  Loader2,
  Database,
  GitBranch,
  Users,
  Clock,
  Zap,
  Activity,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { HowToPanel } from '@/components/ui/how-to-panel'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

type Organization = {
  id: string
  name: string
  slug: string
}

type Project = {
  id: string
  name: string
  description?: string
  organizationId: string
  // 旧 API レスポンスには含まれないことがあるため optional にして欠損を許容する
  createdAt?: string
  updatedAt?: string
}

/** 日付文字列を epoch ms に変換（欠損・不正値は 0 = 最古扱い） */
const toTime = (dateString: string | undefined): number => {
  if (!dateString) return 0
  const t = new Date(dateString).getTime()
  return Number.isNaN(t) ? 0 : t
}

export default function DashboardPage() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [howToOpen, setHowToOpen] = useState(false)

  // キーボードショートカット
  // - mod+Enter / n : 新規プロジェクト画面へ
  // - shift+/（?）   : 操作方法ダイアログを開く
  useKeyboardShortcuts([
    { combo: 'mod+enter', handler: () => router.push('/dashboard/projects') },
    { combo: 'n', handler: () => router.push('/dashboard/projects') },
    { combo: 'shift+/', handler: () => setHowToOpen(true) },
  ])

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    return headers
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const headers = getHeaders()
        
        const orgsRes = await fetch(`${API_URL}/api/organizations`, { headers })
        if (orgsRes.ok) {
          const orgsData = await orgsRes.json()
          setOrganizations(orgsData)
          
          const allProjects: Project[] = []
          for (const org of orgsData) {
            const projRes = await fetch(`${API_URL}/api/organizations/${org.id}/projects`, { headers })
            if (projRes.ok) {
              const projData = await projRes.json()
              allProjects.push(...projData)
            }
          }
          allProjects.sort((a, b) => toTime(b.updatedAt) - toTime(a.updatedAt))
          setProjects(allProjects)
        }
      } catch (err) {
        console.error('Failed to fetch data:', err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [getHeaders])

  // 欠損・不正な日付は「-」を返す（Invalid Date を表示しない）
  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground font-mono">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="ダッシュボード"
        description="プロジェクトを選択して作業を開始"
        help="プロジェクト単位で、データカタログ・業務フロー・ロール・フェーズ（Ph.0〜7）をまとめて管理します。"
        actions={
          <>
            <HowToPanel
              open={howToOpen}
              onOpenChange={setHowToOpen}
              steps={[
                'まず「新規プロジェクト」からプロジェクトを作成します（または既存プロジェクトを選択）。',
                'プロジェクトを開いたら、ロール（人・システム）を登録します。',
                '業務フローを BPMN スタイルで描き、現状（ASIS）とあるべき姿（TOBE）を可視化します。',
                'データカタログ（テーブル・カラム）を整備し、業務フローと紐付けます。',
              ]}
              shortcuts={[
                { keys: '⌘/Ctrl+Enter', desc: '新規プロジェクト画面へ' },
                { keys: 'n', desc: '新規プロジェクト画面へ' },
                { keys: '?', desc: 'この操作方法を開く' },
              ]}
            />
            <Link href="/dashboard/projects">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                新規プロジェクト
              </Button>
            </Link>
          </>
        }
      />

      {/* Empty state */}
      {projects.length === 0 ? (
        <div className="blueprint-card p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              brain-pro へようこそ
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              まずはプロジェクトを作成しましょう。プロジェクト内でデータカタログ、業務フロー、ロールを管理できます。
            </p>
            <Link href="/dashboard/projects">
              <Button size="lg">
                <FolderOpen className="h-5 w-5 mr-2" />
                プロジェクトを作成
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { 
                label: 'プロジェクト数', 
                value: projects.length, 
                sub: '作成済みのプロジェクト',
                icon: FolderOpen,
                color: 'cyan'
              },
              { 
                label: '組織数', 
                value: organizations.length, 
                sub: '所属している組織',
                icon: Users,
                color: 'purple'
              },
              { 
                label: '最終更新', 
                value: projects[0]?.name || '-', 
                sub: projects[0] ? formatDate(projects[0].updatedAt) : '-',
                icon: Activity,
                color: 'emerald',
                isText: true
              },
            ].map((stat, i) => (
              <div 
                key={i} 
                className="blueprint-card p-5 animate-slide-up"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                      {stat.label}
                    </p>
                    <p className={`${stat.isText ? 'text-lg' : 'text-3xl'} font-bold text-foreground`}>
                      {stat.value}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    stat.color === 'cyan' ? 'bg-cyan-500/10 text-cyan-400' :
                    stat.color === 'purple' ? 'bg-purple-500/10 text-purple-400' :
                    'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    <stat.icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Two column layout */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent Projects */}
            <div className="blueprint-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-foreground flex items-center gap-1.5">
                      最近のプロジェクト
                      <HelpTooltip text="最終更新日時が新しい順に表示されます。クリックするとそのプロジェクトの作業画面へ移動します。" />
                    </h2>
                    <p className="text-sm text-muted-foreground">プロジェクトを選択して作業を開始</p>
                  </div>
                  <span className="tech-label">{projects.length} 件</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {projects.slice(0, 5).map((project, i) => (
                  <Link 
                    key={project.id} 
                    href={`/dashboard/projects/${project.id}`}
                    className="flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors group animate-slide-up"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        <FolderOpen className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {project.name}
                        </p>
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {project.description || '説明なし'}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </Link>
                ))}
              </div>
              {projects.length > 5 && (
                <div className="px-6 py-3 border-t border-border">
                  <Link 
                    href="/dashboard/projects" 
                    className="text-sm text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                  >
                    すべてのプロジェクトを表示
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </div>

            {/* Quick Guide */}
            <div className="blueprint-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="font-semibold text-foreground flex items-center gap-1.5">
                  クイックガイド
                  <HelpTooltip text="プロジェクト作成 → ロール定義 → 業務フロー作成 → データカタログ整備、の順で進めるのがおすすめです。" />
                </h2>
                <p className="text-sm text-muted-foreground">Brain Proの使い方</p>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { 
                    step: 1, 
                    title: 'プロジェクトを選択', 
                    desc: '左のリストからプロジェクトを選ぶか、新規作成します',
                    active: true
                  },
                  { 
                    step: 2, 
                    title: 'ロールを定義', 
                    desc: '業務を担当する人・システムを登録します',
                    active: false
                  },
                  { 
                    step: 3, 
                    title: '業務フローを作成', 
                    desc: 'BPMNスタイルで業務プロセスを可視化します',
                    active: false
                  },
                  { 
                    step: 4, 
                    title: 'データカタログを整備', 
                    desc: 'テーブルとカラムを登録し、業務フローと紐付けます',
                    active: false
                  },
                ].map((item, i) => (
                  <div 
                    key={i}
                    className={`flex items-start gap-4 p-4 rounded-lg transition-colors animate-slide-up ${
                      item.active 
                        ? 'bg-primary/10 border border-primary/30' 
                        : 'bg-secondary/30 border border-transparent hover:border-border'
                    }`}
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm flex-shrink-0 ${
                      item.active 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {item.step}
                    </div>
                    <div>
                      <p className={`font-medium ${item.active ? 'text-primary' : 'text-foreground'}`}>
                        {item.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

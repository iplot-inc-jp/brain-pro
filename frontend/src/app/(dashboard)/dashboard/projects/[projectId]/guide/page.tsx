'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import {
  MANUAL_ENTRIES,
  getManualEntry,
  type ManualEntry,
} from '@/components/manual/manual-content'
import {
  Compass,
  BookOpen,
  ChevronDown,
  Layers,
  UserCog,
  Server,
  ArrowLeftRight,
  Lock,
  ClipboardList,
  FileSpreadsheet,
  Share2,
  Database,
  Target,
  GitBranch,
  GitCompare,
  Network,
  ListTodo,
  GanttChartSquare,
  Map as MapIcon,
  CalendarClock,
  ScrollText,
  History,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'

/**
 * ガイド（全体マニュアル）ページ。
 * ツール全体の流れ（ASIS → TOBE → GAP → 課題ツリー → タスク）を
 * SVG のフロー図と各ステップの説明 + 機能ページへのリンクで案内する。
 */

// ===== パイプライン図（SVG）の定義 =====
// 色は既存テーマのトークン（--navy / --brand-blue / --border / --muted-foreground）と、
// サイドバーの ASIS=amber / TOBE=emerald の慣例色を使う。
const PIPELINE_STAGES: {
  step: string
  label: string
  sub: string
  color: string
}[] = [
  { step: 'STEP 1', label: '現状把握', sub: 'ASIS', color: '#d97706' },
  { step: 'STEP 2', label: 'あるべき姿', sub: 'TOBE', color: '#059669' },
  { step: 'STEP 3', label: 'GAP抽出', sub: 'TOBE − ASIS', color: 'hsl(var(--brand-blue))' },
  { step: 'STEP 4', label: '課題ツリー', sub: '原因 → 打ち手', color: '#7c3aed' },
  { step: 'STEP 5', label: 'タスク・推進', sub: '実行 / WBS', color: 'hsl(var(--navy))' },
]

const BOX_W = 150
const BOX_H = 60
const BOX_GAP = 42
const BOX_Y = 22
const DIAGRAM_W = PIPELINE_STAGES.length * BOX_W + (PIPELINE_STAGES.length - 1) * BOX_GAP + 16
const DIAGRAM_H = BOX_Y + BOX_H + 10

// 全体の流れを示す横方向のフロー図（viewBox 付き SVG・レスポンシブ）
function PipelineDiagram() {
  return (
    <svg
      viewBox={`0 0 ${DIAGRAM_W} ${DIAGRAM_H}`}
      className="w-full h-auto min-w-[720px]"
      role="img"
      aria-label="全体の流れ: 現状把握(ASIS) → あるべき姿(TOBE) → GAP抽出 → 課題ツリー → タスク・推進"
    >
      <defs>
        <marker
          id="guide-flow-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
        </marker>
      </defs>

      {PIPELINE_STAGES.map((stage, i) => {
        const x = 8 + i * (BOX_W + BOX_GAP)
        const cx = x + BOX_W / 2
        return (
          <g key={stage.step}>
            {/* ステップ番号 */}
            <text
              x={cx}
              y={14}
              textAnchor="middle"
              fontSize={10}
              letterSpacing={1}
              fontWeight={600}
              fill="hsl(var(--muted-foreground))"
            >
              {stage.step}
            </text>

            {/* ステージ枠 */}
            <rect
              x={x}
              y={BOX_Y}
              width={BOX_W}
              height={BOX_H}
              rx={8}
              fill="hsl(var(--card))"
              stroke={stage.color}
              strokeWidth={1.5}
            />

            {/* ステージ名 */}
            <text
              x={cx}
              y={BOX_Y + 26}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fill="hsl(var(--navy))"
            >
              {stage.label}
            </text>

            {/* サブラベル */}
            <text
              x={cx}
              y={BOX_Y + 46}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill={stage.color}
            >
              {stage.sub}
            </text>

            {/* 次ステージへの矢印 */}
            {i < PIPELINE_STAGES.length - 1 && (
              <line
                x1={x + BOX_W + 4}
                y1={BOX_Y + BOX_H / 2}
                x2={x + BOX_W + BOX_GAP - 6}
                y2={BOX_Y + BOX_H / 2}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1.5}
                markerEnd="url(#guide-flow-arrow)"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ===== 各ステップの説明 + 機能ページへのリンク =====
type GuideLink = {
  name: string
  href: string
  description: string
  icon: LucideIcon
}

type GuideSection = {
  badge: string
  title: string
  accent: string
  summary: string
  links: GuideLink[]
  /** このステップに対応する操作マニュアル（MANUAL_ENTRIES のキー） */
  manualKeys: string[]
}

function buildSections(base: string): GuideSection[] {
  return [
    {
      badge: '準備',
      title: '共通マスタを整える',
      accent: 'hsl(var(--navy))',
      summary:
        'はじめに、フローや成果物の土台になる共通マスタ（領域・ロール・システム・INPUT/OUTPUT・制約条件・会議マスタ）を登録します。あとから追加・修正もできます。',
      links: [
        {
          name: '領域',
          href: `${base}/domains`,
          description: '業務領域（サブ領域）を整理し、フローや成果物を分類します',
          icon: Layers,
        },
        {
          name: 'ロール',
          href: `${base}/roles`,
          description: '業務フローの担当（スイムレーン）になるロールを登録します',
          icon: UserCog,
        },
        {
          name: 'システム',
          href: `${base}/systems`,
          description: '業務で使っているシステム・ツールを登録します',
          icon: Server,
        },
        {
          name: 'INPUT/OUTPUT',
          href: `${base}/io-types`,
          description: '帳票・データなど業務の入出力の種類を整理します',
          icon: ArrowLeftRight,
        },
        {
          name: '制約条件',
          href: `${base}/constraints`,
          description: '法令・社内ルールなど設計の前提となる制約を記録します',
          icon: Lock,
        },
        {
          name: '会議マスタ',
          href: `${base}/meetings`,
          description: '定例・レビューなどの会議体（形式・所要・主催・対象）を整理します',
          icon: CalendarClock,
        },
      ],
      manualKeys: ['domains', 'roles', 'systems', 'io-types', 'constraints', 'meetings'],
    },
    {
      badge: 'STEP 1',
      title: '現状把握（ASIS）',
      accent: '#d97706',
      summary:
        '現状の業務を業務フロー（ASIS）として書き起こし、業務定義・データの流れ・データの中身を整理して「いまどうなっているか」を見える化します。',
      links: [
        {
          name: 'ASIS管理',
          href: `${base}/asis`,
          description: '現状の業務フロー（ASIS）を作成・管理します',
          icon: ClipboardList,
        },
        {
          name: '業務定義シート',
          href: `${base}/business-definition`,
          description: '業務の定義・手順・担当を一覧で整理します',
          icon: FileSpreadsheet,
        },
        {
          name: 'DFD',
          href: `${base}/dfd`,
          description: 'データの流れ（データフロー図）を俯瞰します',
          icon: Share2,
        },
        {
          name: 'データカタログ',
          href: `${base}/catalog`,
          description: 'テーブル・データ項目を整理し、データの中身を把握します',
          icon: Database,
        },
      ],
      manualKeys: ['asis-tobe', 'flows', 'business-definition', 'dfd', 'catalog'],
    },
    {
      badge: 'STEP 2',
      title: 'あるべき姿（TOBE）',
      accent: '#059669',
      summary:
        '制約条件を踏まえて「あるべき業務フロー（TOBE）」を設計します。ASIS と並べて比較すると、差分が見つけやすくなります。',
      links: [
        {
          name: 'TOBE管理',
          href: `${base}/tobe`,
          description: 'あるべき業務フロー（TOBE）を設計・管理します',
          icon: Target,
        },
        {
          name: 'ASIS/TOBE比較',
          href: `${base}/flows/compare`,
          description: 'ASIS と TOBE のフローを並べて比較します',
          icon: GitBranch,
        },
      ],
      manualKeys: ['asis-tobe', 'flows'],
    },
    {
      badge: 'STEP 3',
      title: 'GAPを抽出する',
      accent: 'hsl(var(--brand-blue))',
      summary:
        'GAP は「TOBE − ASIS」の差分です。あるべき姿に対して現状に足りないことを GAP として登録し、課題の出発点にします。',
      links: [
        {
          name: 'GAP',
          href: `${base}/gap-items`,
          description: 'TOBE − ASIS の差分（GAP）を登録・管理します',
          icon: GitCompare,
        },
      ],
      manualKeys: ['gap-items'],
    },
    {
      badge: 'STEP 4',
      title: '課題ツリーで構造化する',
      accent: '#7c3aed',
      summary:
        'GAP を起点に「なぜ」を繰り返して原因を究明し（検証 ○×△）、確かめられた原因に打ち手（採用/保留/不採用）をぶら下げて整理します。',
      links: [
        {
          name: '課題ツリー',
          href: `${base}/issue-trees`,
          description: 'GAP を起点に原因を究明し、打ち手をツリーで整理します',
          icon: Network,
        },
      ],
      manualKeys: ['issue-trees'],
    },
    {
      badge: 'STEP 5',
      title: 'タスクに落として推進する',
      accent: 'hsl(var(--navy))',
      summary:
        '採用した打ち手をタスクに落とし、ガントチャートとロードマップでスケジュール・段取りを管理しながら実行します。',
      links: [
        {
          name: 'タスク管理',
          href: `${base}/tasks`,
          description: '打ち手をタスクに落として実行管理します',
          icon: ListTodo,
        },
        {
          name: 'WBS/ガント',
          href: `${base}/tasks/gantt`,
          description: 'ガントチャートでスケジュールと依存関係を管理します',
          icon: GanttChartSquare,
        },
        {
          name: 'ロードマップ',
          href: `${base}/roadmap`,
          description: '中期の段取り（ロードマップ）を描いて合意します',
          icon: MapIcon,
        },
      ],
      manualKeys: ['tasks', 'tasks-gantt', 'roadmap'],
    },
    {
      badge: 'PMBOK',
      title: 'プロジェクトを統制する',
      accent: '#0f766e',
      summary:
        '背景・目的で立ち上げの合意を1枚にまとめ、プロジェクト内の作成・更新・削除は変更履歴に自動で記録されます。',
      links: [
        {
          name: '背景・目的',
          href: `${base}/background`,
          description: '背景・目的・成功基準を言語化し、関連資料を添付します',
          icon: ScrollText,
        },
        {
          name: '変更履歴',
          href: `${base}/history`,
          description: '「いつ・誰が・何を」変更したかの自動記録を確認します',
          icon: History,
        },
      ],
      manualKeys: ['charter', 'history'],
    },
  ]
}

// ===== 操作マニュアルの埋め込み（manual-content の内容をアコーディオンで表示） =====

// マニュアル1件分の本文（目的 → 簡易図解 → すぐ下に操作手順）
function ManualEntryBlock({
  entry,
  showTitle = true,
}: {
  entry: ManualEntry
  showTitle?: boolean
}) {
  return (
    <div className="space-y-3">
      {showTitle && <h4 className="text-sm font-semibold text-foreground">{entry.title}</h4>}
      <p className="text-xs leading-relaxed text-muted-foreground">{entry.purpose}</p>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-2">
        <entry.Illustration />
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/80">
        {entry.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

// 各ステップ用「操作方法を見る」折りたたみ。
// manual-content から該当キーのマニュアルを引いて、図解→操作手順の順で埋め込む。
function ManualAccordion({ entryKeys }: { entryKeys: string[] }) {
  const entries = entryKeys
    .map((key) => getManualEntry(key))
    .filter((e): e is ManualEntry => Boolean(e))
  if (entries.length === 0) return null

  return (
    <details className="blueprint-card group/manual">
      <summary className="flex cursor-pointer select-none items-center gap-2 p-4 text-sm font-semibold text-foreground list-none [&::-webkit-details-marker]:hidden">
        <BookOpen className="h-4 w-4 flex-shrink-0 text-primary" />
        <span className="flex-shrink-0">操作方法を見る</span>
        <span className="truncate text-xs font-normal text-muted-foreground">
          {entries.map((e) => e.title).join(' / ')}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open/manual:rotate-180" />
      </summary>
      <div className="space-y-6 border-t border-border p-4">
        {entries.map((entry) => (
          <ManualEntryBlock key={entry.key} entry={entry} />
        ))}
      </div>
    </details>
  )
}

// ページ末尾の「全画面の操作マニュアル一覧」アコーディオン（全セクション）。
// 開くと機能ごとのアコーディオンが並び、個別に開閉できる。
function AllManualsAccordion() {
  const entries = Object.values(MANUAL_ENTRIES)

  return (
    <details className="blueprint-card group/all">
      <summary className="flex cursor-pointer select-none items-center gap-2 p-5 list-none [&::-webkit-details-marker]:hidden">
        <BookOpen className="h-5 w-5 flex-shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">全画面の操作マニュアル一覧</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            全機能（{entries.length}件）の目的・画面イメージ（簡易図解）・操作手順をまとめて確認できます。
          </p>
        </div>
        <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open/all:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border p-4">
        {entries.map((entry) => (
          <details
            key={entry.key}
            className="group/entry rounded-md border border-border bg-card"
          >
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground list-none [&::-webkit-details-marker]:hidden">
              <span className="truncate">{entry.title}</span>
              <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open/entry:rotate-180" />
            </summary>
            <div className="border-t border-border p-3">
              <ManualEntryBlock entry={entry} showTitle={false} />
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

// 機能ページへのリンクカード
function GuideLinkCard({ link }: { link: GuideLink }) {
  return (
    <Link
      href={link.href}
      className="blueprint-card group flex items-start gap-3 p-4 transition-colors hover:border-ring/40"
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5">
        <link.icon className="h-[18px] w-[18px] text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
          <span className="truncate">{link.name}</span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{link.description}</p>
      </div>
    </Link>
  )
}

export default function GuidePage() {
  const params = useParams()
  const projectId = params.projectId as string
  const base = `/dashboard/projects/${projectId}`
  const sections = buildSections(base)

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Compass className="h-5 w-5" style={{ color: '#2563eb' }} />
            ガイド
          </span>
        }
        description="このツールの全体の流れ（ASIS → TOBE → GAP → 課題ツリー → タスク）と、各ステップで使う機能を案内します。"
        backHref={base}
        backLabel="プロジェクトへ戻る"
      />

      {/* 全体の流れ（SVG フロー図） */}
      <div className="blueprint-card p-5">
        <h2 className="text-sm font-semibold text-foreground">全体の流れ</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          現状（ASIS）とあるべき姿（TOBE）を業務フローで見える化し、その差分を GAP
          として抽出。課題ツリーで原因と打ち手を構造化し、タスクに落として推進します。
        </p>
        <div className="mt-4 overflow-x-auto pb-1">
          <PipelineDiagram />
        </div>
      </div>

      {/* 各ステップの説明 + 機能リンク */}
      {sections.map((section) => (
        <section key={section.badge} className="space-y-3">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex flex-shrink-0 items-center rounded px-2 py-0.5 text-xs font-semibold tracking-wide text-white"
              style={{ backgroundColor: section.accent }}
            >
              {section.badge}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground">{section.title}</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                {section.summary}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.links.map((link) => (
              <GuideLinkCard key={link.href} link={link} />
            ))}
          </div>
          {/* このステップの操作マニュアル（図解→操作説明）を折りたたみで埋め込み */}
          <ManualAccordion entryKeys={section.manualKeys} />
        </section>
      ))}

      {/* 全画面の操作マニュアル一覧（全セクション） */}
      <AllManualsAccordion />
    </div>
  )
}

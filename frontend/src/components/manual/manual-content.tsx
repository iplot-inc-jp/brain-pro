'use client'

import * as React from 'react'

/**
 * 機能ごとの簡易マニュアル登録レジストリ。
 * 各エントリは「目的・操作手順・スクショ風の簡易図解(SVG)」を持つ。
 *
 * iplot テーマ:
 *  - navy   #050f3e (見出し/枠線の濃い線)
 *  - blue   #2563eb (アクセント/矢印/強調)
 *  - 背景は白基調。図解は pixel-perfect ではなく schematic な「簡易図解」。
 */

// ---- iplot カラー定数（図解で共用）------------------------------------------
const NAVY = '#050f3e'
const BLUE = '#2563eb'
const BLUE_SOFT = '#dbeafe'
const GRAY_LINE = '#cbd5e1'
const GRAY_FILL = '#f1f5f9'
const TEXT = '#1e293b'

export type ManualIllustration = React.FC

export interface ManualEntry {
  /** レジストリのキー（= 機能のページ名と一致） */
  key: string
  /** 機能名（日本語タイトル） */
  title: string
  /** この機能の目的（1〜2行） */
  purpose: string
  /** 具体的な操作手順（4〜8ステップ） */
  steps: string[]
  /** その画面に似せた簡易 SVG 図解を描く React コンポーネント */
  Illustration: ManualIllustration
}

// ---- 図解で使う小さなヘルパー ------------------------------------------------
function SvgFrame({
  children,
  viewBox = '0 0 320 180',
  label,
}: {
  children: React.ReactNode
  viewBox?: string
  label: string
}) {
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      className="w-full h-auto rounded-md border border-slate-200 bg-white"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id="manual-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={BLUE} />
        </marker>
      </defs>
      {children}
    </svg>
  )
}

function Box({
  x,
  y,
  w,
  h,
  text,
  fill = '#ffffff',
  stroke = NAVY,
  textFill = TEXT,
  rx = 4,
  fontSize = 9,
}: {
  x: number
  y: number
  w: number
  h: number
  text: string
  fill?: string
  stroke?: string
  textFill?: string
  rx?: number
  fontSize?: number
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} stroke={stroke} strokeWidth={1.4} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        fill={textFill}
        fontSize={fontSize}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  )
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={BLUE}
      strokeWidth={1.6}
      markerEnd="url(#manual-arrow)"
    />
  )
}

// ---- 各機能の図解 ------------------------------------------------------------

const FlowsIllustration: ManualIllustration = () => (
  <SvgFrame label="スイムレーンの業務フロー図解">
    {/* レーン見出し */}
    <rect x={6} y={10} width={48} height={70} fill={NAVY} rx={3} />
    <text x={30} y={45} fill="#fff" fontSize={9} textAnchor="middle" dominantBaseline="central">
      担当A
    </text>
    <rect x={6} y={88} width={48} height={70} fill={BLUE} rx={3} />
    <text x={30} y={123} fill="#fff" fontSize={9} textAnchor="middle" dominantBaseline="central">
      担当B
    </text>
    {/* レーン領域 */}
    <rect x={54} y={10} width={260} height={70} fill={GRAY_FILL} stroke={GRAY_LINE} />
    <rect x={54} y={88} width={260} height={70} fill="#ffffff" stroke={GRAY_LINE} />
    {/* 処理ノード */}
    <Box x={80} y={28} w={70} h={34} text="受付" fill={BLUE_SOFT} />
    <Box x={210} y={106} w={70} h={34} text="承認" fill={BLUE_SOFT} />
    {/* 接続矢印（4辺の接続点をイメージ） */}
    <Arrow x1={150} y1={45} x2={245} y2={106} />
    <circle cx={150} cy={45} r={2.4} fill={BLUE} />
    <circle cx={115} cy={62} r={2.4} fill={BLUE} />
  </SvgFrame>
)

const IssueTreesIllustration: ManualIllustration = () => (
  <SvgFrame label="課題ツリー（問い→なぜ→打ち手）の図解">
    <Box x={110} y={12} w={100} h={30} text="GAP(問い)" fill={NAVY} stroke={NAVY} textFill="#fff" />
    <Box x={36} y={74} w={90} h={28} text="なぜ:原因1" fill={BLUE_SOFT} />
    <Box x={196} y={74} w={90} h={28} text="なぜ:原因2" fill={BLUE_SOFT} />
    <Box x={36} y={134} w={90} h={28} text="打ち手A" fill="#fff" stroke={BLUE} />
    <Box x={196} y={134} w={90} h={28} text="打ち手B" fill="#fff" stroke={BLUE} />
    <Arrow x1={150} y1={42} x2={90} y2={74} />
    <Arrow x1={170} y1={42} x2={232} y2={74} />
    <Arrow x1={81} y1={102} x2={81} y2={134} />
    <Arrow x1={241} y1={102} x2={241} y2={134} />
  </SvgFrame>
)

const GapItemsIllustration: ManualIllustration = () => (
  <SvgFrame label="ASIS と TOBE の差分（GAP）図解">
    <Box x={14} y={62} w={86} h={52} text="ASIS" fill={GRAY_FILL} />
    <Box x={220} y={62} w={86} h={52} text="TOBE" fill={BLUE_SOFT} stroke={BLUE} />
    <Box x={118} y={70} w={84} h={36} text="差分=GAP" fill="#fff" stroke={BLUE} textFill={BLUE} />
    <Arrow x1={100} y1={88} x2={118} y2={88} />
    <Arrow x1={202} y1={88} x2={220} y2={88} />
    <text x={57} y={132} fill={TEXT} fontSize={8} textAnchor="middle">
      現状業務
    </text>
    <text x={263} y={132} fill={TEXT} fontSize={8} textAnchor="middle">
      あるべき姿
    </text>
    <rect x={118} y={120} width={84} height={18} rx={3} fill={NAVY} />
    <text x={160} y={129} fill="#fff" fontSize={8} textAnchor="middle" dominantBaseline="central">
      優先度 高
    </text>
  </SvgFrame>
)

const DfdIllustration: ManualIllustration = () => (
  <SvgFrame label="DFD（外部実体→処理→データストア）図解">
    {/* 外部実体 = 四角 */}
    <Box x={14} y={70} w={70} h={40} text="顧客" fill={GRAY_FILL} />
    {/* 処理 = 円 */}
    <circle cx={160} cy={90} r={34} fill={BLUE_SOFT} stroke={BLUE} strokeWidth={1.6} />
    <text x={160} y={86} fill={TEXT} fontSize={9} textAnchor="middle" dominantBaseline="central">
      受注処理
    </text>
    <text x={160} y={98} fill={BLUE} fontSize={8} textAnchor="middle" dominantBaseline="central">
      1-1
    </text>
    {/* データストア = 開いた箱 */}
    <line x1={236} y1={74} x2={306} y2={74} stroke={NAVY} strokeWidth={1.6} />
    <line x1={236} y1={106} x2={306} y2={106} stroke={NAVY} strokeWidth={1.6} />
    <line x1={236} y1={74} x2={236} y2={106} stroke={NAVY} strokeWidth={1.6} />
    <text x={273} y={90} fill={TEXT} fontSize={8.5} textAnchor="middle" dominantBaseline="central">
      受注DB
    </text>
    <Arrow x1={84} y1={90} x2={124} y2={90} />
    <Arrow x1={196} y1={90} x2={234} y2={90} />
  </SvgFrame>
)

const TasksIllustration: ManualIllustration = () => (
  <SvgFrame label="タスク管理のカンバン（3列）図解">
    {(
      [
        ['未着手', GRAY_FILL, NAVY],
        ['進行中', BLUE_SOFT, BLUE],
        ['完了', '#dcfce7', '#16a34a'],
      ] as const
    ).map(([title, fill, head], i) => {
      const x = 12 + i * 102
      return (
        <g key={title}>
          <rect x={x} y={12} width={92} height={156} rx={4} fill={fill} stroke={GRAY_LINE} />
          <rect x={x} y={12} width={92} height={20} rx={4} fill={head} />
          <text x={x + 46} y={22} fill="#fff" fontSize={9} textAnchor="middle" dominantBaseline="central">
            {title}
          </text>
          <rect x={x + 8} y={42} width={76} height={26} rx={3} fill="#fff" stroke={GRAY_LINE} />
          <rect x={x + 8} y={76} width={76} height={26} rx={3} fill="#fff" stroke={GRAY_LINE} />
        </g>
      )
    })}
    <text x={160} y={150} fill={TEXT} fontSize={8} textAnchor="middle">
      ドラッグで列を移動
    </text>
  </SvgFrame>
)

const TasksGanttIllustration: ManualIllustration = () => (
  <SvgFrame label="WBS/ガントチャートのバーと依存矢印の図解">
    {/* 日付目盛り */}
    <line x1={70} y1={26} x2={310} y2={26} stroke={GRAY_LINE} />
    {[0, 1, 2, 3, 4].map((i) => (
      <text key={i} x={86 + i * 48} y={20} fill={TEXT} fontSize={7} textAnchor="middle">
        {`D${i + 1}`}
      </text>
    ))}
    {/* 行ラベル */}
    <text x={10} y={60} fill={TEXT} fontSize={8}>
      設計
    </text>
    <text x={10} y={104} fill={TEXT} fontSize={8}>
      実装
    </text>
    {/* バー1 */}
    <rect x={74} y={50} width={110} height={18} rx={4} fill={BLUE} />
    <rect x={74} y={50} width={66} height={18} rx={4} fill={NAVY} />
    {/* バー2 */}
    <rect x={150} y={94} width={130} height={18} rx={4} fill={BLUE} />
    {/* 依存矢印 */}
    <path
      d="M184 59 L196 59 L196 94"
      fill="none"
      stroke={NAVY}
      strokeWidth={1.4}
      markerEnd="url(#manual-arrow)"
    />
    <text x={196} y={140} fill={TEXT} fontSize={7.5} textAnchor="middle">
      端をドラッグで日数調整
    </text>
  </SvgFrame>
)

const CrudMatrixIllustration: ManualIllustration = () => (
  <SvgFrame label="CRUD表（ロール×機能）の行列図解">
    {/* ヘッダ行 */}
    <rect x={70} y={14} width={234} height={20} fill={NAVY} />
    {['作成', '参照', '更新', '削除'].map((h, i) => (
      <text
        key={h}
        x={88 + i * 58}
        y={24}
        fill="#fff"
        fontSize={8}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {h}
      </text>
    ))}
    {/* 行 */}
    {['受注', '出荷', '請求'].map((row, r) => {
      const y = 34 + r * 38
      return (
        <g key={row}>
          <rect x={14} y={y} width={56} height={38} fill={GRAY_FILL} stroke={GRAY_LINE} />
          <text x={42} y={y + 19} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
            {row}
          </text>
          {['C', 'R', 'U', 'D'].map((c, i) => {
            const filled = (r + i) % 2 === 0
            return (
              <g key={c}>
                <rect x={70 + i * 58} y={y} width={58} height={38} fill="#fff" stroke={GRAY_LINE} />
                <text
                  x={99 + i * 58}
                  y={y + 19}
                  fill={filled ? BLUE : '#cbd5e1'}
                  fontSize={9}
                  fontWeight={filled ? 700 : 400}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {c}
                </text>
              </g>
            )
          })}
        </g>
      )
    })}
  </SvgFrame>
)

const StakeholderIllustration: ManualIllustration = () => (
  <SvgFrame label="ステークホルダーの3x3マトリクス図解">
    {/* 軸ラベル */}
    <text x={160} y={172} fill={NAVY} fontSize={8} textAnchor="middle">
      支持度 →
    </text>
    <text x={10} y={90} fill={NAVY} fontSize={8} textAnchor="middle" transform="rotate(-90 10 90)">
      影響度 →
    </text>
    {/* 3x3 グリッド */}
    {[0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => (
        <rect
          key={`${r}-${c}`}
          x={30 + c * 90}
          y={14 + r * 48}
          width={90}
          height={48}
          fill={r === 0 && c === 2 ? BLUE_SOFT : '#fff'}
          stroke={GRAY_LINE}
        />
      ))
    )}
    {/* 配置カード */}
    <rect x={232} y={22} width={52} height={24} rx={4} fill={BLUE} />
    <text x={258} y={34} fill="#fff" fontSize={7.5} textAnchor="middle" dominantBaseline="central">
      役員
    </text>
    <rect x={52} y={118} width={52} height={24} rx={4} fill={NAVY} />
    <text x={78} y={130} fill="#fff" fontSize={7.5} textAnchor="middle" dominantBaseline="central">
      現場
    </text>
  </SvgFrame>
)

const RiskIllustration: ManualIllustration = () => (
  <SvgFrame label="リスク管理表（確率×影響度×優先度）の図解">
    <rect x={12} y={14} width={296} height={20} fill={NAVY} />
    {['リスク', '確率', '影響', '優先'].map((h, i) => (
      <text
        key={h}
        x={[60, 150, 210, 272][i]}
        y={24}
        fill="#fff"
        fontSize={8}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {h}
      </text>
    ))}
    {[
      ['納期遅延', '高', '大', BLUE],
      ['要件漏れ', '中', '中', NAVY],
      ['予算超過', '低', '大', '#64748b'],
    ].map((row, r) => {
      const y = 34 + r * 40
      return (
        <g key={r}>
          <rect x={12} y={y} width={296} height={40} fill={r % 2 ? GRAY_FILL : '#fff'} stroke={GRAY_LINE} />
          <text x={60} y={y + 20} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
            {row[0]}
          </text>
          <text x={150} y={y + 20} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
            {row[1]}
          </text>
          <text x={210} y={y + 20} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
            {row[2]}
          </text>
          <rect x={252} y={y + 9} width={40} height={22} rx={11} fill={row[3] as string} />
          <text x={272} y={y + 20} fill="#fff" fontSize={8} textAnchor="middle" dominantBaseline="central">
            優先
          </text>
        </g>
      )
    })}
  </SvgFrame>
)

const CatalogIllustration: ManualIllustration = () => (
  <SvgFrame label="データカタログのテーブル一覧図解">
    <Box x={12} y={14} w={296} h={22} text="DB接続 / スキーマ貼付 → AI解析" fill={BLUE_SOFT} stroke={BLUE} textFill={BLUE} fontSize={8.5} />
    {['users（顧客）', 'orders（受注）', 'items（商品）'].map((t, i) => {
      const y = 46 + i * 42
      return (
        <g key={t}>
          <rect x={12} y={y} width={296} height={36} rx={4} fill="#fff" stroke={GRAY_LINE} />
          <rect x={12} y={y} width={10} height={36} rx={4} fill={NAVY} />
          <text x={34} y={y + 14} fill={NAVY} fontSize={9} dominantBaseline="central">
            {t}
          </text>
          <text x={34} y={y + 26} fill="#64748b" fontSize={7.5} dominantBaseline="central">
            id / name / created_at …
          </text>
        </g>
      )
    })}
  </SvgFrame>
)

const BusinessDefinitionIllustration: ManualIllustration = () => (
  <SvgFrame label="業務定義シートの表図解">
    <rect x={12} y={14} width={296} height={20} fill={NAVY} />
    <text x={160} y={24} fill="#fff" fontSize={8.5} textAnchor="middle" dominantBaseline="central">
      業務定義シート（受注業務）
    </text>
    {[
      ['目的', '受注を正確に登録する'],
      ['担当', '営業 / 受注担当'],
      ['INPUT', '注文書・見積'],
      ['DO', '内容確認→入力→承認'],
      ['OUTPUT', '受注データ・確定通知'],
    ].map((row, i) => {
      const y = 34 + i * 28
      return (
        <g key={i}>
          <rect x={12} y={y} width={78} height={28} fill={GRAY_FILL} stroke={GRAY_LINE} />
          <text x={51} y={y + 14} fill={NAVY} fontSize={8} textAnchor="middle" dominantBaseline="central">
            {row[0]}
          </text>
          <rect x={90} y={y} width={218} height={28} fill="#fff" stroke={GRAY_LINE} />
          <text x={100} y={y + 14} fill={TEXT} fontSize={8} dominantBaseline="central">
            {row[1]}
          </text>
        </g>
      )
    })}
  </SvgFrame>
)

const RoadmapIllustration: ManualIllustration = () => (
  <SvgFrame label="ロードマップ（フェーズ列）図解">
    {(
      [
        ['3ヶ月', NAVY],
        ['1年', BLUE],
        ['3年', '#64748b'],
      ] as const
    ).map(([title, head], i) => {
      const x = 12 + i * 102
      return (
        <g key={title}>
          <rect x={x} y={12} width={92} height={156} rx={4} fill={GRAY_FILL} stroke={GRAY_LINE} />
          <rect x={x} y={12} width={92} height={22} rx={4} fill={head} />
          <text x={x + 46} y={23} fill="#fff" fontSize={9} textAnchor="middle" dominantBaseline="central">
            {title}
          </text>
          <rect x={x + 8} y={44} width={76} height={24} rx={3} fill="#fff" stroke={BLUE} />
          <text x={x + 46} y={56} fill={BLUE} fontSize={7.5} textAnchor="middle" dominantBaseline="central">
            GAP-{i + 1}
          </text>
          <rect x={x + 8} y={76} width={76} height={24} rx={3} fill="#fff" stroke={GRAY_LINE} />
        </g>
      )
    })}
  </SvgFrame>
)

const RequirementsIllustration: ManualIllustration = () => (
  <SvgFrame label="要求定義のリスト図解">
    <Box x={12} y={14} w={296} h={22} text="要求一覧" fill={NAVY} stroke={NAVY} textFill="#fff" fontSize={9} />
    {['REQ-1 受注を一元管理したい', 'REQ-2 承認の遅延をなくしたい', 'REQ-3 在庫を即時に確認したい'].map(
      (t, i) => {
        const y = 46 + i * 40
        return (
          <g key={t}>
            <rect x={12} y={y} width={296} height={34} rx={4} fill={i % 2 ? GRAY_FILL : '#fff'} stroke={GRAY_LINE} />
            <circle cx={28} cy={y + 17} r={5} fill={BLUE} />
            <text x={44} y={y + 17} fill={TEXT} fontSize={8.5} dominantBaseline="central">
              {t}
            </text>
          </g>
        )
      }
    )}
  </SvgFrame>
)

// ---- レジストリ本体 ----------------------------------------------------------

export const MANUAL_ENTRIES: Record<string, ManualEntry> = {
  flows: {
    key: 'flows',
    title: '業務フロー（スイムレーン）',
    purpose:
      '担当（ロール）ごとのレーンに処理を並べ、矢印でつないで業務の流れを可視化します。ASIS/TOBE の見える化に使います。',
    steps: [
      '「ロール追加」で担当レーンを作成します。',
      '「処理ノード追加」でノードを追加し、ドラッグで配置します。',
      'ノードの上下左右(4辺)の接続点から相手ノードへドラッグして矢印を接続します。',
      '矢印の付け替えは端点をドラッグして別ノードへ繋ぎ直します。',
      '接続線の途中の「＋」を押すと、その間にノードを挿入できます。',
      '「整形」ボタンで自動レイアウト、ボタンで縦／横の向きを切り替えます。',
      '「PNG出力」で画像として書き出します。',
      'ノードをダブルクリックすると、その処理の詳細フロー(ドリルダウン)に入れます。',
    ],
    Illustration: FlowsIllustration,
  },
  'issue-trees': {
    key: 'issue-trees',
    title: '課題ツリー',
    purpose:
      'GAP(問い)を起点に「なぜ」で原因を掘り下げ、打ち手まで論理的に分解します。原因分析と対策立案に使います。',
    steps: [
      'GAP(問い)を起点ノードとしてツリーを開始します。',
      '「なぜ」を追加して CAUSE(原因)ノードを下にぶら下げます。',
      'さらに「なぜ」を重ねて原因を深掘りします。',
      '原因に対して「打ち手(COUNTERMEASURE)」ノードを追加します。',
      '「発想法アシスト」を使うと分解の切り口を提案してもらえます。',
      'ノードから調査タスク／実行タスクを作成し、タスク管理に連携します。',
    ],
    Illustration: IssueTreesIllustration,
  },
  'gap-items': {
    key: 'gap-items',
    title: 'GAP（ギャップ項目）',
    purpose:
      '現状(ASIS)とあるべき姿(TOBE)の差分を整理します。対象業務・差分・優先度を記録し、課題ツリーへつなげます。',
    steps: [
      '「GAP追加」で新しいギャップ項目を作成します。',
      '対象業務と ASIS の業務フロー、TOBE の業務フローを選択します。',
      '何がどう違うのか「差分」を文章で記述します。',
      '優先度を設定して取り組む順番を決めます。',
      '「分析」タブで内容を多面的に検討します。',
      '「課題一覧／対応表」で関連する課題とのひも付けを確認します。',
      'このGAPから「課題ツリー作成」で原因分析へ展開します。',
    ],
    Illustration: GapItemsIllustration,
  },
  dfd: {
    key: 'dfd',
    title: 'DFD（データフロー図）',
    purpose:
      '業務をデータの流れで表現します。外部実体・処理(ファンクション)・データストアの間のデータの動きを整理します。',
    steps: [
      '第1レベルでは各業務フローがファンクション(処理)として並びます。',
      'ファンクションをクリックすると第2レベル(ノード単位)へドリルダウンします。',
      '「外部実体」を追加して、システム外のやり取り相手を置きます。',
      '「データストア」を追加して、データの保管場所を置きます。',
      '要素同士をつないでデータフロー(矢印)を作成します。',
      '「データフロー一覧表」で流れを表形式で確認します。',
      '各フローに帳票種別を割り当てて、やり取りされる帳票を明示します。',
      '「PNG出力」で図を画像として書き出します。',
    ],
    Illustration: DfdIllustration,
  },
  tasks: {
    key: 'tasks',
    title: 'タスク管理',
    purpose:
      '対応すべきタスクを状態・優先度・担当・期日・進捗で管理します。一覧／カンバンで運用し、打ち手や調査ノードと連携します。',
    steps: [
      '「タスク追加」で状態・優先度・担当・期日・進捗を入力します。',
      '親タスクの下にサブタスクを作り、階層で整理します。',
      '「一覧」と「ボード(カンバン)」を切り替えて表示します。',
      'カンバンではカードを別の列へドラッグして状態を変更します。',
      '各タスクにコメントや添付ファイルを追加します。',
      'WBS・ガント表示で日程と進捗を俯瞰します。',
      '課題ツリーの打ち手／調査ノードから作ったタスクと相互に連携します。',
    ],
    Illustration: TasksIllustration,
  },
  'tasks-gantt': {
    key: 'tasks-gantt',
    title: 'WBS / ガントチャート',
    purpose:
      'タスクを時間軸のバーで表し、日程・依存関係・進捗を一目で管理します。スケジュール調整に使います。',
    steps: [
      'タスクが日付軸上のバーとして表示されます。',
      'バー全体をドラッグして開始／終了日をまとめて移動します。',
      'バーの端をドラッグして期間(日数)をリサイズします。',
      'バー同士をつないで依存関係(先行→後続)を設定します。',
      'バー内の塗りで進捗(%)を確認・更新します。',
      '依存に沿ってスケジュール全体の整合性をチェックします。',
    ],
    Illustration: TasksGanttIllustration,
  },
  'crud-matrix': {
    key: 'crud-matrix',
    title: 'CRUD表',
    purpose:
      '機能を洗い出し、ロールや業務ごとにデータの作成/参照/更新/削除(CRUD)権限を整理します。設計の抜け漏れ検出に使います。',
    steps: [
      'まず対象となる機能を洗い出します。',
      '「ロール×CRUD」で役割ごとの権限を設定します。',
      '「業務×CRUD」で業務ごとのデータ操作を整理します。',
      '「API×ロール」「ステータス×ロール」など別の切り口でも確認します。',
      'セルをクリックして C/R/U/D の付与・解除を切り替えます。',
      '設計バグ警告（例: 参照のない更新など）が出たら見直します。',
    ],
    Illustration: CrudMatrixIllustration,
  },
  'stakeholder-management': {
    key: 'stakeholder-management',
    title: 'ステークホルダー管理',
    purpose:
      '関係者を影響度×支持度のマトリクスで把握し、巻き込み方を設計します。関心ごとや会議体、役割分担も管理します。',
    steps: [
      'ステークホルダーを登録します。',
      '影響度×支持度のマトリクス上にカードを配置します。',
      'カードをクリックすると全項目を編集できます。',
      '各ステークホルダーの「関心ごと」を記録します。',
      '「会議体」を定義し、誰がどの会議に参加するか整理します。',
      '「役割と責任」を割り当てて推進体制を明確にします。',
    ],
    Illustration: StakeholderIllustration,
  },
  'risk-management': {
    key: 'risk-management',
    title: 'リスク管理',
    purpose:
      'プロジェクトのリスクを発生確率×影響度×優先度で洗い出し、対策の優先順位を決めて管理します。',
    steps: [
      'リスクを登録して内容を記述します。',
      '発生確率(高/中/低)を設定します。',
      '影響度(大/中/小)を設定します。',
      '確率と影響度から優先度を判断します。',
      '優先度の高いリスクから対応方針を検討します。',
      'リスク表で全体を俯瞰し、定期的に見直します。',
    ],
    Illustration: RiskIllustration,
  },
  catalog: {
    key: 'catalog',
    title: 'データカタログ',
    purpose:
      '既存システムのテーブル構造を取り込み、データ資産を一覧化します。DB直結またはスキーマ貼り付けから AI解析で整理します。',
    steps: [
      'DBに直接接続するか、スキーマ(DDL等)を貼り付けます。',
      '「AI解析」を実行してテーブル・カラムを自動で読み取ります。',
      'テーブル一覧から各テーブルの内容を確認します。',
      'テーブルを開いてカラムの説明や用途を補記します。',
      '参考マスタを使って項目の意味づけを補完します。',
      '整理した結果を DFD やカタログとして活用します。',
    ],
    Illustration: CatalogIllustration,
  },
  'business-definition': {
    key: 'business-definition',
    title: '業務定義シート',
    purpose:
      '全業務フローを一覧し、各業務の定義(目的/担当/INPUT/DO/OUTPUT/手順)を1枚のシートとして整備します。',
    steps: [
      '全業務フローの一覧から対象の業務を選びます。',
      'その業務の「目的」を記述します。',
      '「担当」を割り当てます。',
      'INPUT(入力)・DO(実施)・OUTPUT(出力)を順に埋めます。',
      '具体的な「手順」を記述します。',
      '各業務の個別定義を編集し、シートを完成させます。',
    ],
    Illustration: BusinessDefinitionIllustration,
  },
  roadmap: {
    key: 'roadmap',
    title: 'ロードマップ',
    purpose:
      'GAP(やるべきこと)を3ヶ月／1年／3年のフェーズに割り当て、改善の進め方を時間軸で計画します。',
    steps: [
      'ロードマップ画面で 3ヶ月／1年／3年のフェーズ列を確認します。',
      '未割当の GAP を一覧から選びます。',
      'GAP を該当するフェーズ列へ割り当てます。',
      'フェーズ内で優先順位を並べ替えます。',
      '全体のバランスを見てフェーズ間を調整します。',
      '計画として共有し、進捗に応じて見直します。',
    ],
    Illustration: RoadmapIllustration,
  },
  requirements: {
    key: 'requirements',
    title: '要求定義',
    purpose:
      'ステークホルダーから出てきた要求を登録し、整理・分類します。後続の要件定義のインプットになります。',
    steps: [
      '「要求追加」で新しい要求を登録します。',
      '要求の内容を具体的に記述します。',
      '関連する業務やGAPと関連づけます。',
      '一覧で要求を整理・分類します。',
      '重複や粒度を調整して要求を磨き込みます。',
    ],
    Illustration: RequirementsIllustration,
  },
}

export type ManualFeatureKey = keyof typeof MANUAL_ENTRIES

/** キーが未登録なら undefined を返す安全なアクセサ。 */
export function getManualEntry(key: string): ManualEntry | undefined {
  return MANUAL_ENTRIES[key]
}

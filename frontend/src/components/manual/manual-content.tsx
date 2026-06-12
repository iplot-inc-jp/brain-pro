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

const DomainsIllustration: ManualIllustration = () => (
  <SvgFrame label="領域とサブ領域のツリー（担当者・関連会議チップ）図解">
    {/* 領域 → サブ領域のツリー */}
    <Box x={12} y={14} w={150} h={26} text="受注管理（領域）" fill={NAVY} stroke={NAVY} textFill="#fff" />
    <Box x={40} y={52} w={140} h={24} text="見積（サブ領域）" fill={GRAY_FILL} />
    <Box x={40} y={86} w={140} h={24} text="出荷（サブ領域）" fill={GRAY_FILL} />
    <line x1={26} y1={40} x2={26} y2={98} stroke={GRAY_LINE} strokeWidth={1.4} />
    <line x1={26} y1={64} x2={40} y2={64} stroke={GRAY_LINE} strokeWidth={1.4} />
    <line x1={26} y1={98} x2={40} y2={98} stroke={GRAY_LINE} strokeWidth={1.4} />
    {/* 担当者チップ（RACI）と関連会議チップ */}
    <rect x={200} y={55} width={52} height={18} rx={9} fill={BLUE_SOFT} stroke={BLUE} />
    <text x={226} y={64} fill={BLUE} fontSize={7.5} textAnchor="middle" dominantBaseline="central">
      佐藤 A
    </text>
    <rect x={200} y={89} width={84} height={18} rx={9} fill="#fff" stroke={GRAY_LINE} />
    <text x={242} y={98} fill={TEXT} fontSize={7.5} textAnchor="middle" dominantBaseline="central">
      定例会議
    </text>
    <text x={160} y={146} fill={TEXT} fontSize={8} textAnchor="middle">
      担当者(RACI)・関連会議をチップで確認
    </text>
  </SvgFrame>
)

const IoTypesIllustration: ManualIllustration = () => (
  <SvgFrame label="INPUT/OUTPUTマスタ（具体データ添付・カタログ表紐付け）図解">
    <Box x={12} y={14} w={296} h={22} text="INPUT/OUTPUT（物体・情報・帳票）" fill={NAVY} stroke={NAVY} textFill="#fff" fontSize={8.5} />
    {/* 1行（分類バッジ + カタログ表チップ） */}
    <rect x={12} y={44} width={296} height={30} rx={4} fill="#fff" stroke={GRAY_LINE} />
    <text x={24} y={59} fill={TEXT} fontSize={8.5} dominantBaseline="central">
      注文書
    </text>
    <rect x={86} y={51} width={34} height={16} rx={8} fill={BLUE_SOFT} stroke={BLUE} />
    <text x={103} y={59} fill={BLUE} fontSize={7} textAnchor="middle" dominantBaseline="central">
      帳票
    </text>
    <rect x={196} y={51} width={100} height={16} rx={8} fill="#fff" stroke={GRAY_LINE} />
    <text x={246} y={59} fill={TEXT} fontSize={7} textAnchor="middle" dominantBaseline="central">
      カタログ表: orders
    </text>
    {/* 具体データの D&D 添付ゾーン */}
    <rect x={12} y={88} width={296} height={50} rx={6} fill={GRAY_FILL} stroke={BLUE} strokeDasharray="5 4" />
    <text x={160} y={107} fill={BLUE} fontSize={8.5} textAnchor="middle">
      具体データをドラッグ＆ドロップで添付
    </text>
    <text x={160} y={123} fill="#64748b" fontSize={7.5} textAnchor="middle">
      PDF・画像など（行を展開して閲覧）
    </text>
  </SvgFrame>
)

const SystemsIllustration: ManualIllustration = () => (
  <SvgFrame label="システムマスタ（対象/周辺の区分と領域紐付け）図解">
    <Box x={12} y={14} w={296} h={22} text="システム一覧" fill={NAVY} stroke={NAVY} textFill="#fff" fontSize={9} />
    {(
      [
        ['基幹システム', '対象', BLUE, '領域: 受注管理'],
        ['会計ソフト', '周辺', '#64748b', '領域: 経理'],
      ] as const
    ).map(([name, kind, color, domain], i) => {
      const y = 48 + i * 44
      return (
        <g key={name}>
          <rect x={12} y={y} width={296} height={36} rx={4} fill={i % 2 ? GRAY_FILL : '#fff'} stroke={GRAY_LINE} />
          <text x={24} y={y + 18} fill={TEXT} fontSize={8.5} dominantBaseline="central">
            {name}
          </text>
          <rect x={120} y={y + 9} width={40} height={18} rx={9} fill={color} />
          <text x={140} y={y + 18} fill="#fff" fontSize={7.5} textAnchor="middle" dominantBaseline="central">
            {kind}
          </text>
          <text x={200} y={y + 18} fill="#64748b" fontSize={7.5} dominantBaseline="central">
            {domain}
          </text>
        </g>
      )
    })}
    <text x={160} y={156} fill={TEXT} fontSize={8} textAnchor="middle">
      対象/周辺の区分と領域への紐付けで整理
    </text>
  </SvgFrame>
)

const ConstraintsIllustration: ManualIllustration = () => (
  <SvgFrame label="制約条件/前提条件のタブ切り替えと一覧の図解">
    {/* kind タブ */}
    <rect x={12} y={14} width={92} height={22} rx={4} fill={NAVY} />
    <text x={58} y={25} fill="#fff" fontSize={8.5} textAnchor="middle" dominantBaseline="central">
      制約条件
    </text>
    <rect x={110} y={14} width={92} height={22} rx={4} fill="#fff" stroke={GRAY_LINE} />
    <text x={156} y={25} fill={TEXT} fontSize={8.5} textAnchor="middle" dominantBaseline="central">
      前提条件
    </text>
    {['法令: 個人情報は社外に出さない', '社内ルール: 承認は2段階まで'].map((t, i) => {
      const y = 48 + i * 40
      return (
        <g key={t}>
          <rect x={12} y={y} width={296} height={32} rx={4} fill={i % 2 ? GRAY_FILL : '#fff'} stroke={GRAY_LINE} />
          <circle cx={28} cy={y + 16} r={5} fill={BLUE} />
          <text x={44} y={y + 16} fill={TEXT} fontSize={8.5} dominantBaseline="central">
            {t}
          </text>
        </g>
      )
    })}
    <text x={160} y={150} fill={TEXT} fontSize={8} textAnchor="middle">
      タブで制約/前提を切り替えて管理
    </text>
  </SvgFrame>
)

const RolesIllustration: ManualIllustration = () => (
  <SvgFrame label="ロールマスタ（人/システムの区分）図解">
    {(
      [
        ['営業担当', '人', BLUE],
        ['受注システム', 'システム', NAVY],
      ] as const
    ).map(([name, kind, color], i) => {
      const x = 16 + i * 152
      return (
        <g key={name}>
          <rect x={x} y={24} width={136} height={88} rx={6} fill="#fff" stroke={GRAY_LINE} />
          <circle cx={x + 24} cy={48} r={12} fill={color} />
          <text x={x + 24} y={48} fill="#fff" fontSize={8} textAnchor="middle" dominantBaseline="central">
            {kind === '人' ? '人' : 'PC'}
          </text>
          <text x={x + 46} y={48} fill={NAVY} fontSize={9} dominantBaseline="central">
            {name}
          </text>
          <rect x={x + 12} y={72} width={56} height={18} rx={9} fill={BLUE_SOFT} stroke={BLUE} />
          <text x={x + 40} y={81} fill={BLUE} fontSize={7.5} textAnchor="middle" dominantBaseline="central">
            {kind}
          </text>
        </g>
      )
    })}
    <text x={160} y={150} fill={TEXT} fontSize={8} textAnchor="middle">
      ロールは業務フローのスイムレーンになる
    </text>
  </SvgFrame>
)

const MeetingsIllustration: ManualIllustration = () => (
  <SvgFrame label="会議マスタ（形式・所要・主催・ステータス）の表図解">
    <rect x={12} y={14} width={296} height={20} fill={NAVY} />
    {['会議名', '形式', '所要', '主催', '状態'].map((h, i) => (
      <text
        key={h}
        x={[56, 130, 180, 230, 282][i]}
        y={24}
        fill="#fff"
        fontSize={8}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {h}
      </text>
    ))}
    <rect x={12} y={34} width={296} height={36} fill="#fff" stroke={GRAY_LINE} />
    <text x={56} y={52} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
      定例会議
    </text>
    <text x={130} y={52} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
      オンライン
    </text>
    <text x={180} y={52} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
      60分
    </text>
    <text x={230} y={52} fill={TEXT} fontSize={8} textAnchor="middle" dominantBaseline="central">
      佐藤
    </text>
    <rect x={262} y={43} width={40} height={18} rx={9} fill={BLUE} />
    <text x={282} y={52} fill="#fff" fontSize={7.5} textAnchor="middle" dominantBaseline="central">
      開催中
    </text>
    {/* 対象ステークホルダー / 対象領域 / レビュー対象リスク のチップ */}
    {(
      [
        ['対象: 役員・現場', BLUE_SOFT, BLUE],
        ['領域: 受注管理', GRAY_FILL, TEXT],
        ['リスク: 納期遅延', '#fee2e2', '#dc2626'],
      ] as const
    ).map(([t, fill, color], i) => (
      <g key={t}>
        <rect x={12 + i * 102} y={86} width={94} height={20} rx={10} fill={fill} stroke={GRAY_LINE} />
        <text x={59 + i * 102} y={96} fill={color} fontSize={7} textAnchor="middle" dominantBaseline="central">
          {t}
        </text>
      </g>
    ))}
    <text x={160} y={140} fill={TEXT} fontSize={8} textAnchor="middle">
      行クリックで全項目を編集
    </text>
  </SvgFrame>
)

const AsisTobeIllustration: ManualIllustration = () => (
  <SvgFrame label="ASIS⇔TOBE比較（上下分割）の図解">
    {/* 上ペイン: ASIS */}
    <rect x={12} y={14} width={296} height={70} rx={4} fill="#fff" stroke="#d97706" strokeWidth={1.4} />
    <text x={26} y={28} fill="#d97706" fontSize={8} fontWeight={700}>
      ASIS（現状）
    </text>
    <Box x={40} y={40} w={70} h={26} text="受付" fill={GRAY_FILL} fontSize={8} />
    <Box x={180} y={40} w={70} h={26} text="手作業転記" fill={GRAY_FILL} fontSize={8} />
    <Arrow x1={110} y1={53} x2={178} y2={53} />
    {/* 下ペイン: TOBE */}
    <rect x={12} y={94} width={296} height={70} rx={4} fill="#fff" stroke="#059669" strokeWidth={1.4} />
    <text x={26} y={108} fill="#059669" fontSize={8} fontWeight={700}>
      TOBE（あるべき姿）
    </text>
    <Box x={40} y={120} w={70} h={26} text="受付" fill={BLUE_SOFT} fontSize={8} />
    <Box x={180} y={120} w={70} h={26} text="自動連携" fill={BLUE_SOFT} fontSize={8} />
    <Arrow x1={110} y1={133} x2={178} y2={133} />
  </SvgFrame>
)

const CharterIllustration: ManualIllustration = () => (
  <SvgFrame label="プロジェクト憲章（1枚もの）の図解">
    <rect x={12} y={14} width={296} height={20} fill={NAVY} />
    <text x={160} y={24} fill="#fff" fontSize={8.5} textAnchor="middle" dominantBaseline="central">
      プロジェクト憲章
    </text>
    {[
      ['背景', 'なぜ始めるのか'],
      ['目的', '達成したいこと'],
      ['成功基準', '測定可能な基準'],
      ['スコープ', 'やること / やらないこと'],
      ['承認者', 'スポンサー・承認者'],
    ].map((row, i) => {
      const y = 34 + i * 28
      return (
        <g key={row[0]}>
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

const HistoryIllustration: ManualIllustration = () => (
  <SvgFrame label="変更履歴（自動記録された操作の一覧）の図解">
    <Box x={12} y={14} w={296} h={22} text="変更履歴（自動記録）" fill={NAVY} stroke={NAVY} textFill="#fff" fontSize={9} />
    {(
      [
        ['10:21 sato@…  業務フロー', '作成', '#16a34a'],
        ['11:05 suzuki@…  タスク', '更新', BLUE],
        ['13:40 sato@…  リスク', '削除', '#dc2626'],
      ] as const
    ).map(([t, action, color], i) => {
      const y = 46 + i * 40
      return (
        <g key={t}>
          <rect x={12} y={y} width={296} height={34} rx={4} fill={i % 2 ? GRAY_FILL : '#fff'} stroke={GRAY_LINE} />
          <text x={24} y={y + 17} fill={TEXT} fontSize={8} dominantBaseline="central">
            {t}
          </text>
          <rect x={252} y={y + 8} width={44} height={18} rx={9} fill={color} />
          <text x={274} y={y + 17} fill="#fff" fontSize={7.5} textAnchor="middle" dominantBaseline="central">
            {action}
          </text>
        </g>
      )
    })}
    <text x={160} y={172} fill={TEXT} fontSize={8} textAnchor="middle">
      操作すると自動で記録される（手入力は不要）
    </text>
  </SvgFrame>
)

// ---- レジストリ本体 ----------------------------------------------------------

export const MANUAL_ENTRIES: Record<string, ManualEntry> = {
  domains: {
    key: 'domains',
    title: '領域（共通マスタ）',
    purpose:
      'ASIS/TOBE・課題・成果物を分類する「領域」を管理します。領域の下にサブ領域をぶら下げ、担当者や関連会議もチップで確認できます。',
    steps: [
      '「領域を追加」で最上位の分類軸となる領域を作成します。',
      '「サブ領域を追加」で親領域を選び、領域の下に入れ子のサブ領域を作成します。',
      '名前はクリックして直接編集し、フォーカスを外すと自動保存されます。',
      '各行の担当者チップで、その領域の担当（ステークホルダー×RACI）を確認します。',
      '関連会議チップで、その領域を対象とする会議体を確認します（編集は会議マスタ）。',
      '不要になった領域はゴミ箱アイコンで削除します（サブ領域を持つ領域は先にサブ領域を削除）。',
    ],
    Illustration: DomainsIllustration,
  },
  'io-types': {
    key: 'io-types',
    title: 'INPUT/OUTPUT（共通マスタ）',
    purpose:
      '業務フローやDFDで扱う入出力（物体・情報・帳票）のマスタを管理します。具体データの添付や、データカタログの表との紐付けも確認できます。',
    steps: [
      '追加フォームに名前を入力し、分類（情報／物体／帳票）を選んで「追加」します。',
      '名前・説明・分類・領域はインライン編集し、フォーカスを外すと自動保存されます。',
      '行頭の「>」をクリックして展開し、具体データ（PDF・画像など）をドラッグ＆ドロップで添付・閲覧します。',
      '「紐づくカタログ表」チップでデータカタログの表との対応を確認します（紐付け操作はカタログ側）。',
      '業務フロー側では、矢印が運ぶ情報やノードの入出力としてこのマスタから選択します。',
      '不要になった項目はゴミ箱で削除します（紐づく具体データも削除されます）。',
    ],
    Illustration: IoTypesIllustration,
  },
  systems: {
    key: 'systems',
    title: 'システム（共通マスタ）',
    purpose:
      '業務で使っているシステム・ツールを登録します。対象システム／周辺システムの区分と、領域への紐付けで整理します。',
    steps: [
      '上部フォームで名前と区分（対象システム／周辺システム）を入力して追加します。',
      '名前・説明はインライン編集し、フォーカスを外すと自動保存されます。',
      '区分セレクトで対象／周辺を切り替えます（アイコン色で区別されます）。',
      '領域セレクトで、そのシステムが属する領域を紐づけます（任意）。',
      '業務フローのロールや業務定義シートのシステム欄は、このマスタから選択します。',
      '不要になったシステムは削除します。',
    ],
    Illustration: SystemsIllustration,
  },
  constraints: {
    key: 'constraints',
    title: '制約条件（共通マスタ）',
    purpose:
      '設計の前提となる「制約条件（守るべき条件）」と「前提条件（成り立つと仮定する条件）」をタブで区別して管理します。',
    steps: [
      '上部のタブで「制約条件」「前提条件」を切り替えて一覧を絞り込みます。',
      '「追加」で条件を登録し、種別（制約／前提）を選びます。',
      '内容はインライン編集し、フォーカスを外すと自動保存されます。',
      '各条件は領域に紐づけられます（任意）。',
      '登録した制約・前提条件はプロジェクト憲章にもチップ表示されます。',
      '不要になった条件は削除します。',
    ],
    Illustration: ConstraintsIllustration,
  },
  roles: {
    key: 'roles',
    title: 'ロール（共通マスタ）',
    purpose:
      '業務フローの担当（スイムレーン）になるロールを管理します。人／システムの区分と、システムマスタ・領域への紐付けで整理します。',
    steps: [
      '「ロール追加」でロール名（例: 顧客、受注システム）を入力して登録します。',
      '種別を 人／システム／その他 から選びます（人＝User／システム＝Server のアイコンと色で区別）。',
      '種別が「システム」のときは、共通マスタのシステム（対象／周辺）を紐付けます。',
      '各カードの編集ボタンから種別・紐付けシステム・色などを変更します。',
      'ステークホルダー管理の「役割と責任」では、ロールごとに領域・責任・KPI を定義できます。',
      '使用中フロー数を確認のうえ、不要になったロールは削除します。',
    ],
    Illustration: RolesIllustration,
  },
  meetings: {
    key: 'meetings',
    title: '会議マスタ',
    purpose:
      '定例・レビューなどの会議体を管理します。形式・所要時間・主催・ステータスのほか、対象ステークホルダー・対象領域・レビュー対象リスクを紐づけます。',
    steps: [
      '「会議体を追加」で会議名・目的を登録します。',
      '行クリックの編集モーダルで、頻度・曜日時間・所要時間・形式（対面／オンラインなど）を設定します。',
      '主催と対象ステークホルダーをステークホルダーマスタから選びます。',
      '対象領域を領域マスタ（領域→サブ領域の入れ子チェック）から複数選択します。',
      'ステータス列のトグルで開催中／休止を切り替えます。',
      'レビュー対象リスクのチップで、その会議でレビューするリスクを確認します（設定はリスク管理側）。',
      '不要になった会議体はゴミ箱アイコンで削除します。',
    ],
    Illustration: MeetingsIllustration,
  },
  flows: {
    key: 'flows',
    title: '業務フロー（スイムレーン）',
    purpose:
      '担当（ロール）ごとのレーンに処理を並べ、矢印でつないで業務の流れを可視化します。ASIS/TOBE の見える化に使います。',
    steps: [
      '「ロール追加」で担当レーンを作成し、「処理ノード追加」でノードを置いてドラッグで配置します。',
      'ツールバーで「選択／移動」モードを切り替えます。選択モード中も Space を押しながらドラッグで画面を移動できます。',
      'ノードの上下左右(4辺)の接続点から相手ノードへドラッグして矢印を接続します。端点のドラッグで付け替え、途中の「＋」でノード挿入もできます。',
      '付箋・コメント・アイコンの注釈を追加できます。ノードや付箋は選択するとハンドルが出て、マウスでリサイズできます。',
      '「整形」で自動レイアウトします。矢印が運ぶ情報（チップ）の幅も考慮して間隔が決まります。',
      '縦／横の切り替えは、向きを変えたうえで再整形されます（位置は整形後の配置になります）。',
      '操作は ⌘Z で元に戻す、⌘⇧Z でやり直しできます（ツールバーの Undo/Redo ボタンでも可）。',
      '全画面表示に切り替えて広く編集できます（Esc で解除）。「PNG出力」で書き出し、ダブルクリックで詳細フローへドリルダウンします。',
    ],
    Illustration: FlowsIllustration,
  },
  'asis-tobe': {
    key: 'asis-tobe',
    title: 'ASIS/TOBE管理・比較',
    purpose:
      '現状(ASIS)とあるべき姿(TOBE)の業務フローを領域ごとに管理し、互いに対応付けて上下に並べて比較します。',
    steps: [
      'ASIS管理／TOBE管理では、業務フローのカードが領域（サブ領域）ごとにグループ表示されます。',
      'カードをクリックすると、そのフローの編集画面を開きます。',
      'ASISカードの「対応TOBE」、TOBEカードの「対応ASIS」セレクタで両者を対応付けます。',
      '対応付けたカードには「ASIS⇔TOBE比較」への導線が表示されます。',
      '比較ビュー(/flows/compare)では、ASIS が上・TOBE が下の上下50/50分割で表示されます。',
      '上部のセレクタで ASIS フローを選ぶと、対応する TOBE フローが自動選択されます。',
      '右上のボタンで比較ビュー全体を全画面表示できます（Esc で解除）。',
    ],
    Illustration: AsisTobeIllustration,
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
      '子ノードの種別は親ノードの種別に応じて選択肢が絞り込まれます。取り違えを直すときは「全種別を表示」トグルで全種別から選べます。',
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
      '各フローに情報種別(情報/物体/帳票)を割り当てて、やり取りされる情報を明示します。',
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
      '左の WBS ツリーで階層を確認します。親の開閉（折りたたんだ子孫はガントからも隠れる）と完了数の表示があります。',
      'バー本体を左右にドラッグすると滑らかに動き、離した位置で日付にスナップして保存されます。',
      'バーの左右の端をドラッグして期間(日数)を伸縮し、進捗ハンドルで進捗(%)を更新します。',
      'バー右端の丸い接続ハンドルをドラッグし、後続タスクのバーの上で離すと依存(先行→後続の矢印)が引けます。矢印クリックで削除できます。',
      '親タスクのバーは子タスクの期間(最小開始日〜最大期限)に自動で追従します。親を手動で動かした値は、子を変更するまで維持されます。',
      'バーやツリーの行をクリックすると右側に編集サイドバーが開き、その場で編集できます。',
      'バーにマウスを乗せるとポップアップで期間・進捗などの詳細を確認できます。',
      '右上で「日／週／月」の目盛り粒度を切り替え、全画面表示で広く編集できます。',
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
      '関係者を内部／外部に分けて把握し、影響度×支持度のマトリクスや RACI で巻き込み方を設計します。関心ごとや会議体、役割分担も管理します。',
    steps: [
      '「ステークホルダー」タブで関係者を登録し、側（内部／外部）を設定します。一覧は外部→内部のセクションで表示されます。',
      '影響度×支持度のマトリクス上にカードを配置し、カードをクリックすると全項目を編集できます。',
      'RACIマトリクス（領域×人）のセルをクリックして R→A→C→I→なし を切り替えます。A が不在／複数の領域行には警告アイコンが出ます。',
      '人の名前をクリックすると人単位ビュー（詳細サイドパネル）が開き、その人の担当領域・参加会議をまとめて確認できます。',
      '「役割と責任」でロールごとに領域・責任・意思決定範囲・関心KPIを定義します。',
      '「関心ごと」「会議・報告」タブで、関心マトリクスと会議体・報告連絡を設計します。',
    ],
    Illustration: StakeholderIllustration,
  },
  'risk-management': {
    key: 'risk-management',
    title: 'リスク管理',
    purpose:
      'プロジェクトのリスク（脅威／好機）を確率×影響(P×I)スコアで洗い出し、対応戦略と優先順位を決めて管理します。',
    steps: [
      '「行を追加」でリスク（脅威／好機）を登録します。一覧では区分・事象内容・種別・スコア・期限・対応策などの主要列を確認できます。',
      '行クリックの編集モーダルで、種別（RBSカテゴリ）・領域・オーナー・レビュー会議を設定します。',
      '発生確率×影響度（1-5）を設定すると、スコア(P×I)が自動計算されます。',
      '脅威／好機の切替で対応戦略の選択肢が変わります（脅威：回避/転嫁/軽減/受容、好機：活用/共有/強化/受容）。',
      '上部の確率×影響ヒートマップのセルをクリックすると、そのセルのリスクに絞り込めます。',
      '編集モーダルの「対応タスク作成」でリスク対応タスクを起票し、タスク管理に連携します。',
      '区分・期限・ライフサイクルで対応状況を見渡し、下部の「種別管理」で RBS カテゴリを整備します。',
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
      '行は1つの業務フローです。親フロー→子フローの親子階層の順に並びます。',
      '業務フロー名をクリックすると、そのフローの「個別定義」タブを開きます。',
      '目的・頻度などのセルは直接入力でき、フォーカスを外すと自動保存されます。',
      'INPUT/OUTPUT は、フローのノードに紐づけた情報リンク（情報種別）から自動集計したチップ表示です。変更は業務フロー側で行います。',
      '「編集」モーダルで DO手順・例外処理などをまとめて編集します。担当・次工程・システム・INPUT/OUTPUT 補足はマスタから選択でき、「＋」でその場で追加もできます。',
      '写真・スクリーンショットはモーダル下部にドラッグ＆ドロップで添付します（複数可）。',
      '「業務フローへ」ボタンで、そのフローの業務フローエディタへ移動します。',
    ],
    Illustration: BusinessDefinitionIllustration,
  },
  roadmap: {
    key: 'roadmap',
    title: 'ロードマップ',
    purpose:
      'TOBE打ち手や GAP をフェーズ列（初期値: 3ヶ月／1年／3年）に割り当て、改善の進め方を時間軸で計画します。フェーズ列は自由に編集できます。',
    steps: [
      '「表示」で TOBE打ち手／GAP／両方 を切り替えます（選択は保存されます）。',
      'カードはカード全体を掴んでドラッグでき、別のフェーズ列へドロップして振り分けます。',
      'フェーズ列は自由に編集できます。列名クリック（または鉛筆）で改名、「＋フェーズ追加」で追加、←/→で並べ替え、ゴミ箱で削除（カードは未分類へ）。',
      '領域フィルタで領域（親子）を絞り込み、「領域ごとにグループ表示」で列内を領域見出しで束ねます。',
      'TOBE打ち手カードの「GAP n件」バッジをクリックすると、紐づく GAP を展開して確認できます。',
      'GAPカードでは期日／目標とメモを入力できます（各列で優先度→並び順にソート）。',
      '変更は自動保存されます。手動で保存したいときは「保存」を押します。',
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
  charter: {
    key: 'charter',
    title: '背景・目的',
    purpose:
      'なぜやるのか（背景）・何を達成するのか（目的）・何をもって成功とするか（成功基準）を言語化し、関連資料と一緒に1ページで管理します。',
    steps: [
      '「背景」に、なぜこのプロジェクトを始めるのか（現状の課題・経緯）を記入します（フォーカスを外すと自動保存）。',
      '「目的」に、このプロジェクトで達成したいことを記入します。',
      '「成功基準」に、何をもって成功とするかを測定可能な形で記入します。',
      '「関連資料」に企画書・現状資料などのファイルをドラッグ＆ドロップで添付します（全形式・複数可）。画像はサムネイル、その他はファイル名リンクで一覧表示されます。',
      'スコープ外（このプロジェクトでやらないこと）はGAP一覧の「スコープ外」トグルで管理します。',
      '関係者と合意したら、キックオフや迷ったときの判断のよりどころとして参照します。',
    ],
    Illustration: CharterIllustration,
  },
  history: {
    key: 'history',
    title: '変更履歴',
    purpose:
      'プロジェクト内で行われた作成・更新・削除の操作が自動で記録されます。「いつ・誰が・何を」変更したかを後から確認できます。',
    steps: [
      'この画面は自動記録です。各画面で作成・更新・削除を行うと、その操作が自動でここに残ります（手動での登録は不要）。',
      '一覧は新しい順に、時刻・操作者・対象・アクション（作成／更新／削除）・内容を表示します。',
      '「対象種別」プルダウンで、業務フロー・タスクなど対象を絞り込みます。',
      '「アクション」プルダウンで、作成／更新／削除を絞り込みます。',
      '最新の操作を反映するには「更新」ボタンを押します。',
      'グレーで打ち消し表示されている行は、失敗した（エラーになった）操作です。',
    ],
    Illustration: HistoryIllustration,
  },
}

export type ManualFeatureKey = keyof typeof MANUAL_ENTRIES

/** キーが未登録なら undefined を返す安全なアクセサ。 */
export function getManualEntry(key: string): ManualEntry | undefined {
  return MANUAL_ENTRIES[key]
}

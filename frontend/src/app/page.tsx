import Link from 'next/link';
import {
  ArrowRight,
  GitBranch,
  Network,
  Grid3X3,
  Workflow,
  Github,
  GitCompare,
  Database,
} from 'lucide-react';

const NAVY = '#050f3e';

const pipeline = [
  '現状把握 / ASIS',
  '課題（なぜ型）',
  'TOBE設計',
  'GAP',
  '要件 / CRUD',
  '動作確認',
];

const features = [
  {
    icon: GitBranch,
    tag: 'BUSINESS FLOW',
    title: '業務フロー（ASIS / TOBE）',
    desc: 'ロール×時系列のスイムレーンを構造から自動レイアウト。縦/横表示・PNG出力・mermaidからAI生成にも対応。',
  },
  {
    icon: Network,
    tag: 'ISSUE TREE',
    title: '課題ツリー（なぜ→打ち手）',
    desc: 'GAPを起点に「なぜ」で原因を○×△検証し、確定した原因へ打ち手をぶら下げるマインドマップ。',
  },
  {
    icon: Grid3X3,
    tag: 'CRUD MATRIX',
    title: 'CRUD表（5モード）',
    desc: '機能の洗い出し・ロール×CRUD権限・業務×CRUD・API×ロール・ステータス×ロールを一枚で俯瞰。',
  },
  {
    icon: Github,
    tag: 'GITHUB × AI',
    title: 'コードからAI抽出',
    desc: 'リポジトリを連携すると、commit監視のエージェントがAPI・テーブル・ステータス・ロールを抽出し仕様を自動更新。',
  },
  {
    icon: Workflow,
    tag: 'PHASES',
    title: 'フェーズ管理（Ph.0–7）',
    desc: '構想→現状把握→課題→TOBE→提案→要件→推進まで、プロジェクトを方法論パイプラインで整理。',
  },
  {
    icon: GitCompare,
    tag: 'GAP',
    title: 'GAP（あるべき−現状）',
    desc: 'ASIS↔TOBEの差分＝本当の課題を業務領域ごとに記録し、要件・見積もりの粒度へ橋渡し。',
  },
];

const audiences = [
  { role: 'DXコンサル / BA', desc: '現状把握から要件定義までを一気通貫で。抜け漏れを構造で防ぐ。' },
  { role: 'PM / 事業責任者', desc: 'フェーズと課題・打ち手・GAPを俯瞰し、合意形成を加速。' },
  { role: 'エンジニア', desc: 'GitHub連携でコードから仕様を自動生成。AIに正確な文脈を渡す。' },
];

export default function HomePage() {
  return (
    <div className="relative bg-white text-gray-900">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-40 backdrop-blur-md bg-white/80 border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
              style={{ backgroundColor: NAVY }}
            >
              <Database className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight" style={{ color: NAVY }}>
              ai-data-flow
            </span>
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              ログイン
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:opacity-90"
              style={{ backgroundColor: NAVY }}
            >
              無料で始める
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-white">
        <div
          className="absolute inset-0 -z-10 opacity-[0.5]"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 0%, rgba(37,99,235,0.10) 0%, rgba(255,255,255,0) 70%)',
          }}
        />
        <div className="max-w-6xl mx-auto px-6 pt-36 pb-20 text-center">
          <p className="text-xs font-bold tracking-[0.25em] text-gray-400 mb-6 uppercase">
            IPLoT Methodology Platform
          </p>
          <h1 className="text-4xl md:text-6xl font-bold leading-[1.25] tracking-tight">
            現状把握から要件定義まで、
            <br className="hidden md:block" />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(120deg, ${NAVY} 0%, #2563eb 60%, #60a5fa 100%)` }}
            >
              ひとつなぎに。
            </span>
          </h1>
          <p className="mt-8 text-base md:text-lg text-gray-600 leading-loose max-w-2xl mx-auto">
            ASIS業務フロー → 課題（なぜ→打ち手）→ TOBE → GAP → 要件（CRUD表）→ 動作確認。
            <br className="hidden md:block" />
            人もAIも同じ全体像を即座に理解できる、業務設計プラットフォーム。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold text-white shadow-md transition-colors hover:opacity-90"
              style={{ backgroundColor: NAVY }}
            >
              無料で始める
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full border-2 px-8 py-3 text-sm font-bold transition-colors hover:text-white"
              style={{ borderColor: NAVY, color: NAVY }}
            >
              ログイン
            </Link>
          </div>

          {/* Pipeline strip */}
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-sm">
            {pipeline.map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-700 font-medium">
                  {step}
                </span>
                {i < pipeline.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-gray-300" />}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white py-20 md:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-14 text-center">
            <p className="text-xs font-bold tracking-[0.25em] text-gray-400 mb-3 uppercase">Features</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">方法論を、そのまま機能に。</h2>
          </div>
          <div className="grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, tag, title, desc }) => (
              <div key={title} className="group flex flex-col">
                <div className="flex items-center justify-between border-t border-b border-gray-200 py-4 mb-5">
                  <span
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(37,99,235,0.08)' }}
                  >
                    <Icon className="h-5 w-5" style={{ color: '#2563eb' }} />
                  </span>
                  <span className="text-[10px] font-bold tracking-[0.2em] text-gray-400 uppercase">
                    {tag}
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-2" style={{ color: NAVY }}>
                  {title}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Audiences */}
      <section className="bg-gray-50 py-20 md:py-24 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-12 text-center">
            <p className="text-xs font-bold tracking-[0.25em] text-gray-400 mb-3 uppercase">For</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">こんな方に</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {audiences.map((a) => (
              <div key={a.role} className="rounded-2xl bg-white border border-gray-200 p-8">
                <h3 className="text-lg font-bold mb-3" style={{ color: NAVY }}>
                  {a.role}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">まずはプロジェクトを作る。</h2>
          <p className="mt-5 text-gray-600 leading-loose">
            アカウントを作成して、現状把握から要件定義までの一連を体験できます。
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold text-white shadow-md transition-colors hover:opacity-90"
              style={{ backgroundColor: NAVY }}
            >
              無料で始める
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border-2 px-8 py-3 text-sm font-bold transition-colors"
              style={{ borderColor: NAVY, color: NAVY }}
            >
              ダッシュボードへ
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-gray-300 py-12" style={{ backgroundColor: NAVY }}>
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-white">
              <Database className="h-4 w-4" />
            </span>
            <span className="font-bold text-white">ai-data-flow</span>
          </div>
          <p className="text-xs text-gray-400">
            IPLoT方法論パイプライン（ASIS→課題→TOBE→GAP→要件→動作確認）
          </p>
          <p className="text-xs text-gray-400">© 2026 ai-data-flow</p>
        </div>
      </footer>
    </div>
  );
}

'use client'

// ナレッジグラフ（可視化）。
// 本体（KnowledgeGraphCanvas + 詳細パネル）は Phase 2（Task 14）で実装する。
// ここではサイドバー「ナレッジグラフ」リンクが 404 にならないよう、最小の案内を表示する。

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Brain, FileStack } from 'lucide-react'

export default function KnowledgeGraphPage() {
  const params = useParams()
  const projectId = params.projectId as string

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            ナレッジグラフ
          </span>
        }
        description="取り込んだ文書から抽出したタグ・実体・関係をグラフで可視化します。"
      />

      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Brain className="h-10 w-10 mx-auto text-muted-foreground/50" />
          <div className="text-sm text-muted-foreground">
            グラフ可視化は準備中です。まずは取り込みでナレッジを蓄積してください。
          </div>
          <Link
            href={`/dashboard/projects/${projectId}/knowledge/ingestion`}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <FileStack className="h-4 w-4" />
            取り込みダッシュボードへ
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

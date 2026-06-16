'use client';

/**
 * 処理状況ページ。
 *
 * バックグラウンドで実行されるAIジョブ（Mermaid解析・KPI生成など）や
 * 取り込み処理の進捗・履歴を一覧表示する。BackgroundJobsPanel が
 * 自身でポーリングして再取得するため、本ページは projectId を渡すだけでよい。
 */

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { BackgroundJobsPanel } from '@/components/background-jobs-panel';

export default function JobsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  return (
    <div className="space-y-6">
      <PageHeader
        title="処理状況"
        description="バックグラウンド処理（AI生成・取り込み等）の進捗と履歴を確認できます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
      />

      <BackgroundJobsPanel projectId={projectId} />
    </div>
  );
}

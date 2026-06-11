'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { ShieldAlert } from 'lucide-react';
import { RiskTableBoard } from './_components/risk-table-board';

/**
 * リスクマネジメント ワークスペース。
 *
 * 教材「プロジェクト管理」のリスク・ボトルネック登録簿を、専用テーブル Risk を
 * 直接 CRUD する形に置き換えたページ。
 * （旧来の RecordSheet 'risk-register'（{rows}）は廃止し、行クリックで全項目を
 * 編集できる Risk テーブルエディタに統一した。）
 * 優先度別件数サマリは Risk 一覧から集計して表示する。
 */
export default function RiskManagementPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-blue-600" />
            リスクマネジメント
          </span>
        }
        description="PMBOK準拠：確率×影響スコア・対応戦略・ライフサイクルでリスク（脅威/好機）を管理"
        help="リスクを1行ずつ登録し、種別（RBSカテゴリ）・領域・オーナー・レビュー会議・確率×影響（1-5）スコア・対応戦略（脅威：回避/転嫁/軽減/受容、好機：活用/共有/強化/受容）・ライフサイクルを管理します。上部の確率×影響ヒートマップのセルをクリックすると、そのセルのリスクに絞り込めます。編集モーダルから「対応タスク作成」でリスク対応タスクを起票できます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                '「行を追加」でリスク（脅威/好機）を1行ずつ登録します。一覧は主要列（区分・事象内容・種別・原因区分・スコア・期限・担当・対応策・ライフサイクル）のみ表示し、残りの項目は行クリックの編集モーダルで確認・編集します（横スクロール可）。',
                '行をクリックして、種別（RBSカテゴリ）・領域・オーナー・レビュー会議・確率×影響（1-5）を設定します。スコア（P×I）は自動計算されます。',
                '脅威/好機の切替で対応戦略の選択肢が切り替わります（脅威：回避/転嫁/軽減/受容、好機：活用/共有/強化/受容）。対応計画・コンティンジェンシー・トリガーも記入できます。',
                '上部のヒートマップ（脅威のみ集計）のセルをクリックすると、そのセルのリスクに絞り込めます。種別・領域・オーナー・ライフサイクルのフィルタも併用できます。',
                '編集モーダルの「対応タスク作成」で [リスク対応] タスクを起票し、紐づくタスクの状況を確認できます。',
                '下部の「種別管理」で RBS カテゴリを追加・改名・削除できます。',
              ]}
            />
            <ManualButton feature="risk-management" />
          </>
        }
      />

      <RiskTableBoard projectId={projectId} />
    </div>
  );
}
